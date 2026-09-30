import { haversineMeters } from "../shared/geo";

export interface Point {
  latitude: number;
  longitude: number;
}

export interface RouteResult {
  durationSeconds: number;
  distanceMeters: number;
  polyline: string | null;
}

export interface MatrixElement {
  originIndex: number;
  reachable: boolean;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

export type RouteSource = "google_routes" | "test_provider";

export interface RoutingProvider {
  source: RouteSource;
  route(from: Point, to: Point): Promise<RouteResult | null>;
  routeMatrix(origins: Point[], destination: Point): Promise<MatrixElement[]>;
}

export class RoutingUnavailableError extends Error {}

export const ROUTING = {
  maxMatrixOrigins: 10,
  routeTimeoutMs: 5000,
  matrixTimeoutMs: 4000,
  fallbackRoadFactor: 1.3,
  fallbackSpeedMps: 25_000 / 3600,
} as const;

export function straightLineEstimate(from: Point, to: Point): RouteResult {
  const distanceMeters = Math.round(
    haversineMeters(from, to) * ROUTING.fallbackRoadFactor,
  );
  return {
    distanceMeters,
    durationSeconds: Math.round(distanceMeters / ROUTING.fallbackSpeedMps),
    polyline: null,
  };
}

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
export const ROUTES_FIELD_MASK =
  "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline";
export const MATRIX_FIELD_MASK =
  "originIndex,destinationIndex,status,condition,duration,distanceMeters";

const seconds = (value: unknown) => {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(
    typeof value === "string" ? value : "",
  );
  return match ? Math.round(Number(match[1])) : null;
};

const latLng = (p: Point) => ({
  latLng: { latitude: p.latitude, longitude: p.longitude },
});

export function googleRoutesProvider(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): RoutingProvider {
  const post = async (
    url: string,
    fieldMask: string,
    body: unknown,
    timeoutMs: number,
  ) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new RoutingUnavailableError("Routes API unreachable");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new RoutingUnavailableError(`Routes API ${response.status}`);
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new RoutingUnavailableError("Routes API returned invalid JSON");
    }
  };

  return {
    source: "google_routes",
    async route(from, to) {
      const json = (await post(
        ROUTES_URL,
        ROUTES_FIELD_MASK,
        {
          origin: { location: latLng(from) },
          destination: { location: latLng(to) },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE",
        },
        ROUTING.routeTimeoutMs,
      )) as {
        routes?: {
          duration?: string;
          distanceMeters?: number;
          polyline?: { encodedPolyline?: string };
        }[];
      };
      const route = json?.routes?.[0];
      if (!route) return null;
      const duration = seconds(route.duration);
      if (duration === null || !Number.isFinite(route.distanceMeters ?? NaN)) {
        throw new RoutingUnavailableError(
          "Routes API returned an incomplete route",
        );
      }
      return {
        durationSeconds: duration,
        distanceMeters: Math.round(route.distanceMeters!),
        polyline: route.polyline?.encodedPolyline ?? null,
      };
    },
    async routeMatrix(origins, destination) {
      if (!origins.length) return [];
      if (origins.length > ROUTING.maxMatrixOrigins) {
        throw new Error("Too many matrix origins");
      }
      const json = await post(
        MATRIX_URL,
        MATRIX_FIELD_MASK,
        {
          origins: origins.map((p) => ({ waypoint: { location: latLng(p) } })),
          destinations: [{ waypoint: { location: latLng(destination) } }],
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE",
        },
        ROUTING.matrixTimeoutMs,
      );
      if (!Array.isArray(json)) {
        throw new RoutingUnavailableError("Route matrix returned no elements");
      }
      const elements: MatrixElement[] = [];
      for (const raw of json as {
        originIndex?: number;
        status?: { code?: number };
        condition?: string;
        duration?: string;
        distanceMeters?: number;
      }[]) {
        const originIndex = raw.originIndex ?? 0;
        if (
          !Number.isInteger(originIndex) ||
          originIndex < 0 ||
          originIndex >= origins.length
        ) {
          continue;
        }
        if (raw.status?.code) continue;
        const duration = seconds(raw.duration);
        const reachable = raw.condition === "ROUTE_EXISTS" && duration !== null;
        if (!reachable && raw.condition !== "ROUTE_NOT_FOUND") continue;
        elements.push({
          originIndex,
          reachable,
          durationSeconds: reachable ? duration : null,
          distanceMeters: reachable
            ? Math.round(raw.distanceMeters ?? 0)
            : null,
        });
      }
      return elements;
    },
  };
}

export function routingFromEnv(
  env: Record<string, string | undefined> = process.env,
): RoutingProvider | null {
  const key = env.GOOGLE_ROUTES_API_KEY?.trim();
  return key ? googleRoutesProvider(key) : null;
}
