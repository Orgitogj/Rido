import { createHash, randomBytes } from "node:crypto";

import {
  type RideStatus,
  SAFETY_RULES,
  type SharedTripStatus,
  type SharedTripView,
  type TripShareCreated,
  type TripShareView,
} from "../shared/contracts";

import { type Database, type SqlClient, transaction } from "./db";
import { ApiError, notFound } from "./errors";
import { ASSIGNED_STATUSES, TERMINAL_STATUSES } from "./lifecycle";
import { driverLocationView } from "./location";

export const SHAREABLE_STATUSES: RideStatus[] = [
  "requested",
  "offered",
  "accepted",
  "arriving",
  "arrived",
  "in_progress",
];

const MINUTE_MS = 60 * 1000;

export const hashShareToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

interface ShareRow {
  id: string;
  ride_id: string;
  created_by: string;
  expires_at: Date;
  revoked_at: Date | null;
  view_count: number;
  created_at: Date;
}

const shareView = (s: ShareRow, now: Date): TripShareView => ({
  id: s.id,
  createdAt: new Date(s.created_at).toISOString(),
  expiresAt: new Date(s.expires_at).toISOString(),
  revokedAt: s.revoked_at ? new Date(s.revoked_at).toISOString() : null,
  active: !s.revoked_at && new Date(s.expires_at).getTime() > now.getTime(),
  views: s.view_count,
});

export async function listShares(
  db: SqlClient,
  rideId: string,
  now: Date,
): Promise<TripShareView[]> {
  const { rows } = await db.query<ShareRow>(
    "SELECT * FROM mobility.trip_shares WHERE ride_id = $1 ORDER BY created_at DESC",
    [rideId],
  );
  return rows.map((s) => shareView(s, now));
}

export async function createTripShare(
  deps: { db: Database; now: () => Date },
  userId: string,
  rideId: string,
): Promise<TripShareCreated> {
  const now = deps.now();
  return transaction(deps.db, async (tx) => {
    const { rows } = await tx.query<{ user_id: string; status: RideStatus }>(
      "SELECT user_id, status FROM mobility.rides WHERE id = $1 FOR UPDATE",
      [rideId],
    );
    const ride = rows[0];
    if (!ride || ride.user_id !== userId) throw notFound("Ride");
    if (!SHAREABLE_STATUSES.includes(ride.status)) {
      throw new ApiError(
        409,
        "SHARE_NOT_AVAILABLE",
        "Trip sharing is only available while a ride is active.",
      );
    }
    const { rows: active } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM mobility.trip_shares
        WHERE ride_id = $1 AND revoked_at IS NULL AND expires_at > $2`,
      [rideId, now],
    );
    if (active[0].n >= SAFETY_RULES.maxActiveShares) {
      throw new ApiError(
        409,
        "TOO_MANY_SHARES",
        `You can have up to ${SAFETY_RULES.maxActiveShares} active links. Stop sharing one first.`,
      );
    }
    const token = randomBytes(32).toString("base64url");
    const { rows: created } = await tx.query<ShareRow>(
      `INSERT INTO mobility.trip_shares (ride_id, created_by, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        rideId,
        userId,
        hashShareToken(token),
        new Date(now.getTime() + SAFETY_RULES.shareTtlMinutes * MINUTE_MS),
        now,
      ],
    );
    return {
      share: shareView(created[0], now),
      token,
      path: `/share/${token}`,
    };
  });
}

export async function revokeTripShare(
  deps: { db: Database; now: () => Date },
  userId: string,
  shareId: string,
): Promise<TripShareView> {
  const now = deps.now();
  const { rows } = await deps.db.query<ShareRow>(
    `UPDATE mobility.trip_shares s
        SET revoked_at = COALESCE(s.revoked_at, $3)
       FROM mobility.rides r
      WHERE s.id = $1 AND r.id = s.ride_id AND r.user_id = $2
      RETURNING s.*`,
    [shareId, userId, now],
  );
  if (!rows[0]) throw notFound("Share");
  return shareView(rows[0], now);
}

const STATUS: Partial<Record<RideStatus, SharedTripStatus>> = {
  awaiting_payment: "searching",
  requested: "searching",
  offered: "searching",
  accepted: "driver_on_the_way",
  arriving: "driver_on_the_way",
  arrived: "driver_arrived",
  in_progress: "in_progress",
  completed: "completed",
};

const unavailable = () =>
  new ApiError(
    404,
    "SHARE_UNAVAILABLE",
    "This trip link has ended or doesn't exist.",
  );

const round = (n: number) => Math.round(n * 10_000) / 10_000;

export async function viewSharedTrip(
  deps: { db: Database; now: () => Date },
  token: string,
): Promise<SharedTripView> {
  const now = deps.now();
  const { rows } = await deps.db.query<
    ShareRow & {
      status: RideStatus;
      destination_address: string;
      completed_at: Date | null;
      cancelled_at: Date | null;
      interrupted_at: Date | null;
      display_name: string | null;
      vehicle_make: string | null;
      vehicle_model: string | null;
      vehicle_color: string | null;
      vehicle_plate: string | null;
      latitude: number | null;
      longitude: number | null;
      location_accuracy_m: number | null;
      location_heading: number | null;
      location_updated_at: Date | null;
    }
  >(
    `SELECT s.*, r.status, r.destination_address, r.completed_at, r.cancelled_at,
            r.interrupted_at, dp.display_name, dp.vehicle_make, dp.vehicle_model, dp.vehicle_color,
            dp.vehicle_plate, dp.latitude, dp.longitude, dp.location_accuracy_m,
            dp.location_heading, dp.location_updated_at
       FROM mobility.trip_shares s
       JOIN mobility.rides r ON r.id = s.ride_id
       LEFT JOIN mobility.driver_profiles dp ON dp.id = r.driver_profile_id
      WHERE s.token_hash = $1`,
    [hashShareToken(token)],
  );
  const s = rows[0];
  if (!s || s.revoked_at || new Date(s.expires_at).getTime() <= now.getTime()) {
    throw unavailable();
  }
  const ended = TERMINAL_STATUSES.includes(s.status)
    ? (s.completed_at ?? s.interrupted_at ?? s.cancelled_at)
    : null;
  if (
    TERMINAL_STATUSES.includes(s.status) &&
    (!ended ||
      now.getTime() >
        new Date(ended).getTime() +
          SAFETY_RULES.shareAfterTripMinutes * MINUTE_MS)
  ) {
    throw unavailable();
  }
  await deps.db.query(
    "UPDATE mobility.trip_shares SET view_count = view_count + 1, last_viewed_at = $2 WHERE id = $1",
    [s.id, now],
  );
  const assigned =
    ASSIGNED_STATUSES.includes(s.status) && s.display_name !== null;
  const location = assigned ? driverLocationView(s, now).view : null;
  return {
    status: STATUS[s.status] ?? "ended",
    driver: assigned
      ? {
          firstName: s.display_name!.trim().split(/\s+/)[0],
          vehicle: [s.vehicle_color, s.vehicle_make, s.vehicle_model]
            .filter(Boolean)
            .join(" "),
          plate: s.vehicle_plate ?? "",
        }
      : null,
    destination: TERMINAL_STATUSES.includes(s.status)
      ? null
      : s.destination_address,
    driverLocation: location
      ? {
          latitude: round(location.latitude),
          longitude: round(location.longitude),
          recordedAt: location.recordedAt,
          freshness: location.freshness,
        }
      : null,
    expiresAt: new Date(s.expires_at).toISOString(),
    serverTime: now.toISOString(),
  };
}
