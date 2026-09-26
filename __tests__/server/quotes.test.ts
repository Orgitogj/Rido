import { estimateTrip, fareCents, PRICING } from "../../server/pricing";
import { createQuote } from "../../server/routes/quotes";
import { formatCents } from "../../shared/contracts";

import {
  call,
  createContext,
  DESTINATION,
  PICKUP,
  resetDb,
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
  it("returns one server-priced, integer-cent quote for the trip", async () => {
    const res = await call(ctx, createQuote, {
      user: USER,
      body: { pickup: PICKUP, destination: DESTINATION },
    });
    expect(res.status).toBe(201);
    const { quote, driversNearby } = res.json.data;
    const check = estimateTrip(PICKUP, DESTINATION);
    if (!check.ok) throw new Error("fixture trip should be valid");

    expect(quote.fareCents).toBe(fareCents(check.trip, 10_000));
    expect(Number.isSafeInteger(quote.fareCents)).toBe(true);
    expect(quote.currency).toBe("usd");
    expect(new Date(quote.expiresAt).getTime()).toBe(
      ctx.clock.now.getTime() + PRICING.quoteTtlSeconds * 1000,
    );
    expect(driversNearby).toBe(0);
    expect(quote).not.toHaveProperty("driver");

    const { rows } = await db.query(
      "SELECT fare_cents, demo_driver_id FROM mobility.quotes",
    );
    expect(rows).toEqual([
      { fare_cents: quote.fareCents, demo_driver_id: null },
    ]);
  });

  it("is deterministic: the same trip always gets the same price", async () => {
    const body = { pickup: PICKUP, destination: DESTINATION };
    const a = await call(ctx, createQuote, { user: USER, body });
    const b = await call(ctx, createQuote, { user: USER, body });
    expect(b.json.data.quote.fareCents).toBe(a.json.data.quote.fareCents);
  });

  it("accepts valid zero coordinates (equator / prime meridian)", async () => {
    const res = await call(ctx, createQuote, {
      user: USER,
      body: {
        pickup: { address: "Null Island", latitude: 0, longitude: 0 },
        destination: { address: "Nearby", latitude: 0, longitude: 0.02 },
      },
    });
    expect(res.status).toBe(201);
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

  it("rejects identical pickup and destination with 422", async () => {
    const res = await call(ctx, createQuote, {
      user: USER,
      body: {
        pickup: PICKUP,
        destination: { ...PICKUP, address: "Same place" },
      },
    });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("TRIP_TOO_SHORT");
  });

  it("rejects trips beyond the service limit with 422", async () => {
    const res = await call(ctx, createQuote, {
      user: USER,
      body: {
        pickup: PICKUP,
        destination: {
          address: "Los Angeles",
          latitude: 34.05,
          longitude: -118.24,
        },
      },
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
  it("computes integer cents and applies the minimum fare", () => {
    expect(
      fareCents({ distanceMeters: 1000, durationSeconds: 60 }, 10000),
    ).toBe(PRICING.minimumFareCents);
    expect(
      fareCents({ distanceMeters: 10_000, durationSeconds: 1200 }, 10000),
    ).toBe(2050);
    expect(
      fareCents({ distanceMeters: 10_000, durationSeconds: 1200 }, 11500),
    ).toBe(2358);
  });

  it("formats cents without losing the decimal part", () => {
    expect(formatCents(1875)).toBe("$18.75");
    expect(formatCents(500)).toBe("$5.00");
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(7)).toBe("$0.07");
  });
});
