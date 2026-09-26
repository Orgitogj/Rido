import { haversineMeters } from "../shared/geo";

import { PRICING } from "./pricing";

export interface Point {
  latitude: number;
  longitude: number;
}

export interface RouteResult {
  durationSeconds: number;
  distanceMeters: number;
  polyline: string | null;
}

export interface RoutingProvider {
  route(from: Point, to: Point): Promise<RouteResult>;
}

export function straightLineEstimate(from: Point, to: Point): RouteResult {
  const distanceMeters = Math.round(
    haversineMeters(from, to) * PRICING.roadFactor,
  );
  return {
    distanceMeters,
    durationSeconds: Math.round(distanceMeters / PRICING.averageSpeedMps),
    polyline: null,
  };
}

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const TIMEOUT_MS = 5000;

export function googleRoutesProvider(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): RoutingProvider {
  return {
    async route(from, to) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetchImpl(ROUTES_URL, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
          },
          body: JSON.stringify({
            origin: { location: { latLng: from } },
            destination: { location: { latLng: to } },
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_UNAWARE",
          }),
        });
        if (!response.ok) throw new Error(`Routes API ${response.status}`);
        const json = (await response.json()) as {
          routes?: {
            duration?: string;
            distanceMeters?: number;
            polyline?: { encodedPolyline?: string };
          }[];
        };
        const route = json.routes?.[0];
        const seconds = Number(
          /^(\d+(?:\.\d+)?)s$/.exec(route?.duration ?? "")?.[1],
        );
        if (!route || !Number.isFinite(seconds)) {
          throw new Error("Routes API returned no route");
        }
        return {
          durationSeconds: Math.round(seconds),
          distanceMeters: Math.round(route.distanceMeters ?? 0),
          polyline: route.polyline?.encodedPolyline ?? null,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function routingFromEnv(env = process.env): RoutingProvider | null {
  const key = env.GOOGLE_ROUTES_API_KEY?.trim();
  return key ? googleRoutesProvider(key) : null;
}
