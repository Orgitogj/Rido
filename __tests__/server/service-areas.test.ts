import { createQuote } from "../../server/routes/quotes";
import { createBooking } from "../../server/routes/rides";
import {
  cancelPolicy,
  createArea,
  createPolicy,
  getArea,
  listAreas,
  updateArea,
} from "../../server/routes/serviceAreas";
import {
  boundaryProblem,
  containsPoint,
  parseBoundary,
  type Vertex,
} from "../../shared/serviceArea";

import {
  call,
  createContext,
  DESTINATION,
  PICKUP,
  resetDb,
  testDb,
  type TestContext,
} from "./helpers";
import {
  adminGet,
  advanceClock,
  assertInvariants,
  assign,
  drive,
  makeOperator,
  onlineDriver,
  refresh,
} from "./scenario";

import type { ServiceAreaDetail } from "../../shared/adminPricing";

const db = testDb();
let ctx: TestContext;

beforeEach(async () => {
  await resetDb(db);
  ctx = createContext(db);
});
afterEach(() => assertInvariants(ctx));
afterAll(() => db.end());

const P = "user_passenger";
const D = "user_driver";
const OPS = "user_operator";
const OPS2 = "user_operator_two";
const SUPPORT = "user_support";
const MINUTE = 60;

const place = (latitude: number, longitude: number, address = "Somewhere") => ({
  address,
  latitude,
  longitude,
});

const quote = (
  pickup = PICKUP,
  destination: {
    address: string;
    latitude: number;
    longitude: number;
  } = DESTINATION,
  user = P,
) => call(ctx, createQuote, { user, body: { pickup, destination } });

const quoteCount = async () =>
  (
    await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM mobility.quotes",
    )
  ).rows[0].n;

async function testAreaId() {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM mobility.service_areas WHERE code = 'test-sf'",
  );
  return rows[0].id;
}

async function insertArea(
  code: string,
  boundary: Vertex[],
  opts: {
    dropoff?: "inside_area" | "anywhere";
    status?: string;
    rates?: number[];
  } = {},
) {
  const lats = boundary.map((v) => v[0]);
  const lngs = boundary.map((v) => v[1]);
  const [base, perKm, perMin, min] = opts.rates ?? [300, 150, 40, 600];
  const { rows } = await db.query<{ id: string }>(
    `WITH area AS (
       INSERT INTO mobility.service_areas
         (code, name, status, boundary, min_latitude, max_latitude, min_longitude,
          max_longitude, dropoff_rule, is_development, created_at, updated_at)
       VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, true, now(), now())
       RETURNING id)
     INSERT INTO mobility.fare_policies
       (service_area_id, version, label, base_cents, per_km_cents, per_minute_cents,
        minimum_fare_cents, effective_from, reason, created_at)
     SELECT id, 1, 'fixture', $9, $10, $11, $12, '2000-01-01', 'fixture', now() FROM area
     RETURNING service_area_id AS id`,
    [
      code,
      opts.status ?? "active",
      JSON.stringify(boundary),
      Math.min(...lats),
      Math.max(...lats),
      Math.min(...lngs),
      Math.max(...lngs),
      opts.dropoff ?? "inside_area",
      base,
      perKm,
      perMin,
      min,
    ],
  );
  return rows[0].id;
}

const L_SHAPE: Vertex[] = [
  [10, 10],
  [10, 10.1],
  [10.05, 10.1],
  [10.05, 10.05],
  [10.1, 10.05],
  [10.1, 10],
];

describe("service area geometry", () => {
  it("handles concave boundaries, edges and points just outside", () => {
    expect(containsPoint(L_SHAPE, { latitude: 10.02, longitude: 10.08 })).toBe(
      true,
    );
    expect(containsPoint(L_SHAPE, { latitude: 10.08, longitude: 10.02 })).toBe(
      true,
    );
    expect(containsPoint(L_SHAPE, { latitude: 10.08, longitude: 10.08 })).toBe(
      false,
    );
    expect(containsPoint(L_SHAPE, { latitude: 10, longitude: 10.05 })).toBe(
      true,
    );
    expect(containsPoint(L_SHAPE, { latitude: 9.9998, longitude: 10.05 })).toBe(
      false,
    );
  });

  it("rejects boundaries that can't describe a real area", () => {
    expect(boundaryProblem(L_SHAPE)).toBeNull();
    expect(
      boundaryProblem([
        [1, 1],
        [1, 2],
      ]),
    ).toBe("TOO_FEW_VERTICES");
    expect(
      boundaryProblem([
        [0, 0],
        [0.1, 0.1],
        [0, 0.1],
        [0.1, 0],
      ]),
    ).toBe("SELF_INTERSECTING");
    expect(
      boundaryProblem([
        [0, 0],
        [0, 0.1],
        [0, 0.2],
      ]),
    ).toBe("ZERO_AREA");
    expect(
      boundaryProblem([
        [0, 0],
        [0, 0.1],
        [0, 0],
      ]),
    ).toBe("DUPLICATE_VERTEX");
    expect(
      boundaryProblem([
        [0, 0],
        [0, 3],
        [3, 3],
        [3, 0],
      ]),
    ).toBe("TOO_LARGE");
    expect(
      boundaryProblem([
        [95, 0],
        [0, 1],
        [1, 1],
      ]),
    ).toBe("OUT_OF_RANGE");
    expect(parseBoundary("10, 10\n10,10.1\n10.05 10.1\n10, 10")).toEqual([
      [10, 10],
      [10, 10.1],
      [10.05, 10.1],
    ]);
    expect(parseBoundary("10, 10\nnot a point")).toBeNull();
  });
});

describe("service area rules on quotes", () => {
  it("refuses pickups and destinations outside coverage before routing", async () => {
    const outside = await quote(place(37.5, -122.4));
    expect(outside.status).toBe(422);
    expect(outside.json.error.code).toBe("PICKUP_OUTSIDE_SERVICE_AREA");
    const destination = await quote(PICKUP, place(37.5, -122.4));
    expect(destination.json.error.code).toBe(
      "DESTINATION_OUTSIDE_SERVICE_AREA",
    );
    expect(ctx.routing.calls).toHaveLength(0);
    expect(await quoteCount()).toBe(0);
  });

  it("allows drop-offs outside the area only when the area says so", async () => {
    await db.query(
      "UPDATE mobility.service_areas SET dropoff_rule = 'anywhere'",
    );
    const res = await quote(PICKUP, place(37.5, -122.4));
    expect(res.status).toBe(201);
  });

  it("never quotes from an inactive area or when no area exists", async () => {
    await db.query("UPDATE mobility.service_areas SET status = 'inactive'");
    expect((await quote()).json.error.code).toBe("PICKUP_OUTSIDE_SERVICE_AREA");
    await db.query("DELETE FROM mobility.fare_policies");
    await db.query("DELETE FROM mobility.service_areas");
    expect((await quote()).json.error.code).toBe("PICKUP_OUTSIDE_SERVICE_AREA");
  });

  it("uses the earliest overlapping area that allows the destination", async () => {
    await insertArea(
      "overlap-anywhere",
      [
        [37.7, -122.5],
        [37.7, -122.35],
        [37.85, -122.35],
        [37.85, -122.5],
      ],
      { dropoff: "anywhere" },
    );
    const inside = await quote();
    expect(inside.json.data.quote.fareCents).toBe(832);
    const far = await quote(PICKUP, place(37.5, -122.4));
    expect(far.status).toBe(201);
    const { rows } = await db.query(
      "SELECT pricing_version FROM mobility.quotes ORDER BY created_at, pricing_version",
    );
    expect(rows.map((r) => r.pricing_version).sort()).toEqual([
      "overlap-anywhere/v1",
      "test-sf/v1",
    ]);
  });

  it("refuses to quote an active area whose policy hasn't started yet", async () => {
    await db.query("UPDATE mobility.fare_policies SET effective_from = $1", [
      new Date(ctx.clock.now.getTime() + 3600_000),
    ]);
    const res = await quote();
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("PRICING_NOT_CONFIGURED");
  });
});

describe("road routing failures", () => {
  it("reports a missing drivable route without saving a quote", async () => {
    ctx.routing.noRoute = true;
    const res = await quote();
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("NO_ROUTE");
    expect(await quoteCount()).toBe(0);
  });

  it("asks the passenger to retry when the provider is down, and never falls back to a straight line", async () => {
    ctx.routing.fail = true;
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await quote();
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("ROUTING_UNAVAILABLE");
    expect(res.response.headers.get("Retry-After")).toBe("15");
    expect(await quoteCount()).toBe(0);
  });

  it("is unavailable, not guessed, without a routing key", async () => {
    ctx.deps.routing = null;
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await quote();
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("ROUTING_NOT_CONFIGURED");
  });

  it("stops calling the provider once the per-minute budget is used", async () => {
    const minute = new Date(ctx.clock.now);
    minute.setUTCSeconds(0, 0);
    await db.query(
      "INSERT INTO mobility.routing_usage (api, minute, units) VALUES ('routes', $1, 120)",
      [minute],
    );
    const res = await quote();
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("ROUTING_BUSY");
    expect(ctx.routing.calls).toHaveLength(0);
    advanceClock(ctx, MINUTE);
    expect((await quote()).status).toBe(201);
  });
});

describe("quote reuse, limits, expiry and duplicate bookings", () => {
  it("reuses an identical recent quote instead of calling the provider again", async () => {
    const first = await quote();
    const second = await quote();
    expect(second.status).toBe(200);
    expect(second.json.data.quote.id).toBe(first.json.data.quote.id);
    expect(ctx.routing.calls).toHaveLength(1);
    advanceClock(ctx, 2 * MINUTE);
    const third = await quote();
    expect(third.status).toBe(201);
    expect(third.json.data.quote.id).not.toBe(first.json.data.quote.id);
  });

  it("limits how many quotes one passenger can request", async () => {
    await quote();
    await db.query(
      `INSERT INTO mobility.quotes
         (user_id, pickup_address, pickup_latitude, pickup_longitude, destination_address,
          destination_latitude, destination_longitude, distance_meters, duration_seconds,
          fare_cents, pricing_version, expires_at, created_at)
       SELECT user_id, pickup_address, pickup_latitude, pickup_longitude, destination_address,
              destination_latitude, destination_longitude, distance_meters, duration_seconds,
              fare_cents, pricing_version, expires_at, created_at
         FROM mobility.quotes, generate_series(1, 29)`,
    );
    const res = await quote(PICKUP, { ...DESTINATION, latitude: 37.765 });
    expect(res.status).toBe(429);
    expect(res.json.error.code).toBe("RATE_LIMITED");
    expect((await quote(PICKUP, DESTINATION, "user_other")).status).toBe(201);
  });

  it("refuses an expired quote and books a quote only once", async () => {
    const q = (await quote()).json.data.quote;
    const a = await call(ctx, createBooking, {
      user: P,
      body: { quoteId: q.id },
    });
    const b = await call(ctx, createBooking, {
      user: P,
      body: { quoteId: q.id },
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.json.data.rideId).toBe(a.json.data.rideId);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.rides",
    );
    expect(rows[0].n).toBe(1);
    expect(ctx.stripe.intents.size).toBe(1);

    const later = (
      await quote(PICKUP, { ...DESTINATION, latitude: 37.765 }, "user_late")
    ).json.data.quote;
    advanceClock(ctx, 11 * MINUTE);
    const expired = await call(ctx, createBooking, {
      user: "user_late",
      body: { quoteId: later.id },
    });
    expect(expired.status).toBe(410);
    expect(expired.json.error.code).toBe("QUOTE_EXPIRED");
  });

  it("stops new bookings in a deactivated area but lets rides already requested finish", async () => {
    await onlineDriver(ctx, D, 500);
    const running = (await quote()).json.data.quote;
    const booked = await call(ctx, createBooking, {
      user: P,
      body: { quoteId: running.id },
    });
    const rideId = booked.json.data.rideId;
    ctx.stripe.authorize([...ctx.stripe.intents.keys()][0]);
    await refresh(ctx, P, rideId);
    await assign(ctx, D, rideId);

    const pending = (await quote(PICKUP, DESTINATION, "user_second")).json.data
      .quote;
    await db.query("UPDATE mobility.service_areas SET status = 'inactive'");
    const refused = await call(ctx, createBooking, {
      user: "user_second",
      body: { quoteId: pending.id },
    });
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe("SERVICE_AREA_UNAVAILABLE");

    await drive(ctx, D, rideId);
    const { rows } = await db.query(
      "SELECT status, fare_cents FROM mobility.rides WHERE id = $1",
      [rideId],
    );
    expect(rows[0]).toEqual({ status: "completed", fare_cents: 832 });
  });
});

describe("fare policy changes", () => {
  it("applies a scheduled policy only from its effective date and never reprices earlier quotes or rides", async () => {
    await makeOperator(ctx, OPS, "view,configure");
    const areaId = await testAreaId();
    const effective = new Date(ctx.clock.now.getTime() + 5 * MINUTE * 1000);
    const scheduled = await call(ctx, createPolicy, {
      user: OPS,
      params: { id: areaId },
      body: {
        label: "Development policy v2",
        isDevelopment: true,
        baseCents: 400,
        perKmCents: 200,
        perMinuteCents: 50,
        minimumFareCents: 800,
        effectiveFrom: effective.toISOString(),
        reason: "Test rate change",
      },
    });
    expect(scheduled.status).toBe(201);
    const policies = (scheduled.json.data as ServiceAreaDetail).policies;
    expect(policies.map((p) => [p.version, p.state])).toEqual([
      [2, "scheduled"],
      [1, "in_effect"],
    ]);

    const before = (await quote()).json.data.quote;
    expect(before.fareCents).toBe(832);

    advanceClock(ctx, 4 * MINUTE);
    const booked = await call(ctx, createBooking, {
      user: P,
      body: { quoteId: before.id },
    });
    expect(booked.status).toBe(201);
    expect(booked.json.data.fareCents).toBe(832);

    advanceClock(ctx, 2 * MINUTE);
    const after = (await quote(PICKUP, DESTINATION, "user_after")).json.data
      .quote;
    expect(after.fareCents).toBe(400 + 620 + 350);

    const { rows } = await db.query(
      `SELECT r.fare_cents, r.pricing_version, fp.version
         FROM mobility.rides r JOIN mobility.fare_policies fp ON fp.id = r.fare_policy_id`,
    );
    expect(rows).toEqual([
      { fare_cents: 832, pricing_version: "test-sf/v1", version: 1 },
    ]);
    const intent = [...ctx.stripe.intents.values()][0];
    expect(intent.amount).toBe(832);
  });

  it("requires a future effective date, and only scheduled versions can be cancelled", async () => {
    await makeOperator(ctx, OPS, "view,configure");
    const areaId = await testAreaId();
    const body = (effectiveFrom: string) => ({
      label: "Changed",
      isDevelopment: true,
      baseCents: 100,
      perKmCents: 100,
      perMinuteCents: 10,
      minimumFareCents: 500,
      effectiveFrom,
      reason: "Testing effective dates",
    });
    const past = await call(ctx, createPolicy, {
      user: OPS,
      params: { id: areaId },
      body: body(new Date(ctx.clock.now.getTime() - 3600_000).toISOString()),
    });
    expect(past.status).toBe(422);
    expect(past.json.error.code).toBe("EFFECTIVE_DATE_IN_PAST");

    const future = await call(ctx, createPolicy, {
      user: OPS,
      params: { id: areaId },
      body: body(new Date(ctx.clock.now.getTime() + 3600_000).toISOString()),
    });
    const v2 = (future.json.data as ServiceAreaDetail).policies[0];
    const v1 = (future.json.data as ServiceAreaDetail).policies[1];
    const cancelV1 = await call(ctx, cancelPolicy, {
      user: OPS,
      params: { id: areaId, policyId: v1.id },
      body: { reason: "Should not work" },
    });
    expect(cancelV1.status).toBe(409);
    expect(cancelV1.json.error.code).toBe("POLICY_ALREADY_EFFECTIVE");
    const cancelV2 = await call(ctx, cancelPolicy, {
      user: OPS,
      params: { id: areaId, policyId: v2.id },
      body: { reason: "Changed our mind" },
    });
    expect(cancelV2.status).toBe(200);
    advanceClock(ctx, 2 * 3600);
    expect((await quote()).json.data.quote.fareCents).toBe(832);

    const { rows } = await db.query(
      "SELECT action, result FROM mobility.audit_log WHERE action LIKE 'fare_policy_%' ORDER BY id",
    );
    expect(rows).toEqual([
      { action: "fare_policy_create", result: "failed" },
      { action: "fare_policy_create", result: "succeeded" },
      { action: "fare_policy_cancel", result: "failed" },
      { action: "fare_policy_cancel", result: "succeeded" },
    ]);
  });

  it("numbers concurrent policy versions without gaps or duplicates", async () => {
    await makeOperator(ctx, OPS, "view,configure");
    await makeOperator(ctx, OPS2, "view,configure");
    const areaId = await testAreaId();
    const create = (user: string, label: string) =>
      call(ctx, createPolicy, {
        user,
        params: { id: areaId },
        body: {
          label,
          isDevelopment: true,
          baseCents: 300,
          perKmCents: 100,
          perMinuteCents: 20,
          minimumFareCents: 500,
          effectiveFrom: new Date(
            ctx.clock.now.getTime() + 3600_000,
          ).toISOString(),
          reason: "Concurrent test",
        },
      });
    const results = await Promise.all([
      create(OPS, "Version A"),
      create(OPS2, "Version B"),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const { rows } = await db.query(
      "SELECT version FROM mobility.fare_policies WHERE service_area_id = $1 ORDER BY version",
      [areaId],
    );
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
  });
});

describe("operator workflow", () => {
  const boundary: Vertex[] = [
    [41.3, 19.78],
    [41.3, 19.84],
    [41.35, 19.84],
    [41.35, 19.78],
  ];

  it("is limited to operators with the configure permission, and refusals are audited", async () => {
    await makeOperator(ctx, SUPPORT, "view,support,refund");
    for (const user of [P, SUPPORT]) {
      expect((await adminGet(ctx, user, listAreas)).status).toBe(403);
      const res = await call(ctx, createArea, {
        user,
        body: {
          code: "x-area",
          name: "X",
          boundary,
          dropoffRule: "inside_area",
          isDevelopment: true,
          reason: "trying",
        },
      });
      expect(res.status).toBe(403);
    }
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.audit_log WHERE target_type = 'service_area' AND result = 'denied'",
    );
    expect(rows[0].n).toBe(4);
  });

  it("creates areas inactive, validates boundaries, and activates only with a policy", async () => {
    await makeOperator(ctx, OPS, "view,configure");
    const bad = await call(ctx, createArea, {
      user: OPS,
      body: {
        code: "bow-tie",
        name: "Bow tie",
        boundary: [
          [41.3, 19.78],
          [41.35, 19.84],
          [41.3, 19.84],
          [41.35, 19.78],
        ],
        dropoffRule: "inside_area",
        isDevelopment: true,
        reason: "Invalid shape",
      },
    });
    expect(bad.status).toBe(422);
    expect(bad.json.error.code).toBe("BOUNDARY_SELF_INTERSECTING");

    const created = await call(ctx, createArea, {
      user: OPS,
      body: {
        code: "dev-small",
        name: "Small development area",
        boundary,
        dropoffRule: "inside_area",
        isDevelopment: true,
        reason: "Device testing",
      },
    });
    expect(created.status).toBe(201);
    const area = created.json.data as ServiceAreaDetail;
    expect(area.status).toBe("inactive");
    const dup = await call(ctx, createArea, {
      user: OPS,
      body: {
        code: "dev-small",
        name: "Again",
        boundary,
        dropoffRule: "inside_area",
        isDevelopment: true,
        reason: "Duplicate",
      },
    });
    expect(dup.status).toBe(409);

    const activate = (version: number) =>
      call(ctx, updateArea, {
        method: "PATCH",
        user: OPS,
        params: { id: area.id },
        body: {
          status: "active",
          expectedVersion: version,
          reason: "Go live for testing",
        },
      });
    const early = await activate(area.version);
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe("NO_FARE_POLICY");

    await call(ctx, createPolicy, {
      user: OPS,
      params: { id: area.id },
      body: {
        label: "Development policy",
        isDevelopment: true,
        baseCents: 200,
        perKmCents: 100,
        perMinuteCents: 20,
        minimumFareCents: 400,
        effectiveFrom: ctx.clock.now.toISOString(),
        reason: "Placeholder rates",
      },
    });
    const live = await activate(area.version);
    expect(live.status).toBe(200);
    const detail = (
      await adminGet(ctx, OPS, getArea, { params: { id: area.id } })
    ).json.data as ServiceAreaDetail;
    expect(detail.status).toBe("active");
    expect(detail.policies[0].state).toBe("in_effect");
    expect(detail.history.map((h) => h.action)).toEqual([
      "updated:activated",
      "fare_policy_created",
      "created",
    ]);
    expect(detail.history.every((h) => h.reason)).toBe(true);

    const res = await quote(
      place(41.32, 19.8, "Development pickup"),
      place(41.33, 19.82, "Development drop-off"),
    );
    expect(res.status).toBe(201);
    expect(res.json.data.quote.fareCents).toBe(200 + 310 + 140);
  });

  it("lets only one of two concurrent edits win", async () => {
    await makeOperator(ctx, OPS, "view,configure");
    await makeOperator(ctx, OPS2, "view,configure");
    const areaId = await testAreaId();
    const edit = (user: string, name: string) =>
      call(ctx, updateArea, {
        method: "PATCH",
        user,
        params: { id: areaId },
        body: { name, expectedVersion: 1, reason: "Rename" },
      });
    const results = await Promise.all([
      edit(OPS, "First"),
      edit(OPS2, "Second"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.json.error.code).toBe("VERSION_CONFLICT");
  });

  it("shrinking an area affects only new quotes", async () => {
    await makeOperator(ctx, OPS, "view,configure");
    const areaId = await testAreaId();
    const q = (await quote()).json.data.quote;
    const shrunk = await call(ctx, updateArea, {
      method: "PATCH",
      user: OPS,
      params: { id: areaId },
      body: {
        boundary: [
          [37.8, -122.6],
          [37.8, -122.3],
          [37.95, -122.3],
          [37.95, -122.6],
        ],
        expectedVersion: 1,
        reason: "Shrink to the north",
      },
    });
    expect(shrunk.status).toBe(200);
    expect((await quote(PICKUP, DESTINATION, "user_new")).json.error.code).toBe(
      "PICKUP_OUTSIDE_SERVICE_AREA",
    );
    const booked = await call(ctx, createBooking, {
      user: P,
      body: { quoteId: q.id },
    });
    expect(booked.status).toBe(201);
    expect(booked.json.data.fareCents).toBe(832);
  });
});
