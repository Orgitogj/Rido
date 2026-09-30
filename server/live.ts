import { haversineMeters } from "../shared/geo";

import { driverLocationView, type DriverLocationRow } from "./location";
import {
  type Point,
  type RoutingProvider,
  straightLineEstimate,
} from "./routing";
import { reserveRouting } from "./routingBudget";

import type { Database } from "./db";
import type { RideRow } from "./lifecycle";
import type { EtaView, Leg, LiveTripView } from "../shared/contracts";

export const ETA = {
  minRefreshSeconds: 30,
  maxAgeSeconds: 180,
  moveThresholdMeters: 300,
  claimSeconds: 10,
} as const;

export interface LiveDeps {
  db: Database;
  routing?: RoutingProvider | null;
  now: () => Date;
}

interface RouteRow {
  origin_latitude: number;
  origin_longitude: number;
  duration_seconds: number;
  distance_meters: number;
  polyline: string | null;
  source: "routed" | "estimate";
  computed_at: Date;
  refreshing_until: Date | null;
  version: number;
}

export function legFor(status: RideRow["status"]): Leg | null {
  if (status === "accepted" || status === "arriving") return "pickup";
  if (status === "arrived" || status === "in_progress") return "destination";
  return null;
}

const log = (event: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ event, ...fields }));

async function refreshRoute(
  deps: LiveDeps,
  rideId: string,
  leg: Leg,
  origin: Point,
  target: Point,
): Promise<RouteRow | null> {
  const now = deps.now();
  const { rows } = await deps.db.query<RouteRow>(
    "SELECT * FROM mobility.ride_routes WHERE ride_id = $1 AND leg = $2",
    [rideId, leg],
  );
  const current = rows[0] ?? null;
  if (current) {
    const age =
      (now.getTime() - new Date(current.computed_at).getTime()) / 1000;
    const moved = haversineMeters(
      {
        latitude: current.origin_latitude,
        longitude: current.origin_longitude,
      },
      origin,
    );
    const due =
      age >= ETA.minRefreshSeconds &&
      (moved >= ETA.moveThresholdMeters || age >= ETA.maxAgeSeconds);
    if (!due) return current;
  }

  const claimUntil = new Date(now.getTime() + ETA.claimSeconds * 1000);
  const estimate = straightLineEstimate(origin, target);
  const claim = current
    ? await deps.db.query<RouteRow>(
        `UPDATE mobility.ride_routes SET refreshing_until = $3
          WHERE ride_id = $1 AND leg = $2
            AND (refreshing_until IS NULL OR refreshing_until <= $4)
          RETURNING *`,
        [rideId, leg, claimUntil, now],
      )
    : await deps.db.query<RouteRow>(
        `INSERT INTO mobility.ride_routes
           (ride_id, leg, origin_latitude, origin_longitude, duration_seconds,
            distance_meters, polyline, source, computed_at, refreshing_until)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, 'estimate', $7, $8)
         ON CONFLICT (ride_id, leg) DO NOTHING
         RETURNING *`,
        [
          rideId,
          leg,
          origin.latitude,
          origin.longitude,
          estimate.durationSeconds,
          estimate.distanceMeters,
          now,
          claimUntil,
        ],
      );
  if (!claim.rows[0]) {
    const again = await deps.db.query<RouteRow>(
      "SELECT * FROM mobility.ride_routes WHERE ride_id = $1 AND leg = $2",
      [rideId, leg],
    );
    return again.rows[0] ?? current;
  }

  let result = estimate;
  let source: "routed" | "estimate" = "estimate";
  if (deps.routing && (await reserveRouting(deps.db, "routes", 1, now))) {
    try {
      const routed = await deps.routing.route(origin, target);
      if (routed) {
        result = routed;
        source = "routed";
      }
    } catch {
      log("routing_failed", { rideId, leg });
    }
  }
  const { rows: updated } = await deps.db.query<RouteRow>(
    `UPDATE mobility.ride_routes
        SET origin_latitude = $3, origin_longitude = $4, duration_seconds = $5,
            distance_meters = $6, polyline = $7, source = $8, computed_at = $9,
            refreshing_until = NULL, version = version + 1
      WHERE ride_id = $1 AND leg = $2
      RETURNING *`,
    [
      rideId,
      leg,
      origin.latitude,
      origin.longitude,
      result.durationSeconds,
      result.distanceMeters,
      result.polyline,
      source,
      deps.now(),
    ],
  );
  return updated[0] ?? null;
}

export async function liveTrip(
  deps: LiveDeps,
  ride: RideRow,
  knownRouteVersion: number,
): Promise<LiveTripView> {
  const now = deps.now();
  const leg = legFor(ride.status);
  const { rows } = ride.driver_profile_id
    ? await deps.db.query<DriverLocationRow & { location_seq: string }>(
        `SELECT latitude, longitude, location_accuracy_m, location_heading,
                location_updated_at, location_seq
           FROM mobility.driver_profiles WHERE id = $1`,
        [ride.driver_profile_id],
      )
    : { rows: [] };
  const profile = rows[0] ?? null;
  const locationSeq = Number(profile?.location_seq ?? 0);

  if (!leg) {
    return {
      leg: null,
      locationSeq,
      locationStatus: "not_shared",
      driverLocation: null,
      eta: null,
      routeVersion: 0,
      route: null,
    };
  }

  const location = driverLocationView(profile, now);
  const pickup = {
    latitude: ride.origin_latitude,
    longitude: ride.origin_longitude,
  };
  const destination = {
    latitude: ride.destination_latitude,
    longitude: ride.destination_longitude,
  };
  const origin =
    ride.status === "arrived"
      ? pickup
      : location.view
        ? {
            latitude: location.view.latitude,
            longitude: location.view.longitude,
          }
        : null;

  let route: RouteRow | null = null;
  if (origin) {
    route = await refreshRoute(
      deps,
      ride.id,
      leg,
      origin,
      leg === "pickup" ? pickup : destination,
    );
  }

  let eta: EtaView | null = null;
  if (route && ride.status !== "arrived") {
    const computedAt = new Date(route.computed_at);
    const arrival = new Date(
      computedAt.getTime() + route.duration_seconds * 1000,
    );
    eta = {
      leg,
      durationSeconds: Math.max(
        0,
        Math.round((arrival.getTime() - now.getTime()) / 1000),
      ),
      distanceMeters: route.distance_meters,
      arrivalAt: arrival.toISOString(),
      computedAt: computedAt.toISOString(),
      source: route.source,
    };
  }

  const routeVersion = route?.version ?? 0;
  return {
    leg,
    locationSeq,
    locationStatus: location.status,
    driverLocation: location.view,
    eta,
    routeVersion,
    route:
      route && routeVersion !== knownRouteVersion
        ? { polyline: route.polyline }
        : null,
  };
}
