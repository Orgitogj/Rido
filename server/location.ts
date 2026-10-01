import { haversineMeters } from "../shared/geo";

import { transaction, type SqlClient } from "./db";
import { ASSIGNED_STATUSES } from "./lifecycle";

import type { Database } from "./db";
import type {
  DriverLocationView,
  LocationRejection,
  LocationUpdateResult,
} from "../shared/contracts";

export const LOCATION = {
  minIntervalMs: 2000,
  maxAgeSeconds: 120,
  maxFutureSeconds: 30,
  maxAccuracyMeters: 500,
  maxSpeedMps: 70,
  jumpAllowanceMeters: 150,
  jumpResetSeconds: 600,
  liveSeconds: 30,
  recentSeconds: 300,
} as const;

export interface LocationInput {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading?: number | null;
  speed?: number | null;
  recordedAt: string;
}

export interface StoredLocation {
  latitude: number | null;
  longitude: number | null;
  location_updated_at: Date | null;
  location_received_at: Date | null;
  location_accuracy_m: number | null;
}

export function validateLocation(
  input: LocationInput,
  previous: StoredLocation | null,
  now: Date,
): LocationRejection | null {
  const recorded = new Date(input.recordedAt).getTime();
  const nowMs = now.getTime();
  if (recorded > nowMs + LOCATION.maxFutureSeconds * 1000) return "future";
  if (nowMs - recorded > LOCATION.maxAgeSeconds * 1000) return "stale";
  if (input.accuracy !== null && input.accuracy > LOCATION.maxAccuracyMeters) {
    return "low_accuracy";
  }
  if (
    !previous ||
    previous.latitude === null ||
    previous.longitude === null ||
    !previous.location_updated_at
  ) {
    return null;
  }
  const previousAt = new Date(previous.location_updated_at).getTime();
  if (recorded <= previousAt) return "out_of_order";
  if (
    previous.location_received_at &&
    nowMs - new Date(previous.location_received_at).getTime() <
      LOCATION.minIntervalMs
  ) {
    return "throttled";
  }
  const seconds = (recorded - previousAt) / 1000;
  if (seconds < LOCATION.jumpResetSeconds) {
    const meters = haversineMeters(
      { latitude: previous.latitude, longitude: previous.longitude },
      input,
    );
    const allowance =
      LOCATION.jumpAllowanceMeters +
      (previous.location_accuracy_m ?? 0) +
      (input.accuracy ?? 0);
    if (meters > allowance && meters / seconds > LOCATION.maxSpeedMps) {
      return "jump";
    }
  }
  return null;
}

interface ProfileLocationRow extends StoredLocation {
  id: string;
  status: string;
  online: boolean;
}

export async function recordDriverLocation(
  db: Database,
  driverProfileId: string,
  input: LocationInput,
  now: Date,
  opts: { reset?: boolean } = {},
): Promise<LocationUpdateResult> {
  return transaction(db, async (tx) => {
    const { rows } = await tx.query<ProfileLocationRow>(
      `SELECT id, status, online, latitude, longitude, location_updated_at,
              location_received_at, location_accuracy_m
         FROM mobility.driver_profiles WHERE id = $1 FOR UPDATE`,
      [driverProfileId],
    );
    const profile = rows[0];
    const { rows: active } = await tx.query(
      `SELECT 1 FROM mobility.rides
        WHERE driver_profile_id = $1 AND status = ANY($2::text[])`,
      [driverProfileId, ASSIGNED_STATUSES],
    );
    const sharing =
      active.length > 0 ||
      (profile?.status === "approved" &&
        (profile.online || Boolean(opts.reset)));
    if (!sharing) return { accepted: false, reason: "not_sharing", sharing };

    const reason = validateLocation(input, opts.reset ? null : profile, now);
    if (reason) return { accepted: false, reason, sharing };

    await tx.query(
      `UPDATE mobility.driver_profiles
          SET latitude = $2, longitude = $3, location_accuracy_m = $4,
              location_heading = $5, location_speed_mps = $6,
              location_updated_at = $7, location_received_at = $8,
              last_seen_at = $8, location_seq = location_seq + 1,
              updated_at = now()
        WHERE id = $1`,
      [
        driverProfileId,
        input.latitude,
        input.longitude,
        input.accuracy,
        input.heading !== null &&
        input.heading !== undefined &&
        input.heading >= 0
          ? input.heading % 360
          : null,
        input.speed !== null && input.speed !== undefined && input.speed >= 0
          ? input.speed
          : null,
        new Date(input.recordedAt),
        now,
      ],
    );
    return { accepted: true, reason: null, sharing };
  });
}

export async function clearDriverLocation(
  db: SqlClient,
  driverProfileId: string,
) {
  await db.query(
    `UPDATE mobility.driver_profiles
        SET latitude = NULL, longitude = NULL, location_accuracy_m = NULL,
            location_heading = NULL, location_speed_mps = NULL,
            location_updated_at = NULL, location_received_at = NULL,
            location_seq = location_seq + 1, updated_at = now()
      WHERE id = $1 AND NOT online`,
    [driverProfileId],
  );
}

export interface DriverLocationRow {
  latitude: number | null;
  longitude: number | null;
  location_accuracy_m: number | null;
  location_heading: number | null;
  location_updated_at: Date | null;
}

export function driverLocationView(
  row: DriverLocationRow | null,
  now: Date,
): {
  view: DriverLocationView | null;
  status: "live" | "recent" | "unavailable";
} {
  if (
    !row ||
    row.latitude === null ||
    row.longitude === null ||
    !row.location_updated_at
  ) {
    return { view: null, status: "unavailable" };
  }
  const ageSeconds = Math.max(
    0,
    Math.floor(
      (now.getTime() - new Date(row.location_updated_at).getTime()) / 1000,
    ),
  );
  if (ageSeconds > LOCATION.recentSeconds)
    return { view: null, status: "unavailable" };
  const freshness = ageSeconds <= LOCATION.liveSeconds ? "live" : "recent";
  return {
    status: freshness,
    view: {
      latitude: row.latitude,
      longitude: row.longitude,
      accuracyMeters: row.location_accuracy_m,
      heading: row.location_heading,
      recordedAt: new Date(row.location_updated_at).toISOString(),
      ageSeconds,
      freshness,
    },
  };
}
