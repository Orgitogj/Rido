import { REMATCH } from "../../server/cancellation";
import { MATCHING } from "../../server/matching";

import { createContext, resetDb, testDb, type TestContext } from "./helpers";
import {
  accept,
  advanceClock,
  assertInvariants,
  assign,
  cancel,
  dashboard,
  decline,
  drive,
  fix,
  interrupt,
  onlineDriver,
  postLocation,
  receipt,
  registerDevice,
  requestRide,
  setStatus,
  viewRide,
  watch,
} from "./scenario";

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
const C = "user_driver_c";
const at = () => ctx.clock.now;

const offerFor = async (driver: string) => (await dashboard(ctx, driver)).offer;
const row = async (id: string) =>
  (await db.query("SELECT * FROM mobility.rides WHERE id = $1", [id])).rows[0];

describe("driver cancels before pickup", () => {
  it.each(["accepted", "arriving", "arrived"] as const)(
    "from %s: keeps the ride and its hold and offers it to another driver",
    async (state) => {
      await onlineDriver(ctx, A, 300);
      await onlineDriver(ctx, B, 900);
      const { rideId, intentId } = await requestRide(ctx, P);
      await assign(ctx, A, rideId);
      if (state !== "accepted") await drive(ctx, A, rideId, state);

      const res = await cancel(ctx, A, rideId);
      expect(res.status).toBe(200);

      const ride = await row(rideId);
      expect(ride).toMatchObject({
        status: "offered",
        payment_status: "authorized",
        driver_profile_id: null,
        rematch_count: 1,
        stripe_payment_intent_id: intentId,
      });
      expect(ctx.stripe.intents.size).toBe(1);
      expect(ctx.stripe.calls.cancel).toBe(0);
      expect((await offerFor(B))?.rideId).toBe(rideId);
      expect(await offerFor(A)).toBeNull();

      const { rows } = await db.query(
        `SELECT from_status, to_status, actor FROM mobility.ride_events
          WHERE ride_id = $1 AND actor = 'driver' AND to_status = 'requested'`,
        [rideId],
      );
      expect(rows).toEqual([
        { from_status: state, to_status: "requested", actor: "driver" },
      ]);
    },
  );

  it("never offers the ride back to a driver who cancelled or declined it", async () => {
    await onlineDriver(ctx, A, 300);
    await onlineDriver(ctx, B, 600);
    await onlineDriver(ctx, C, 900);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    await cancel(ctx, A, rideId);

    const toB = await offerFor(B);
    await decline(ctx, B, toB!.id);
    expect((await offerFor(C))?.rideId).toBe(rideId);
    expect(await offerFor(A)).toBeNull();
    expect(await offerFor(B)).toBeNull();

    const { rows } = await db.query(
      "SELECT status FROM mobility.ride_offers WHERE ride_id = $1 ORDER BY created_at",
      [rideId],
    );
    expect(rows.map((r) => r.status)).toEqual([
      "withdrawn",
      "declined",
      "pending",
    ]);
  });

  it("hides the old driver's location and ride from them immediately", async () => {
    await onlineDriver(ctx, A, 800);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    advanceClock(ctx, 5);
    await postLocation(ctx, A, fix(700, { at: at() }));
    const before = (await watch(ctx, P, rideId)).json.data.live;
    expect(before.driverLocation).not.toBeNull();

    await cancel(ctx, A, rideId);
    const after = (await watch(ctx, P, rideId)).json.data;
    expect(after.ride.driver).toBeNull();
    expect(after.live).toMatchObject({
      leg: null,
      locationStatus: "not_shared",
      driverLocation: null,
      eta: null,
    });
    expect((await viewRide(ctx, A, rideId)).status).toBe(404);
    expect((await setStatus(ctx, A, rideId, "arrived")).status).toBe(404);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.ride_routes WHERE ride_id = $1",
      [rideId],
    );
    expect(rows[0].n).toBe(0);
  });

  it("lets a replacement driver complete the trip with a single capture of the original hold", async () => {
    await onlineDriver(ctx, A, 300);
    await onlineDriver(ctx, B, 900);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    await cancel(ctx, A, rideId);
    await assign(ctx, B, rideId);
    await drive(ctx, B, rideId);
    const ride = await row(rideId);
    expect(ride).toMatchObject({ status: "completed", payment_status: "paid" });
    expect(ride.captured_cents).toBe(ride.fare_cents);
    expect(ctx.stripe.effectiveCaptures).toBe(1);
    expect(ctx.stripe.intents.size).toBe(1);
  });

  it("ends the request and releases the hold when no replacement is found in time", async () => {
    await onlineDriver(ctx, A);
    const { rideId, intentId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    await cancel(ctx, A, rideId);
    expect((await row(rideId)).status).toBe("requested");

    advanceClock(ctx, REMATCH.searchSeconds + 1);
    const view = (await viewRide(ctx, P, rideId)).json.data;
    expect(view).toMatchObject({
      status: "no_driver",
      cancelReason: "no_replacement_driver",
      paymentStatus: "cancelled",
    });
    expect(ctx.stripe.intents.get(intentId)!.status).toBe("canceled");
  });

  it("ends the request after the re-match limit instead of searching forever", async () => {
    const drivers = ["user_d1", "user_d2", "user_d3"];
    for (const [i, d] of drivers.entries())
      await onlineDriver(ctx, d, 300 + i * 300);
    const { rideId } = await requestRide(ctx, P);
    for (const d of drivers) {
      await assign(ctx, d, rideId);
      await cancel(ctx, d, rideId);
    }
    const ride = await row(rideId);
    expect(ride).toMatchObject({
      status: "cancelled",
      cancelled_by: "driver",
      cancel_reason: "driver_cancelled_rematch_limit",
      rematch_count: REMATCH.maxRematches,
      payment_status: "cancelled",
    });
  });

  it("moves on when a re-match offer expires", async () => {
    await onlineDriver(ctx, A, 300);
    await onlineDriver(ctx, B, 600);
    await onlineDriver(ctx, C, 900);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    await cancel(ctx, A, rideId);
    expect((await offerFor(B))?.rideId).toBe(rideId);
    advanceClock(ctx, MATCHING.offerTtlSeconds + 1);
    expect((await offerFor(C))?.rideId).toBe(rideId);
  });

  it("stays consistent when the driver cancels while the passenger cancels", async () => {
    await onlineDriver(ctx, A, 300);
    await onlineDriver(ctx, B, 900);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    const [d, p] = await Promise.all([
      cancel(ctx, A, rideId),
      cancel(ctx, P, rideId),
    ]);
    expect([200, 404, 409]).toContain(d.status);
    expect(p.status).toBe(200);
    const ride = await row(rideId);
    expect(ride.status).toBe("cancelled");
    expect(ride.payment_status).toBe("cancelled");
    expect(await offerFor(B)).toBeNull();
  });

  it("lets only one of two new drivers win after a re-match, even with a stale retry from the old one", async () => {
    await onlineDriver(ctx, A, 300);
    await onlineDriver(ctx, B, 900);
    const { rideId } = await requestRide(ctx, P);
    const oldOffer = await assign(ctx, A, rideId);
    await cancel(ctx, A, rideId);
    const offerB = await offerFor(B);
    const [stale, fresh] = await Promise.all([
      accept(ctx, A, oldOffer),
      accept(ctx, B, offerB!.id),
    ]);
    expect(stale.status).toBe(409);
    expect(fresh.status).toBe(200);
    const assigned = (await viewRide(ctx, P, rideId)).json.data.driver;
    expect(assigned.name).toBe(`Driver ${B}`);
  });

  it("tells the passenger a new driver is being found, then who accepted", async () => {
    const TOKEN = "ExponentPushToken[passenger]";
    await registerDevice(ctx, P, TOKEN);
    await onlineDriver(ctx, A, 300);
    await onlineDriver(ctx, B, 900);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    await cancel(ctx, A, rideId);
    await assign(ctx, B, rideId);
    expect(ctx.push.to(TOKEN).map((m) => m.data.kind)).toEqual([
      "ride_accepted",
      "ride_rematching",
      "ride_accepted",
    ]);
  });
});

describe("driver ends a trip in progress", () => {
  it("records an interrupted trip, charges nothing, releases the hold, and flags it", async () => {
    const TOKEN = "ExponentPushToken[passenger]";
    await registerDevice(ctx, P, TOKEN);
    await onlineDriver(ctx, A);
    const { rideId, intentId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    await drive(ctx, A, rideId, "in_progress");

    expect((await cancel(ctx, A, rideId)).status).toBe(409);
    const res = await interrupt(ctx, A, rideId, "vehicle_problem");
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      status: "interrupted",
      paymentStatus: "cancelled",
    });

    const ride = await row(rideId);
    expect(ride).toMatchObject({
      needs_review: true,
      review_reason: "interrupted_trip",
      cancel_reason: "interrupted_vehicle_problem",
    });
    expect(ride.interrupted_at).not.toBeNull();
    expect(ctx.stripe.intents.get(intentId)!.status).toBe("canceled");
    expect(ctx.stripe.effectiveCaptures).toBe(0);
    expect(ctx.push.to(TOKEN).map((m) => m.data.kind)).toEqual(
      expect.arrayContaining(["ride_interrupted", "hold_released"]),
    );
    const r = (await receipt(ctx, P, rideId)).json.data;
    expect(r).toMatchObject({
      outcome: "interrupted",
      paymentState: "hold_released",
      chargedCents: 0,
    });
  });

  it("is only available to the assigned driver during the trip", async () => {
    await onlineDriver(ctx, A);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    expect((await interrupt(ctx, A, rideId)).status).toBe(409);
    await drive(ctx, A, rideId, "in_progress");
    expect((await interrupt(ctx, P, rideId)).status).toBe(403);
    expect((await interrupt(ctx, "user_stranger", rideId)).status).toBe(404);
    const bad = await interrupt(ctx, A, rideId, "because" as never);
    expect(bad.status).toBe(400);
  });
});

describe("passenger cancellation", () => {
  it.each(["requested", "offered", "accepted", "arriving", "arrived"] as const)(
    "from %s releases the hold with no fee",
    async (state) => {
      if (state !== "requested") await onlineDriver(ctx, A);
      const { rideId, intentId } = await requestRide(ctx, P);
      if (["accepted", "arriving", "arrived"].includes(state)) {
        await assign(ctx, A, rideId);
        if (state !== "accepted") {
          await drive(ctx, A, rideId, state as "arriving" | "arrived");
        }
      }
      expect((await row(rideId)).status).toBe(state);
      const res = await cancel(ctx, P, rideId);
      expect(res.json.data).toMatchObject({
        status: "cancelled",
        cancelledBy: "passenger",
        paymentStatus: "cancelled",
      });
      expect(ctx.stripe.intents.get(intentId)!.status).toBe("canceled");
      expect(ctx.stripe.effectiveCaptures).toBe(0);
    },
  );
});

describe("cancellation previews", () => {
  it("shows each actor the consequence before they confirm", async () => {
    await onlineDriver(ctx, A);
    const { rideId, view } = await requestRide(ctx, P);
    expect(view.cancellation).toMatchObject({ action: "cancel", feeCents: 0 });
    expect(view.cancellation!.consequence).toMatch(
      /release the \$\d+\.\d\d hold/,
    );
    expect(view.cancellation!.consequence).toMatch(/no cancellation fee/i);

    await assign(ctx, A, rideId);
    const driverView = (await viewRide(ctx, A, rideId)).json.data;
    expect(driverView.cancellation.consequence).toMatch(/another driver/);

    await drive(ctx, A, rideId, "in_progress");
    const onTrip = (await viewRide(ctx, A, rideId)).json.data;
    expect(onTrip.allowedActions).toEqual(["completed", "interrupt"]);
    expect(onTrip.cancellation).toMatchObject({ action: "interrupt" });
    const passengerOnTrip = (await viewRide(ctx, P, rideId)).json.data;
    expect(passengerOnTrip.cancellation).toBeNull();
    expect(passengerOnTrip.allowedActions).toEqual([]);

    await setStatus(ctx, A, rideId, "completed");
    expect((await viewRide(ctx, P, rideId)).json.data.cancellation).toBeNull();
  });
});
