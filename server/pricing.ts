import {
  haversineMeters,
  MAX_TRIP_METERS,
  MIN_TRIP_METERS,
} from "../shared/geo";

import type { Place } from "../shared/contracts";

export const PRICING = {
  version: "demo-v1",
  baseCents: 250,
  perKmCents: 120,
  perMinuteCents: 30,
  minimumFareCents: 500,
  roadFactor: 1.3,
  averageSpeedMps: 25_000 / 3600,
  minTripMeters: MIN_TRIP_METERS,
  maxTripMeters: MAX_TRIP_METERS,
  quoteTtlSeconds: 10 * 60,
} as const;

export interface TripEstimate {
  distanceMeters: number;
  durationSeconds: number;
}

export type TripCheck =
  | { ok: true; trip: TripEstimate }
  | { ok: false; reason: "TOO_SHORT" | "TOO_LONG" };

export function estimateTrip(pickup: Place, destination: Place): TripCheck {
  const straight = haversineMeters(pickup, destination);
  if (straight < PRICING.minTripMeters)
    return { ok: false, reason: "TOO_SHORT" };
  const distanceMeters = Math.round(straight * PRICING.roadFactor);
  if (distanceMeters > PRICING.maxTripMeters)
    return { ok: false, reason: "TOO_LONG" };
  const durationSeconds = Math.max(
    60,
    Math.round(distanceMeters / PRICING.averageSpeedMps),
  );
  return { ok: true, trip: { distanceMeters, durationSeconds } };
}

export function fareCents(trip: TripEstimate, multiplierBp: number): number {
  if (!Number.isInteger(multiplierBp) || multiplierBp <= 0) {
    throw new Error("multiplierBp must be a positive integer");
  }
  const base =
    PRICING.baseCents +
    (trip.distanceMeters * PRICING.perKmCents) / 1000 +
    (trip.durationSeconds * PRICING.perMinuteCents) / 60;
  const fare = Math.round((base * multiplierBp) / 10_000);
  return Math.max(PRICING.minimumFareCents, fare);
}
