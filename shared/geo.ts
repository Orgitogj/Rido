import { placeSchema } from "./contracts";

export const MIN_TRIP_METERS = 200;
export const MAX_TRIP_METERS = 150_000;

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface MaybePlace {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

export type TripProblemCode =
  "PICKUP_MISSING" | "DESTINATION_MISSING" | "UNRESOLVED" | "TOO_CLOSE";

const TRIP_PROBLEM_TEXT: Record<TripProblemCode, string> = {
  PICKUP_MISSING: "Choose a pickup location.",
  DESTINATION_MISSING: "Choose a destination.",
  UNRESOLVED:
    "One of these locations couldn't be resolved. Please pick it again.",
  TOO_CLOSE: "Pickup and destination are too close together.",
};

export function tripProblem(
  pickup: MaybePlace,
  destination: MaybePlace,
): string | null {
  const code = tripProblemCode(pickup, destination);
  return code ? TRIP_PROBLEM_TEXT[code] : null;
}

export function tripProblemCode(
  pickup: MaybePlace,
  destination: MaybePlace,
): TripProblemCode | null {
  if (
    pickup.latitude === null ||
    pickup.longitude === null ||
    !pickup.address
  ) {
    return "PICKUP_MISSING";
  }
  if (
    destination.latitude === null ||
    destination.longitude === null ||
    !destination.address
  ) {
    return "DESTINATION_MISSING";
  }
  if (
    !placeSchema.safeParse(pickup).success ||
    !placeSchema.safeParse(destination).success
  ) {
    return "UNRESOLVED";
  }
  const meters = haversineMeters(
    { latitude: pickup.latitude, longitude: pickup.longitude },
    { latitude: destination.latitude, longitude: destination.longitude },
  );
  if (meters < MIN_TRIP_METERS) return "TOO_CLOSE";
  return null;
}
