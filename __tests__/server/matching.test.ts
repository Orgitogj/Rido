import { MATCHING } from "../../server/matching";
import { sweep } from "../../server/rides";
import { heartbeat } from "../../server/routes/driver";
import { createQuote } from "../../server/routes/quotes";
import { createBooking, refreshRidePayment } from "../../server/routes/rides";

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
  accept,
  admin,
  advanceClock,
  apply,
  assertInvariants,
  assign,
  cancel,
  dashboard,
  decline,
  goOffline,
  onlineDriver,
  requestRide,
  viewRide,
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
const NEAR = "user_near";
const FAR = "user_far";

const offerHolder = async (drivers: string[]) => {
  for (const d of drivers) {
    const dash = await dashboard(ctx, d);
    if (dash.offer) return { driver: d, offer: dash.offer };
  }
  return null;
};

describe("eligibility", () => {
  it("offers the nearest eligible driver first, deterministically", async () => {
    await onlineDriver(ctx, FAR, 3000);
    await onlineDriver(ctx, NEAR, 400);
    const { view } = await requestRide(ctx, P);
    expect(view.status).toBe("offered");
    const holder = await offerHolder([NEAR, FAR]);
    expect(holder?.driver).toBe(NEAR);
    expect(holder?.offer.distanceToPickupMeters).toBeGreaterThan(350);
    expect(holder?.offer.distanceToPickupMeters).toBeLessThan(450);
  });

  it.each([
    ["pending (not approved)", async () => apply(ctx, NEAR)],
    [
      "suspended",
      async () => {
        await onlineDriver(ctx, NEAR);
        await admin.setDriverStatus(db, NEAR, "suspended", {
          reason: "test fixture",
        });
      },
    ],
    [
      "offline",
      async () => {
        await onlineDriver(ctx, NEAR);
        await goOffline(ctx, NEAR);
      },
    ],
    [
      "outside the matching radius",
      async () => onlineDriver(ctx, NEAR, MATCHING.radiusMeters + 2000),
    ],
    [
      "not heard from recently (app closed)",
      async () => {
        await onlineDriver(ctx, NEAR);
        advanceClock(ctx, MATCHING.driverFreshSeconds + 1);
      },
    ],
  ])("skips a driver who is %s", async (_name, setup) => {
    await setup();
    const { view } = await requestRide(ctx, P);
    expect(view.status).toBe("requested");
  });

  it("never offers a ride to the passenger's own driver account", async () => {
    await onlineDriver(ctx, P);
    const { view } = await requestRide(ctx, P);
    expect(view.status).toBe("requested");
  });

  it("does not offer a busy driver a second ride", async () => {
    await onlineDriver(ctx, NEAR);
    const first = await requestRide(ctx, P);
    await assign(ctx, NEAR, first.rideId);
    const second = await requestRide(ctx, "user_other_passenger");
    expect(second.view.status).toBe("requested");
  });

  it("reports nearby online drivers with the quote", async () => {
    await onlineDriver(ctx, NEAR);
    await onlineDriver(ctx, FAR, MATCHING.radiusMeters + 5000);
    const res = await call(ctx, createQuote, {
      user: P,
      body: { pickup: PICKUP, destination: DESTINATION },
    });
    expect(res.json.data.driversNearby).toBe(1);
  });
});

describe("offers", () => {
  it("moves to the next driver when an offer expires", async () => {
    await onlineDriver(ctx, NEAR, 300);
    await onlineDriver(ctx, FAR, 900);
    const { rideId } = await requestRide(ctx, P);
    expect((await offerHolder([NEAR, FAR]))?.driver).toBe(NEAR);

    advanceClock(ctx, MATCHING.offerTtlSeconds + 1);
    await dashboard(ctx, FAR);
    const holder = await offerHolder([FAR]);
    expect(holder?.driver).toBe(FAR);
    expect((await viewRide(ctx, P, rideId)).json.data.status).toBe("offered");

    const { rows } = await db.query(
      "SELECT status FROM mobility.ride_offers ORDER BY created_at",
    );
    expect(rows.map((r) => r.status)).toEqual(["expired", "pending"]);
  });

  it("rejects accepting an expired offer and moves the search on", async () => {
    await onlineDriver(ctx, NEAR, 300);
    await onlineDriver(ctx, FAR, 900);
    await requestRide(ctx, P);
    const { offer } = (await offerHolder([NEAR]))!;
    advanceClock(ctx, MATCHING.offerTtlSeconds + 1);
    await call(ctx, heartbeat, { user: NEAR, body: {} }).catch(() => {});
    const res = await accept(ctx, NEAR, offer.id);
    expect(res.status).toBe(409);
    expect(["OFFER_EXPIRED", "OFFER_UNAVAILABLE"]).toContain(
      res.json.error.code,
    );
  });

  it("re-offers to the next driver on decline, and never re-offers to a decliner", async () => {
    await onlineDriver(ctx, NEAR, 300);
    await onlineDriver(ctx, FAR, 900);
    const { rideId } = await requestRide(ctx, P);
    const { offer } = (await offerHolder([NEAR]))!;

    const res = await decline(ctx, NEAR, offer.id);
    expect(res.status).toBe(200);
    expect(res.json.data.offer).toBeNull();
    expect((await offerHolder([FAR]))?.offer.rideId).toBe(rideId);

    await decline(ctx, FAR, (await offerHolder([FAR]))!.offer.id);
    expect((await dashboard(ctx, NEAR)).offer).toBeNull();
    expect((await viewRide(ctx, P, rideId)).json.data.status).toBe("requested");
  });

  it("withdraws a pending offer when that driver goes offline", async () => {
    await onlineDriver(ctx, NEAR, 300);
    await onlineDriver(ctx, FAR, 900);
    const { rideId } = await requestRide(ctx, P);
    await goOffline(ctx, NEAR);
    expect((await offerHolder([FAR]))?.offer.rideId).toBe(rideId);
    const { rows } = await db.query(
      "SELECT status FROM mobility.ride_offers ORDER BY created_at",
    );
    expect(rows[0].status).toBe("cancelled");
  });

  it("offers a waiting ride to a driver who comes online during the search", async () => {
    const { rideId, view } = await requestRide(ctx, P);
    expect(view.status).toBe("requested");
    await onlineDriver(ctx, NEAR);
    expect((await offerHolder([NEAR]))?.offer.rideId).toBe(rideId);
  });
});

describe("no driver", () => {
  it("ends the search at the deadline and releases the hold", async () => {
    const { rideId, intentId } = await requestRide(ctx, P);
    advanceClock(ctx, MATCHING.searchTimeoutSeconds - 1);
    expect((await viewRide(ctx, P, rideId)).json.data.status).toBe("requested");

    advanceClock(ctx, 2);
    const view = (await viewRide(ctx, P, rideId)).json.data;
    expect(view).toMatchObject({
      status: "no_driver",
      paymentStatus: "cancelled",
    });
    expect(ctx.stripe.intents.get(intentId)!.status).toBe("canceled");
    expect(ctx.stripe.calls.capture).toBe(0);
  });

  it("is reached by the sweep even if the passenger's app is closed", async () => {
    const { rideId } = await requestRide(ctx, P);
    advanceClock(ctx, MATCHING.searchTimeoutSeconds + 1);
    await sweep(ctx.deps);
    const { rows } = await db.query(
      "SELECT status, payment_status FROM mobility.rides WHERE id = $1",
      [rideId],
    );
    expect(rows[0]).toEqual({
      status: "no_driver",
      payment_status: "cancelled",
    });
  });
});

describe("cancellation while searching", () => {
  it("withdraws the pending offer and releases the hold", async () => {
    await onlineDriver(ctx, NEAR);
    const { rideId, intentId } = await requestRide(ctx, P);
    const { offer } = (await offerHolder([NEAR]))!;

    const res = await cancel(ctx, P, rideId);
    expect(res.json.data).toMatchObject({
      status: "cancelled",
      paymentStatus: "cancelled",
    });
    expect(ctx.stripe.intents.get(intentId)!.status).toBe("canceled");
    expect((await dashboard(ctx, NEAR)).offer).toBeNull();

    const late = await accept(ctx, NEAR, offer.id);
    expect(late.status).toBe(409);
  });
});

describe("concurrency", () => {
  it("assigns exactly one driver when accept is tapped repeatedly in parallel", async () => {
    await onlineDriver(ctx, NEAR);
    const { rideId } = await requestRide(ctx, P);
    const { offer } = (await offerHolder([NEAR]))!;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => accept(ctx, NEAR, offer.id)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.ride_events WHERE ride_id = $1 AND to_status = 'accepted'",
      [rideId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("resolves accept racing a passenger cancel to one consistent outcome", async () => {
    await onlineDriver(ctx, NEAR);
    const { rideId } = await requestRide(ctx, P);
    const { offer } = (await offerHolder([NEAR]))!;
    const [acc, can] = await Promise.all([
      accept(ctx, NEAR, offer.id),
      cancel(ctx, P, rideId),
    ]);
    expect(can.status).toBe(200);
    const { rows } = await db.query(
      "SELECT status, payment_status FROM mobility.rides WHERE id = $1",
      [rideId],
    );
    expect(rows[0]).toEqual({
      status: "cancelled",
      payment_status: "cancelled",
    });
    expect([200, 409]).toContain(acc.status);
  });

  it("never lets one driver hold two pending offers or two active rides", async () => {
    await onlineDriver(ctx, NEAR);
    const quotes = await Promise.all(
      ["user_p1", "user_p2", "user_p3"].map((p) =>
        call(ctx, createQuote, {
          user: p,
          body: { pickup: PICKUP, destination: DESTINATION },
        }),
      ),
    );
    const bookings = await Promise.all(
      quotes.map((q, i) =>
        call(ctx, createBooking, {
          user: `user_p${i + 1}`,
          body: { quoteId: q.json.data.quote.id },
        }),
      ),
    );
    for (const intent of ctx.stripe.intents.values())
      ctx.stripe.authorize(intent.id);
    await Promise.all(
      bookings.map((b, i) =>
        call(ctx, refreshRidePayment, {
          method: "POST",
          user: `user_p${i + 1}`,
          params: { id: b.json.data.rideId },
        }),
      ),
    );
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.ride_offers WHERE status = 'pending'",
    );
    expect(rows[0].n).toBe(1);

    const { offer } = (await offerHolder([NEAR]))!;
    await accept(ctx, NEAR, offer.id);
    expect((await dashboard(ctx, NEAR)).offer).toBeNull();
  });

  it("the database rejects a second pending offer for the same ride", async () => {
    await onlineDriver(ctx, NEAR, 300);
    await onlineDriver(ctx, FAR, 900);
    const { rideId } = await requestRide(ctx, P);
    const far = await db.query(
      "SELECT dp.id FROM mobility.driver_profiles dp JOIN mobility.users u ON u.id = dp.user_id WHERE u.clerk_id = $1",
      [FAR],
    );
    await expect(
      db.query(
        `INSERT INTO mobility.ride_offers (ride_id, driver_profile_id, distance_meters, created_at, expires_at)
         VALUES ($1, $2, 1, now(), now() + interval '1 minute')`,
        [rideId, far.rows[0].id],
      ),
    ).rejects.toThrow(/ride_offers_one_pending_per_ride/);
  });
});
