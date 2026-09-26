import { haversineMeters } from "../shared/geo";

import { ASSIGNED_STATUSES, type RideRow, transitionRide } from "./lifecycle";
import { enqueueOffer } from "./notifications";

import type { SqlClient } from "./db";

export const MATCHING = {
  offerTtlSeconds: 20,
  searchTimeoutSeconds: 120,
  driverFreshSeconds: 45,
  locationMaxAgeSeconds: 10 * 60,
  radiusMeters: 15_000,
  awaitingPaymentTtlSeconds: 15 * 60,
  authorizationSafetySeconds: 3600,
} as const;

const secondsBefore = (now: Date, s: number) =>
  new Date(now.getTime() - s * 1000);

export interface Candidate {
  driverProfileId: string;
  distanceMeters: number;
}

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
      WHERE dp.status = 'approved' AND dp.online
        AND dp.last_seen_at >= $1
        AND dp.location_updated_at >= $2
        AND ($3::uuid IS NULL OR dp.user_id <> $3::uuid)`,
    [
      secondsBefore(now, MATCHING.driverFreshSeconds),
      secondsBefore(now, MATCHING.locationMaxAgeSeconds),
      excludeUserId ?? null,
    ],
  );
  return rows
    .map((d) => ({
      driverProfileId: d.id,
      distanceMeters: Math.round(haversineMeters(point, d)),
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
  ride: RideRow,
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
    `SELECT 1 FROM mobility.driver_profiles
      WHERE id = $1 AND status = 'approved' AND online AND last_seen_at >= $2`,
    [driverProfileId, secondsBefore(now, MATCHING.driverFreshSeconds)],
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
  for (const candidate of await eligibleDrivers(tx, ride, now)) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO mobility.ride_offers
         (ride_id, driver_profile_id, distance_meters, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (driver_profile_id) WHERE status = 'pending' DO NOTHING
       RETURNING id`,
      [
        ride.id,
        candidate.driverProfileId,
        candidate.distanceMeters,
        now,
        new Date(now.getTime() + MATCHING.offerTtlSeconds * 1000),
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
