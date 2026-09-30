import { computeFare, roundHalfUp } from "../../server/fares";
import { QUOTE } from "../../server/pricing";
import { createQuote } from "../../server/routes/quotes";
import { formatCents } from "../../shared/contracts";

import {
  call,
  createContext,
  DESTINATION,
  PICKUP,
  resetDb,
  TEST_POLICY,
  testDb,
  type TestContext,
} from "./helpers";

const db = testDb();
let ctx: TestContext;

beforeEach(async () => {
  await resetDb(db);
  ctx = createContext(db);
});
afterAll(() => db.end());

const USER = "user_quoter";

describe("POST /api/quotes", () => {
  it("prices the trip from the road route with the area's policy", async () => {
    const res = await call(ctx, createQuote, {
      user: USER,
      body: { pickup: PICKUP, destination: DESTINATION },
    });
    expect(res.status).toBe(201);
    const { quote, driversNearby } = res.json.data;
    expect(quote.fareCents).toBe(832);
    expect(quote.distanceMeters).toBe(3100);
    expect(quote.durationSeconds).toBe(420);
    expect(Number.isSafeInteger(quote.fareCents)).toBe(true);
    expect(quote.currency).toBe("usd");
    expect(new Date(quote.expiresAt).getTime()).toBe(
      ctx.clock.now.getTime() + QUOTE.ttlSeconds * 1000,
    );
    expect(driversNearby).toBe(0);
    expect(quote).not.toHaveProperty("driver");
    expect(ctx.routing.calls).toHaveLength(1);

    const { rows } = await db.query(
      `SELECT fare_cents, demo_driver_id, base_cents, distance_cents, time_cents,
              minimum_applied, route_source, pricing_version
         FROM mobility.quotes`,
    );
    expect(rows).toEqual([
      {
        fare_cents: 832,
        demo_driver_id: null,
        base_cents: 250,
        distance_cents: 372,
        time_cents: 210,
        minimum_applied: false,
        route_source: "test_provider",
        pricing_version: "test-sf/v1",
      },
    ]);
  });

  it("accepts valid zero coordinates and then applies the service-area rules", async () => {
    const res = await call(ctx, createQuote, {
      user: USER,
      body: {
        pickup: { address: "Null Island", latitude: 0, longitude: 0 },
        destination: { address: "Nearby", latitude: 0, longitude: 0.02 },
      },
    });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("PICKUP_OUTSIDE_SERVICE_AREA");
    expect(ctx.routing.calls).toHaveLength(0);
  });

  it.each([
    ["missing destination", { pickup: PICKUP }],
    [
      "latitude out of range",
      { pickup: { ...PICKUP, latitude: 91 }, destination: DESTINATION },
    ],
    [
      "longitude out of range",
      { pickup: PICKUP, destination: { ...DESTINATION, longitude: -181 } },
    ],
    [
      "string coordinates",
      { pickup: { ...PICKUP, latitude: "37.7" }, destination: DESTINATION },
    ],
    [
      "blank address",
      { pickup: { ...PICKUP, address: "   " }, destination: DESTINATION },
    ],
    [
      "client-supplied price",
      { pickup: PICKUP, destination: DESTINATION, price: "1.00" },
    ],
  ])("rejects %s with 400", async (_name, body) => {
    const res = await call(ctx, createQuote, { user: USER, body });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("INVALID_INPUT");
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.quotes",
    );
    expect(rows[0].n).toBe(0);
  });

  it("rejects identical pickup and destination without calling the routing provider", async () => {
    const res = await call(ctx, createQuote, {
      user: USER,
      body: {
        pickup: PICKUP,
        destination: { ...PICKUP, address: "Same place" },
      },
    });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("TRIP_TOO_SHORT");
    expect(ctx.routing.calls).toHaveLength(0);
  });

  it("rejects road routes beyond the service limit", async () => {
    ctx.routing.distanceMeters = QUOTE.maxTripMeters + 1;
    const res = await call(ctx, createQuote, {
      user: USER,
      body: { pickup: PICKUP, destination: DESTINATION },
    });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("TRIP_TOO_LONG");
  });

  it("rejects non-JSON, malformed JSON, and oversized bodies", async () => {
    const notJson = await call(ctx, createQuote, {
      user: USER,
      rawBody: "pickup=1",
      method: "POST",
      headers: { "content-type": "text/plain" },
    });
    expect(notJson.status).toBe(415);

    const malformed = await call(ctx, createQuote, {
      user: USER,
      rawBody: "{not json",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(malformed.status).toBe(400);
    expect(malformed.json.error.code).toBe("INVALID_JSON");

    const huge = await call(ctx, createQuote, {
      user: USER,
      body: {
        pickup: { ...PICKUP, address: "x".repeat(10_000) },
        destination: DESTINATION,
      },
    });
    expect(huge.status).toBe(413);
  });
});

describe("pricing and money", () => {
  it("rounds each component half up to whole cents and applies the minimum", () => {
    expect(roundHalfUp(5, 10)).toBe(1);
    expect(roundHalfUp(4, 10)).toBe(0);
    expect(roundHalfUp(15, 10)).toBe(2);
    expect(
      computeFare(TEST_POLICY, { distanceMeters: 1000, durationSeconds: 60 }),
    ).toEqual({
      baseCents: 250,
      distanceCents: 120,
      timeCents: 30,
      minimumApplied: true,
      totalCents: 500,
    });
    expect(
      computeFare(TEST_POLICY, {
        distanceMeters: 10_000,
        durationSeconds: 1200,
      }).totalCents,
    ).toBe(2050);
    expect(
      computeFare(
        { ...TEST_POLICY, per_km_cents: 125, per_minute_cents: 33 },
        { distanceMeters: 3004, durationSeconds: 421 },
      ),
    ).toEqual({
      baseCents: 250,
      distanceCents: 376,
      timeCents: 232,
      minimumApplied: false,
      totalCents: 858,
    });
  });

  it("formats cents without losing the decimal part", () => {
    expect(formatCents(1875)).toBe("$18.75");
    expect(formatCents(500)).toBe("$5.00");
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(7)).toBe("$0.07");
  });
});
