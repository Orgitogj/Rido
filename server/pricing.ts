import { MAX_TRIP_METERS, MIN_TRIP_METERS } from "../shared/geo";

export const QUOTE = {
  ttlSeconds: 10 * 60,
  reuseWindowSeconds: 60,
  reuseMinRemainingSeconds: 5 * 60,
  perUserWindowSeconds: 10 * 60,
  perUserLimit: 30,
  routingRetryAfterSeconds: 15,
  minTripMeters: MIN_TRIP_METERS,
  maxTripMeters: MAX_TRIP_METERS,
} as const;
