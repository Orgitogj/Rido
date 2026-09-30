import {
  googleRoutesProvider,
  MATRIX_FIELD_MASK,
  ROUTES_FIELD_MASK,
  routingFromEnv,
  RoutingUnavailableError,
} from "../../server/routing";
import { reserveRouting } from "../../server/routingBudget";

import { resetDb, testDb } from "./helpers";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.end());

const A = { latitude: 37.7749, longitude: -122.4194 };
const B = { latitude: 37.7599, longitude: -122.4148 };

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("Compute Routes", () => {
  it("asks for a traffic-unaware drive with a narrow field mask", async () => {
    const f = fakeFetch(() =>
      json({
        routes: [
          {
            duration: "421s",
            distanceMeters: 3004,
            polyline: { encodedPolyline: "abc" },
          },
        ],
      }),
    );
    const provider = googleRoutesProvider("key", f.impl);
    expect(await provider.route(A, B)).toEqual({
      durationSeconds: 421,
      distanceMeters: 3004,
      polyline: "abc",
    });
    const { url, init } = f.calls[0];
    expect(url).toBe(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
    );
    expect(init.headers).toMatchObject({
      "X-Goog-Api-Key": "key",
      "X-Goog-FieldMask": ROUTES_FIELD_MASK,
    });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      origin: { location: { latLng: A } },
      destination: { location: { latLng: B } },
    });
  });

  it("returns null when Google finds no route", async () => {
    const provider = googleRoutesProvider(
      "key",
      fakeFetch(() => json({})).impl,
    );
    expect(await provider.route(A, B)).toBeNull();
  });

  it.each([
    ["a server error", () => json({ error: {} }, 500)],
    ["rate limiting", () => json({ error: {} }, 429)],
    ["an invalid body", () => new Response("not json", { status: 200 })],
    [
      "a route without a duration",
      () => json({ routes: [{ distanceMeters: 5 }] }),
    ],
  ])("treats %s as unavailable", async (_name, respond) => {
    const provider = googleRoutesProvider("key", fakeFetch(respond).impl);
    await expect(provider.route(A, B)).rejects.toBeInstanceOf(
      RoutingUnavailableError,
    );
  });

  it("treats a network failure or timeout as unavailable", async () => {
    const provider = googleRoutesProvider("key", (async () => {
      throw new Error("aborted");
    }) as unknown as typeof fetch);
    await expect(provider.route(A, B)).rejects.toBeInstanceOf(
      RoutingUnavailableError,
    );
  });

  it("is off without a key", () => {
    expect(routingFromEnv({})).toBeNull();
    expect(routingFromEnv({ GOOGLE_ROUTES_API_KEY: "k" })?.source).toBe(
      "google_routes",
    );
  });
});

describe("Compute Route Matrix", () => {
  it("parses reachable, unreachable and failed elements", async () => {
    const f = fakeFetch(() =>
      json([
        {
          originIndex: 1,
          destinationIndex: 0,
          condition: "ROUTE_EXISTS",
          duration: "300s",
          distanceMeters: 2000,
        },
        { originIndex: 0, destinationIndex: 0, condition: "ROUTE_NOT_FOUND" },
        { originIndex: 2, destinationIndex: 0, status: { code: 3 } },
        {
          originIndex: 9,
          destinationIndex: 0,
          condition: "ROUTE_EXISTS",
          duration: "1s",
        },
      ]),
    );
    const provider = googleRoutesProvider("key", f.impl);
    const elements = await provider.routeMatrix([A, B, A], B);
    expect(elements).toEqual([
      {
        originIndex: 1,
        reachable: true,
        durationSeconds: 300,
        distanceMeters: 2000,
      },
      {
        originIndex: 0,
        reachable: false,
        durationSeconds: null,
        distanceMeters: null,
      },
    ]);
    const { url, init } = f.calls[0];
    expect(url).toBe(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    );
    expect(init.headers).toMatchObject({
      "X-Goog-FieldMask": MATRIX_FIELD_MASK,
    });
    const body = JSON.parse(String(init.body));
    expect(body.origins).toHaveLength(3);
    expect(body.origins[0]).toEqual({ waypoint: { location: { latLng: A } } });
    expect(body.destinations).toEqual([
      { waypoint: { location: { latLng: B } } },
    ]);
    expect(body.routingPreference).toBe("TRAFFIC_UNAWARE");
  });

  it("refuses more than ten origins and skips empty requests without calling Google", async () => {
    const f = fakeFetch(() => json([]));
    const provider = googleRoutesProvider("key", f.impl);
    await expect(
      provider.routeMatrix(new Array(11).fill(A), B),
    ).rejects.toThrow(/Too many/);
    expect(await provider.routeMatrix([], B)).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });

  it("treats a non-array response as unavailable", async () => {
    const provider = googleRoutesProvider(
      "key",
      fakeFetch(() => json({ error: "x" })).impl,
    );
    await expect(provider.routeMatrix([A], B)).rejects.toBeInstanceOf(
      RoutingUnavailableError,
    );
  });
});

describe("routing budget", () => {
  it("caps units per minute for each API and resets the next minute", async () => {
    const limits = { routes: 2, route_matrix: 5 };
    const now = new Date("2026-01-01T10:00:30Z");
    expect(await reserveRouting(db, "routes", 1, now, limits)).toBe(true);
    expect(await reserveRouting(db, "routes", 1, now, limits)).toBe(true);
    expect(await reserveRouting(db, "routes", 1, now, limits)).toBe(false);
    expect(await reserveRouting(db, "route_matrix", 5, now, limits)).toBe(true);
    expect(await reserveRouting(db, "route_matrix", 1, now, limits)).toBe(
      false,
    );
    expect(await reserveRouting(db, "route_matrix", 6, now, limits)).toBe(
      false,
    );
    const next = new Date("2026-01-01T10:01:00Z");
    expect(await reserveRouting(db, "routes", 1, next, limits)).toBe(true);
  });
});
