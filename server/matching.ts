import { haversineMeters } from "../shared/geo";

import { type Database, transaction } from "./db";
import { eligibleDriverSql } from "./eligibility";
import { ASSIGNED_STATUSES, type RideRow, transitionRide } from "./lifecycle";
import { enqueueOffer } from "./notifications";
import { ROUTING, type RoutingProvider } from "./routing";
import { reserveRouting } from "./routingBudget";

import type { SqlClient } from "./db";

export const MATCHING = {
  offerTtlSeconds: 20,
  searchTimeoutSeconds: 120,
  driverFreshSeconds: 45,
  locationMaxAgeSeconds: 10 * 60,
  radiusMeters: 15_000,
  awaitingPaymentTtlSeconds: 15 * 60,
  authorizationSafetySeconds: 3600,
  rankingRefreshSeconds: 60,
  rankingMaxAgeSeconds: 120,
  rankingClaimSeconds: 15,
  rankingRetryBaseSeconds: 15,
  rankingRetryMaxSeconds: 300,
} as const;

const secondsBefore = (now: Date, s: number) =>
  new Date(now.getTime() - s * 1000);

export interface Candidate {
  driverProfileId: string;
  distanceMeters: number;
  latitude: number;
  longitude: number;
}

type SearchRide = Pick<
  RideRow,
  "id" | "user_id" | "origin_latitude" | "origin_longitude"
>;

interface DriverLocationRow {
  id: string;
  latitude: number;
  longitude: number;
}

export async function onlineDriversNear(
  db: SqlClient,
  point: { latitude: number; longitude: number },
  now: Date,
  excludeUserId?: string,
): Promise<Candidate[]> {
  const { rows } = await db.query<DriverLocationRow>(
    `SELECT dp.id, dp.latitude, dp.longitude
       FROM mobility.driver_profiles dp
      WHERE ${eligibleDriverSql("dp", "$4::timestamptz")} AND dp.online
        AND dp.last_seen_at >= $1
        AND dp.location_updated_at >= $2
        AND ($3::uuid IS NULL OR dp.user_id <> $3::uuid)`,
    [
      secondsBefore(now, MATCHING.driverFreshSeconds),
      secondsBefore(now, MATCHING.locationMaxAgeSeconds),
      excludeUserId ?? null,
      now,
    ],
  );
  return rows
    .map((d) => ({
      driverProfileId: d.id,
      distanceMeters: Math.round(haversineMeters(point, d)),
      latitude: d.latitude,
      longitude: d.longitude,
    }))
    .filter((c) => c.distanceMeters <= MATCHING.radiusMeters)
    .sort(
      (a, b) =>
        a.distanceMeters - b.distanceMeters ||
        a.driverProfileId.localeCompare(b.driverProfileId),
    );
}

export async function eligibleDrivers(
  db: SqlClient,
  ride: SearchRide,
  now: Date,
): Promise<Candidate[]> {
  const near = await onlineDriversNear(
    db,
    { latitude: ride.origin_latitude, longitude: ride.origin_longitude },
    now,
    ride.user_id,
  );
  if (!near.length) return [];
  const { rows: busy } = await db.query<{ id: string }>(
    `SELECT driver_profile_id AS id FROM mobility.rides
      WHERE driver_profile_id = ANY($1::uuid[]) AND status = ANY($2::text[])
     UNION
     SELECT driver_profile_id FROM mobility.ride_offers
      WHERE driver_profile_id = ANY($1::uuid[])
        AND (status = 'pending' OR ride_id = $3)`,
    [near.map((c) => c.driverProfileId), ASSIGNED_STATUSES, ride.id],
  );
  const excluded = new Set(busy.map((b) => b.id));
  return near.filter((c) => !excluded.has(c.driverProfileId));
}

interface OfferRow {
  id: string;
  driver_profile_id: string;
  expires_at: Date;
}

async function driverStillAvailable(
  db: SqlClient,
  driverProfileId: string,
  now: Date,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM mobility.driver_profiles dp
      WHERE dp.id = $1 AND ${eligibleDriverSql("dp", "$3::timestamptz")}
        AND dp.online AND dp.last_seen_at >= $2`,
    [driverProfileId, secondsBefore(now, MATCHING.driverFreshSeconds), now],
  );
  return rows.length > 0;
}

export async function advanceRide(
  tx: SqlClient,
  ride: RideRow,
  now: Date,
): Promise<RideRow> {
  const authorizationEnding =
    ride.authorization_expires_at &&
    now.getTime() >=
      new Date(ride.authorization_expires_at).getTime() -
        MATCHING.authorizationSafetySeconds * 1000;
  if (
    authorizationEnding &&
    (ride.status === "requested" || ride.status === "offered")
  ) {
    await tx.query(
      `UPDATE mobility.ride_offers SET status = 'cancelled', responded_at = $2
        WHERE ride_id = $1 AND status = 'pending'`,
      [ride.id, now],
    );
    return transitionRide(tx, ride, "cancelled", {
      actor: "system",
      now,
      reason: "authorization_expiring",
    });
  }
  if (
    authorizationEnding &&
    ASSIGNED_STATUSES.includes(ride.status) &&
    !ride.needs_review
  ) {
    const { rows } = await tx.query<RideRow>(
      `UPDATE mobility.rides
          SET needs_review = true, review_reason = 'authorization_expiring_during_trip',
              updated_at = now()
        WHERE id = $1 RETURNING *`,
      [ride.id],
    );
    return rows[0];
  }

  if (ride.status === "awaiting_payment") {
    const age = now.getTime() - new Date(ride.created_at).getTime();
    if (age >= MATCHING.awaitingPaymentTtlSeconds * 1000) {
      return transitionRide(tx, ride, "cancelled", {
        actor: "system",
        now,
        reason: "payment_timeout",
      });
    }
    return ride;
  }

  if (ride.status === "offered") {
    const { rows } = await tx.query<OfferRow>(
      `SELECT id, driver_profile_id, expires_at FROM mobility.ride_offers
        WHERE ride_id = $1 AND status = 'pending' FOR UPDATE`,
      [ride.id],
    );
    const offer = rows[0];
    const expired = !offer || new Date(offer.expires_at) <= now;
    const gone =
      offer && !(await driverStillAvailable(tx, offer.driver_profile_id, now));
    if (!expired && !gone) return ride;
    if (offer) {
      await tx.query(
        `UPDATE mobility.ride_offers SET status = $2, responded_at = $3 WHERE id = $1`,
        [offer.id, expired ? "expired" : "cancelled", now],
      );
    }
    ride = await transitionRide(tx, ride, "requested", {
      actor: "system",
      now,
      reason: expired ? "offer_expired" : "driver_unavailable",
    });
  }

  if (ride.status === "requested") return offerToNextDriver(tx, ride, now);
  return ride;
}

interface RankingRow {
  driver_profile_id: string;
  road_duration_seconds: number | null;
  reachable: boolean;
}

interface RankedCandidate extends Candidate {
  roadDurationSeconds: number | null;
  source: "road" | "straight_line";
}

export async function rankCandidates(
  db: SqlClient,
  ride: SearchRide & { ranking_computed_at?: Date | null },
  now: Date,
): Promise<RankedCandidate[]> {
  const candidates = await eligibleDrivers(db, ride, now);
  const fresh =
    ride.ranking_computed_at &&
    now.getTime() - new Date(ride.ranking_computed_at).getTime() <=
      MATCHING.rankingMaxAgeSeconds * 1000;
  if (!fresh || !candidates.length) {
    return candidates.map((c) => ({
      ...c,
      roadDurationSeconds: null,
      source: "straight_line" as const,
    }));
  }
  const { rows } = await db.query<RankingRow>(
    `SELECT driver_profile_id, road_duration_seconds, reachable
       FROM mobility.match_rankings WHERE ride_id = $1`,
    [ride.id],
  );
  const byDriver = new Map(rows.map((r) => [r.driver_profile_id, r]));
  const ranked: RankedCandidate[] = [];
  const unranked: RankedCandidate[] = [];
  for (const c of candidates) {
    const r = byDriver.get(c.driverProfileId);
    if (!r) {
      unranked.push({
        ...c,
        roadDurationSeconds: null,
        source: "straight_line",
      });
    } else if (r.reachable && r.road_duration_seconds !== null) {
      ranked.push({
        ...c,
        roadDurationSeconds: r.road_duration_seconds,
        source: "road",
      });
    }
  }
  ranked.sort(
    (x, y) =>
      x.roadDurationSeconds! - y.roadDurationSeconds! ||
      x.distanceMeters - y.distanceMeters ||
      x.driverProfileId.localeCompare(y.driverProfileId),
  );
  return [...ranked, ...unranked];
}

export type RankingOutcome =
  | "skipped"
  | "no_routing"
  | "no_candidates"
  | "budget_exhausted"
  | "failed"
  | "ranked";

const log = (event: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ event, ...fields }));

export async function refreshMatchRanking(
  deps: { db: Database; routing?: RoutingProvider | null; now: () => Date },
  rideId: string,
): Promise<RankingOutcome> {
  if (!deps.routing) return "no_routing";
  const now = deps.now();
  const { rows } = await deps.db.query<
    SearchRide & { ranking_failures: number }
  >(
    `UPDATE mobility.rides
        SET ranking_claimed_at = $2
      WHERE id = $1
        AND status IN ('awaiting_payment', 'requested', 'offered')
        AND (ranking_computed_at IS NULL OR ranking_computed_at <= $3)
        AND (ranking_claimed_at IS NULL OR ranking_claimed_at <= $4)
        AND (ranking_retry_at IS NULL OR ranking_retry_at <= $2)
      RETURNING id, user_id, origin_latitude, origin_longitude, ranking_failures`,
    [
      rideId,
      now,
      new Date(now.getTime() - MATCHING.rankingRefreshSeconds * 1000),
      new Date(now.getTime() - MATCHING.rankingClaimSeconds * 1000),
    ],
  );
  const ride = rows[0];
  if (!ride) return "skipped";
  const release = (retryAfterSeconds: number | null, failed: boolean) =>
    deps.db.query(
      `UPDATE mobility.rides
          SET ranking_claimed_at = NULL,
              ranking_failures = CASE WHEN $3::boolean THEN ranking_failures + 1 ELSE ranking_failures END,
              ranking_retry_at = $2
        WHERE id = $1`,
      [
        rideId,
        retryAfterSeconds === null
          ? null
          : new Date(now.getTime() + retryAfterSeconds * 1000),
        failed,
      ],
    );

  const candidates = (await eligibleDrivers(deps.db, ride, now)).slice(
    0,
    ROUTING.maxMatrixOrigins,
  );
  const pickup = {
    latitude: ride.origin_latitude,
    longitude: ride.origin_longitude,
  };
  let elements: Awaited<ReturnType<RoutingProvider["routeMatrix"]>> = [];
  if (candidates.length) {
    if (
      !(await reserveRouting(deps.db, "route_matrix", candidates.length, now))
    ) {
      await release(MATCHING.rankingRetryBaseSeconds, false);
      log("ranking_budget_exhausted", { rideId });
      return "budget_exhausted";
    }
    try {
      elements = await deps.routing.routeMatrix(
        candidates.map((c) => ({
          latitude: c.latitude,
          longitude: c.longitude,
        })),
        pickup,
      );
    } catch {
      const delay = Math.min(
        MATCHING.rankingRetryMaxSeconds,
        MATCHING.rankingRetryBaseSeconds * 2 ** ride.ranking_failures,
      );
      await release(delay, true);
      log("ranking_failed", { rideId, candidates: candidates.length });
      return "failed";
    }
  }

  await transaction(deps.db, async (tx) => {
    await tx.query("DELETE FROM mobility.match_rankings WHERE ride_id = $1", [
      rideId,
    ]);
    for (const e of elements) {
      const c = candidates[e.originIndex];
      if (!c) continue;
      await tx.query(
        `INSERT INTO mobility.match_rankings
           (ride_id, driver_profile_id, straight_meters, road_duration_seconds,
            road_distance_meters, reachable, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (ride_id, driver_profile_id) DO NOTHING`,
        [
          rideId,
          c.driverProfileId,
          c.distanceMeters,
          e.reachable ? e.durationSeconds : null,
          e.reachable ? e.distanceMeters : null,
          e.reachable,
          now,
        ],
      );
    }
    await tx.query(
      `UPDATE mobility.rides
          SET ranking_computed_at = $2, ranking_claimed_at = NULL,
              ranking_failures = 0, ranking_retry_at = NULL
        WHERE id = $1`,
      [rideId, now],
    );
  });
  return candidates.length ? "ranked" : "no_candidates";
}

export async function offerToNextDriver(
  tx: SqlClient,
  ride: RideRow,
  now: Date,
): Promise<RideRow> {
  if (ride.search_deadline && new Date(ride.search_deadline) <= now) {
    return transitionRide(tx, ride, "no_driver", {
      actor: "system",
      now,
      reason: ride.rematch_count > 0 ? "no_replacement_driver" : "no_driver",
    });
  }
  for (const candidate of await rankCandidates(tx, ride, now)) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO mobility.ride_offers
         (ride_id, driver_profile_id, distance_meters, created_at, expires_at,
          road_duration_seconds, ranking_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (driver_profile_id) WHERE status = 'pending' DO NOTHING
       RETURNING id`,
      [
        ride.id,
        candidate.driverProfileId,
        candidate.distanceMeters,
        now,
        new Date(now.getTime() + MATCHING.offerTtlSeconds * 1000),
        candidate.roadDurationSeconds,
        candidate.source,
      ],
    );
    if (rows.length) {
      await enqueueOffer(
        tx,
        {
          id: rows[0].id,
          driverProfileId: candidate.driverProfileId,
          distanceMeters: candidate.distanceMeters,
          fareCents: ride.fare_cents,
        },
        now,
      );
      return transitionRide(tx, ride, "offered", { actor: "system", now });
    }
  }
  return ride;
}
