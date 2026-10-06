import { rideDetail } from "../../server/routes/admin";
import { applyToDrive } from "../../server/routes/driver";
import {
  createQuote,
  listCategoryAvailability,
} from "../../server/routes/quotes";
import { listDriverTrips } from "../../server/routes/receipts";
import { createBooking, reachStop } from "../../server/routes/rides";
import { createShare, viewShare } from "../../server/routes/safety";
import { createPolicy } from "../../server/routes/serviceAreas";
import {
  createVehicleCategory,
  listVehicleCategories,
  updateVehicleCategory,
} from "../../server/routes/vehicleCategories";
import { DEFAULT_VEHICLE_CATEGORY_ID } from "../../shared/vehicleCategory";

import {
  call,
  createContext,
  DESTINATION,
  PICKUP,
  pointKey,
  resetDb,
  TEST_POLICY,
  testDb,
  type TestContext,
} from "./helpers";
import {
  admin,
  adminGet,
  adminPost,
  assertInvariants,
  dashboard,
  decline,
  drive,
  goOnline,
  interrupt,
  makeOperator,
  onlineDriver,
  receipt,
  refresh,
  setStatus,
  viewRide,
  watch,
  accept,
} from "./scenario";

import type { Receipt, RideView } from "../../shared/contracts";
import type {
  CategoryAvailability,
  VehicleCategoryAdmin,
} from "../../shared/vehicleCategory";

const db = testDb();
let ctx: TestContext;

beforeEach(async () => {
  await resetDb(db);
  ctx = createContext(db);
});
afterEach(() => assertInvariants(ctx));
afterAll(() => db.end());

const P = "user_passenger";
const A = "user_driver_a";
const B = "user_driver_b";
const OPS = "user_operator";
const VIEW = "user_viewer";

const STOP_1 = {
  address: "Valencia St, San Francisco",
  latitude: 37.7689,
  longitude: -122.4219,
};
const STOP_2 = {
  address: "Dolores Park, San Francisco",
  latitude: 37.7596,
  longitude: -122.4269,
};

const areaId = async () =>
  (await db.query<{ id: string }>("SELECT id FROM mobility.service_areas"))
    .rows[0].id;

async function makeCategory(
  code: string,
  capacity: number,
  opts: { active?: boolean; priced?: boolean } = {},
) {
  const created = await adminPost(
    ctx,
    OPS,
    createVehicleCategory,
    {},
    {
      code,
      name: `Example ${code} (development)`,
      description: "Development example only",
      capacity,
      isDevelopment: true,
      reason: "Test fixture",
    },
  );
  expect(created.status).toBe(201);
  const row = (created.json.data as VehicleCategoryAdmin[]).find(
    (c) => c.code === code,
  )!;
  if (opts.active !== false) {
    const res = await call(ctx, updateVehicleCategory, {
      method: "PATCH",
      user: OPS,
      params: { id: row.id },
      body: {
        status: "active",
        expectedVersion: row.version,
        reason: "Enable",
      },
    });
    expect(res.status).toBe(200);
  }
  if (opts.priced !== false) {
    const policy = await adminPost(
      ctx,
      OPS,
      createPolicy,
      { id: await areaId() },
      {
        label: `Policy for ${code}`,
        isDevelopment: true,
        baseCents: 400,
        perKmCents: 200,
        perMinuteCents: 40,
        minimumFareCents: 800,
        effectiveFrom: ctx.clock.now.toISOString(),
        vehicleCategoryId: row.id,
        reason: "Test fixture",
      },
    );
    expect(policy.status).toBe(201);
  }
  return row.id;
}

async function driverWith(
  clerkId: string,
  seats: number,
  categories: string[],
  meters: number,
) {
  const created = await call(ctx, applyToDrive, {
    user: clerkId,
    body: {
      displayName: `Driver ${clerkId}`,
      vehicleMake: "Toyota",
      vehicleModel: "Sienna",
      vehiclePlate: clerkId
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(-8)
        .toUpperCase(),
      vehicleSeats: seats,
      vehicleColor: "Silver",
    },
  });
  expect(created.status).toBe(201);
  await admin.setDriverStatus(ctx.db, clerkId, "approved", {
    waiveDocuments: true,
    categories,
    reason: "test fixture",
  });
  expect((await goOnline(ctx, clerkId, meters)).status).toBe(200);
}

const quote = (body: object, user = P) =>
  call(ctx, createQuote, {
    user,
    body: { pickup: PICKUP, destination: DESTINATION, ...body },
  });

async function book(body: object, user = P) {
  const q = await quote(body, user);
  expect(q.status).toBe(201);
  const booking = await call(ctx, createBooking, {
    user,
    body: { quoteId: q.json.data.quote.id },
  });
  expect(booking.status).toBe(201);
  const rideId = booking.json.data.rideId as string;
  const intent = [...ctx.stripe.intents.values()].find(
    (i) => i.metadata.ride_id === rideId,
  )!;
  ctx.stripe.authorize(intent.id);
  const view = await refresh(ctx, user, rideId);
  return { rideId, intentId: intent.id, view, quote: q.json.data.quote };
}

describe("vehicle category administration", () => {
  it("needs the configure permission, validates input and keeps a history", async () => {
    await makeOperator(ctx, OPS, "view,configure");
    await makeOperator(ctx, VIEW, "view");
    const body = {
      code: "example-large",
      name: "Example large (development)",
      description: "Development example only",
      capacity: 6,
      isDevelopment: true,
      reason: "Trying categories",
    };
    expect(
      (await adminPost(ctx, VIEW, createVehicleCategory, {}, body)).status,
    ).toBe(403);
    expect(
      (await adminPost(ctx, P, createVehicleCategory, {}, body)).status,
    ).toBe(403);
    expect((await adminGet(ctx, VIEW, listVehicleCategories)).status).toBe(403);
    for (const bad of [
      { ...body, capacity: 0 },
      { ...body, capacity: 9 },
      { ...body, code: "Bad Code" },
      { ...body, name: "<b>x</b>" },
      { ...body, reason: "" },
      { ...body, perKmCents: 100 },
    ]) {
      expect(
        (await adminPost(ctx, OPS, createVehicleCategory, {}, bad)).status,
      ).toBe(400);
    }
    const created = await adminPost(ctx, OPS, createVehicleCategory, {}, body);
    expect(created.status).toBe(201);
    const list = created.json.data as VehicleCategoryAdmin[];
    expect(list.map((c) => c.code)).toEqual(["general", "example-large"]);
    const row = list[1];
    expect(row).toMatchObject({
      status: "inactive",
      isDefault: false,
      version: 1,
    });
    expect(
      (await adminPost(ctx, OPS, createVehicleCategory, {}, body)).status,
    ).toBe(409);

    const patch = (expectedVersion: number, change: object) =>
      call(ctx, updateVehicleCategory, {
        method: "PATCH",
        user: OPS,
        params: { id: row.id },
        body: { expectedVersion, reason: "Adjust", ...change },
      });
    expect((await patch(1, { status: "active" })).status).toBe(200);
    expect((await patch(1, { capacity: 5 })).status).toBe(409);
    expect((await patch(2, {})).status).toBe(400);
    const updated = (await patch(2, { capacity: 5 })).json
      .data as VehicleCategoryAdmin[];
    const after = updated.find((c) => c.id === row.id)!;
    expect(after).toMatchObject({ capacity: 5, status: "active", version: 3 });
    expect(after.history.map((h) => h.action)).toEqual([
      "updated",
      "activated",
      "created",
    ]);
    const { rows: audit } = await db.query<{ action: string; result: string }>(
      "SELECT action, result FROM mobility.audit_log WHERE target_type = 'vehicle_category' ORDER BY id",
    );
    expect(
      audit.filter((a) => a.result === "denied").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      audit.filter((a) => a.result === "succeeded").map((a) => a.action),
    ).toEqual([
      "vehicle_category_create",
      "vehicle_category_update",
      "vehicle_category_update",
    ]);
  });
});

describe("quoting by category and passenger count", () => {
  beforeEach(() => makeOperator(ctx, OPS, "view,configure"));

  it("uses the default category when none is given and snapshots it on the quote and ride", async () => {
    await onlineDriver(ctx, A);
    const { rideId, quote: q } = await book({});
    expect(q.category).toEqual({
      id: DEFAULT_VEHICLE_CATEGORY_ID,
      name: "Standard",
    });
    expect(q.passengerCount).toBe(1);
    await db.query(
      "UPDATE mobility.vehicle_categories SET name = 'Renamed' WHERE is_default",
    );
    const view = (await viewRide(ctx, P, rideId)).json.data as RideView;
    expect(view.category).toEqual({
      id: DEFAULT_VEHICLE_CATEGORY_ID,
      name: "Standard",
    });
    expect(view.passengerCount).toBe(1);
  });

  it("prices each category with its own policy and refuses unpriced, inactive or unknown categories", async () => {
    const large = await makeCategory("example-large", 6, { priced: false });
    const unpriced = await quote({ categoryId: large });
    expect(unpriced.status).toBe(503);
    expect(unpriced.json.error.code).toBe("PRICING_NOT_CONFIGURED");
    expect(ctx.routing.calls).toHaveLength(0);

    await adminPost(
      ctx,
      OPS,
      createPolicy,
      { id: await areaId() },
      {
        label: "Large policy",
        isDevelopment: true,
        baseCents: 400,
        perKmCents: 200,
        perMinuteCents: 40,
        minimumFareCents: 800,
        effectiveFrom: ctx.clock.now.toISOString(),
        vehicleCategoryId: large,
        reason: "Test fixture",
      },
    );
    const standard = await quote({ categoryId: DEFAULT_VEHICLE_CATEGORY_ID });
    const big = await quote({ categoryId: large, passengerCount: 5 });
    expect(standard.status).toBe(201);
    expect(big.status).toBe(201);
    const km = ctx.routing.distanceMeters / 1000;
    const min = ctx.routing.durationSeconds / 60;
    expect(standard.json.data.quote.fareCents).toBe(
      Math.max(
        TEST_POLICY.minimum_fare_cents,
        TEST_POLICY.base_cents +
          Math.round(km * TEST_POLICY.per_km_cents) +
          Math.round(min * TEST_POLICY.per_minute_cents),
      ),
    );
    expect(big.json.data.quote.fareCents).toBe(
      400 + Math.round(km * 200) + Math.round(min * 40),
    );
    expect(big.json.data.quote).toMatchObject({
      passengerCount: 5,
      category: { id: large },
    });

    const tooMany = await quote({
      categoryId: DEFAULT_VEHICLE_CATEGORY_ID,
      passengerCount: 5,
    });
    expect(tooMany.status).toBe(422);
    expect(tooMany.json.error.code).toBe("TOO_MANY_PASSENGERS");
    expect((await quote({ passengerCount: 9 })).status).toBe(400);
    expect((await quote({ passengerCount: 0 })).status).toBe(400);
    const unknown = await quote({
      categoryId: "3f2c1a54-9b1d-4c7e-8a2f-0d9e6b7c5a41",
    });
    expect(unknown.status).toBe(422);
    expect(unknown.json.error.code).toBe("CATEGORY_UNAVAILABLE");

    const inactive = await makeCategory("example-van", 8, { active: false });
    const off = await quote({ categoryId: inactive });
    expect(off.status).toBe(422);
    expect(off.json.error.code).toBe("CATEGORY_UNAVAILABLE");
  });

  it("blocks new requests when a category is deactivated but lets an active ride finish", async () => {
    const large = await makeCategory("example-large", 6);
    await driverWith(A, 6, ["general", "example-large"], 400);
    const { rideId } = await book({ categoryId: large, passengerCount: 5 });
    const pending = await quote({ categoryId: large, passengerCount: 2 });
    expect(pending.status).toBe(201);

    const { rows } = await db.query<{ version: number }>(
      "SELECT version FROM mobility.vehicle_categories WHERE id = $1",
      [large],
    );
    expect(
      (
        await call(ctx, updateVehicleCategory, {
          method: "PATCH",
          user: OPS,
          params: { id: large },
          body: {
            status: "inactive",
            expectedVersion: rows[0].version,
            reason: "Pause",
          },
        })
      ).status,
    ).toBe(200);

    expect((await quote({ categoryId: large })).status).toBe(422);
    const dash = await dashboard(ctx, A);
    expect(dash.offer?.rideId).toBe(rideId);
    expect(dash.offer).toMatchObject({ passengerCount: 5, stopCount: 0 });
    expect((await accept(ctx, A, dash.offer!.id)).status).toBe(200);
    await drive(ctx, A, rideId);
    expect(
      ((await viewRide(ctx, P, rideId)).json.data as RideView).status,
    ).toBe("completed");

    const late = await call(ctx, createBooking, {
      user: P,
      body: { quoteId: pending.json.data.quote.id },
    });
    expect(late.status).toBe(409);
    expect(late.json.error.code).toBe("CATEGORY_UNAVAILABLE");
  });

  it("reports availability per category from drivers actually online, without promising one", async () => {
    const large = await makeCategory("example-large", 6);
    await makeCategory("example-unpriced", 4, { priced: false });
    await driverWith(A, 4, ["general"], 400);
    await driverWith(B, 6, ["general", "example-large"], 900);
    const availability = async (passengers: number) =>
      (
        await call(ctx, listCategoryAvailability, {
          user: P,
          url: `http://localhost/api/categories?latitude=${PICKUP.latitude}&longitude=${PICKUP.longitude}&passengers=${passengers}`,
        })
      ).json.data as CategoryAvailability;
    const one = await availability(1);
    expect(one.categories.map((c) => [c.id, c.driversNearby])).toEqual([
      [DEFAULT_VEHICLE_CATEGORY_ID, 2],
      [large, 1],
    ]);
    const five = await availability(5);
    expect(five.categories.map((c) => [c.id, c.driversNearby])).toEqual([
      [large, 1],
    ]);
    const outside = await call(ctx, listCategoryAvailability, {
      user: P,
      url: "http://localhost/api/categories?latitude=10&longitude=10",
    });
    expect(outside.json.data.categories).toEqual([]);
    expect(
      (
        await call(ctx, listCategoryAvailability, {
          url: `http://localhost/api/categories?latitude=1&longitude=1`,
        })
      ).status,
    ).toBe(401);
  });
});

describe("matching by category and capacity", () => {
  beforeEach(() => makeOperator(ctx, OPS, "view,configure"));

  it("offers a ride only to vehicles authorised for its category with enough seats", async () => {
    const large = await makeCategory("example-large", 6);
    await driverWith(A, 4, ["general"], 200);
    await driverWith(B, 6, ["general", "example-large"], 2500);

    const { rideId } = await book({ categoryId: large, passengerCount: 5 });
    expect((await dashboard(ctx, A)).offer).toBeNull();
    const offer = (await dashboard(ctx, B)).offer!;
    expect(offer.rideId).toBe(rideId);
    expect(offer.categoryName).toBe("Example example-large (development)");

    expect((await decline(ctx, B, offer.id)).status).toBe(200);
    expect((await dashboard(ctx, A)).offer).toBeNull();
    const { rows } = await db.query<{ driver: string }>(
      `SELECT u.clerk_id AS driver FROM mobility.ride_offers o
         JOIN mobility.driver_profiles dp ON dp.id = o.driver_profile_id
         JOIN mobility.users u ON u.id = dp.user_id WHERE o.ride_id = $1`,
      [rideId],
    );
    expect(rows.map((r) => r.driver)).toEqual([B]);
  });

  it("skips vehicles with too few seats even inside the category", async () => {
    await driverWith(A, 3, ["general"], 200);
    await driverWith(B, 4, ["general"], 2500);
    const { rideId } = await book({ passengerCount: 4 });
    expect((await dashboard(ctx, A)).offer).toBeNull();
    expect((await dashboard(ctx, B)).offer?.rideId).toBe(rideId);
  });

  it("gives no offers to an approved driver whose categories were all removed, and refuses a stale accept", async () => {
    await driverWith(A, 4, ["general"], 200);
    const { rideId } = await book({});
    const offer = (await dashboard(ctx, A)).offer!;
    expect(offer.rideId).toBe(rideId);
    await db.query("DELETE FROM mobility.driver_vehicle_categories");
    const stale = await accept(ctx, A, offer.id);
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("OFFER_UNAVAILABLE");
    const view = (await viewRide(ctx, P, rideId)).json.data as RideView;
    expect(view.driver).toBeNull();
  });
});

describe("multiple stops", () => {
  it("routes through the stops in order and prices one fare for the whole itinerary", async () => {
    const q = await quote({ stops: [STOP_1, STOP_2] });
    expect(q.status).toBe(201);
    expect(ctx.routing.calls).toHaveLength(1);
    expect(ctx.routing.calls[0].via.map(pointKey)).toEqual([
      pointKey(STOP_1),
      pointKey(STOP_2),
    ]);
    expect(q.json.data.quote.stops).toEqual([STOP_1, STOP_2]);
    expect(q.json.data.quote.distanceMeters).toBe(
      ctx.routing.distanceMeters * 3,
    );
    const direct = await quote({});
    expect(direct.json.data.quote.fareCents).toBeLessThan(
      q.json.data.quote.fareCents,
    );
    const reversed = await quote({ stops: [STOP_2, STOP_1] });
    expect(reversed.json.data.quote.id).not.toBe(q.json.data.quote.id);
    const same = await quote({ stops: [STOP_1, STOP_2] });
    expect(same.status).toBe(200);
    expect(same.json.data.quote.id).toBe(q.json.data.quote.id);
  });

  it("validates every stop and applies the service-area rule to each", async () => {
    expect((await quote({ stops: [STOP_1, STOP_2, STOP_1] })).status).toBe(400);
    expect(
      (await quote({ stops: [{ ...STOP_1, latitude: 120 }] })).status,
    ).toBe(400);
    expect(
      (await quote({ stops: [{ address: "", latitude: 1, longitude: 1 }] }))
        .status,
    ).toBe(400);
    const outside = await quote({
      stops: [{ address: "Oakland", latitude: 37.8044, longitude: -122.2712 }],
    });
    expect(outside.status).toBe(422);
    expect(outside.json.error.code).toBe("STOP_OUTSIDE_SERVICE_AREA");
    const duplicate = await quote({
      stops: [{ ...PICKUP, address: "Same as pickup" }],
    });
    expect(duplicate.status).toBe(422);
    expect(duplicate.json.error.code).toBe("STOPS_TOO_CLOSE");
    expect(ctx.routing.calls).toHaveLength(0);

    await db.query(
      "UPDATE mobility.service_areas SET dropoff_rule = 'anywhere'",
    );
    expect(
      (
        await quote({
          stops: [
            { address: "Oakland", latitude: 37.8044, longitude: -122.2712 },
          ],
        })
      ).status,
    ).toBe(201);
  });

  it("explains an unreachable leg and a provider failure without guessing a price", async () => {
    ctx.routing.unreachable.add(pointKey(STOP_1));
    const unreachable = await quote({ stops: [STOP_1] });
    expect(unreachable.status).toBe(422);
    expect(unreachable.json.error.code).toBe("NO_ROUTE");
    expect(unreachable.json.error.message).toMatch(/stop/);
    ctx.routing.unreachable.clear();
    ctx.routing.fail = true;
    const down = await quote({ stops: [STOP_1] });
    expect(down.status).toBe(503);
    expect(down.json.error.code).toBe("ROUTING_UNAVAILABLE");
    const { rows } = await db.query("SELECT 1 FROM mobility.quotes");
    expect(rows).toEqual([]);
  });

  it("makes the driver pass each stop in order before completing, and captures once", async () => {
    await onlineDriver(ctx, A);
    const {
      rideId,
      intentId,
      quote: q,
    } = await book({ stops: [STOP_1, STOP_2] });
    const offer = (await dashboard(ctx, A)).offer!;
    expect(offer.stopCount).toBe(2);
    await accept(ctx, A, offer.id);
    await drive(ctx, A, rideId, "in_progress");

    const driverView = (await viewRide(ctx, A, rideId)).json.data as RideView;
    expect(driverView.stops).toEqual([STOP_1, STOP_2]);
    expect(driverView.allowedActions).toEqual(["stop_reached", "interrupt"]);
    const early = await setStatus(ctx, A, rideId, "completed");
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe("STOPS_REMAINING");

    const reach = (user: string, index: number) =>
      call(ctx, reachStop, { user, params: { id: rideId }, body: { index } });
    expect((await reach(P, 0)).status).toBe(403);
    expect((await reach(B, 0)).status).toBe(404);
    const skip = await reach(A, 1);
    expect(skip.status).toBe(409);
    expect(skip.json.error.code).toBe("STOP_OUT_OF_ORDER");
    expect((await reach(A, 2)).status).toBe(400);

    const [first, again] = await Promise.all([reach(A, 0), reach(A, 0)]);
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(
      ((await viewRide(ctx, P, rideId)).json.data as RideView).stopsCompleted,
    ).toBe(1);
    expect((await reach(A, 0)).json.data.stopsCompleted).toBe(1);
    const second = await reach(A, 1);
    expect(second.json.data.allowedActions).toEqual(["completed", "interrupt"]);

    expect((await setStatus(ctx, A, rideId, "completed")).status).toBe(200);
    expect((await setStatus(ctx, A, rideId, "completed")).status).toBe(200);
    expect((await reach(A, 1)).status).toBe(200);
    expect(ctx.stripe.effectiveCaptures).toBe(1);
    expect(ctx.stripe.intents.get(intentId)!.amountReceived).toBe(q.fareCents);

    const { rows } = await db.query<{ reason: string }>(
      "SELECT reason FROM mobility.ride_events WHERE ride_id = $1 AND reason LIKE 'stop_%' ORDER BY id",
      [rideId],
    );
    expect(rows.map((r) => r.reason)).toEqual([
      "stop_1_reached",
      "stop_2_reached",
    ]);
  });

  it("targets the next stop for the live ETA and shows stops on the receipt, in driver history and to operators", async () => {
    await onlineDriver(ctx, A);
    const { rideId } = await book({ stops: [STOP_1] });
    const offer = (await dashboard(ctx, A)).offer!;
    await accept(ctx, A, offer.id);
    await drive(ctx, A, rideId, "in_progress");
    ctx.routing.calls.length = 0;
    await watch(ctx, P, rideId);
    expect(pointKey(ctx.routing.calls[0].to)).toBe(pointKey(STOP_1));
    await call(ctx, reachStop, {
      user: A,
      params: { id: rideId },
      body: { index: 0 },
    });
    ctx.routing.calls.length = 0;
    await watch(ctx, P, rideId);
    expect(pointKey(ctx.routing.calls[0].to)).toBe(pointKey(DESTINATION));
    await setStatus(ctx, A, rideId, "completed");

    const r = (await receipt(ctx, P, rideId)).json.data as Receipt;
    expect(r.stops).toEqual([STOP_1]);
    expect(r.stopsCompleted).toBe(1);
    const trips = (await call(ctx, listDriverTrips, { user: A })).json.data;
    expect(trips[0].stopCount).toBe(1);

    await makeOperator(ctx, VIEW, "view");
    const detail = await adminGet(ctx, VIEW, rideDetail, {
      params: { id: rideId },
    });
    expect(detail.status).toBe(200);
    expect(detail.json.data.ride).toMatchObject({
      stopAddresses: [STOP_1.address],
      stopsCompleted: 1,
      categoryName: "Standard",
      passengerCount: 1,
      fromScheduledRequest: false,
    });
    expect(JSON.stringify(detail.json.data)).not.toContain(
      String(STOP_1.latitude),
    );
  });

  it("never shows intermediate stops on the public share page", async () => {
    await onlineDriver(ctx, A);
    const { rideId } = await book({ stops: [STOP_1, STOP_2] });
    const share = await call(ctx, createShare, {
      user: P,
      params: { id: rideId },
      body: {},
    });
    const shared = await call(ctx, viewShare, {
      params: { token: share.json.data.token },
    });
    expect(shared.status).toBe(200);
    expect(JSON.stringify(shared.json)).not.toMatch(/Valencia|Dolores|stops/);
    expect(shared.json.data.destination).toBe(DESTINATION.address);
  });

  it("lets a trip with stops be ended early without a charge", async () => {
    await onlineDriver(ctx, A);
    const { rideId, intentId } = await book({ stops: [STOP_1] });
    const offer = (await dashboard(ctx, A)).offer!;
    await accept(ctx, A, offer.id);
    await drive(ctx, A, rideId, "in_progress");
    expect((await interrupt(ctx, A, rideId)).status).toBe(200);
    expect(ctx.stripe.intents.get(intentId)!.status).toBe("canceled");
    expect(ctx.stripe.effectiveCaptures).toBe(0);
  });
});
