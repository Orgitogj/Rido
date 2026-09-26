import { MATCHING } from "../../server/matching";
import { SETTLEMENT, sweep } from "../../server/rides";
import {
  createSupportRequest,
  listDriverTrips,
} from "../../server/routes/receipts";

import {
  call,
  createContext,
  resetDb,
  testDb,
  type TestContext,
} from "./helpers";
import {
  advanceClock,
  assertInvariants,
  assign,
  cancel,
  drive,
  onlineDriver,
  receipt,
  receipts,
  registerDevice,
  requestRide,
  setStatus,
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
const D = "user_driver";
const TOKEN = "ExponentPushToken[passenger]";

const row = async (id: string) =>
  (await db.query("SELECT * FROM mobility.rides WHERE id = $1", [id])).rows[0];
const ledger = async (id: string) =>
  (
    await db.query(
      "SELECT kind, amount_cents FROM mobility.payment_events WHERE ride_id = $1 ORDER BY id",
      [id],
    )
  ).rows;

async function completedRide() {
  await onlineDriver(ctx, D);
  const { rideId, intentId } = await requestRide(ctx, P);
  await assign(ctx, D, rideId);
  await drive(ctx, D, rideId);
  return { rideId, intentId };
}

describe("settlement when Stripe is unavailable", () => {
  it("shows a pending release, backs off, and only says released after Stripe confirms", async () => {
    await registerDevice(ctx, P, TOKEN);
    const { rideId, intentId } = await requestRide(ctx, P);
    ctx.stripe.failNext.cancel = true;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await cancel(ctx, P, rideId);
    errorSpy.mockRestore();

    const pending = (await viewRide(ctx, P, rideId)).json.data;
    expect(pending).toMatchObject({
      paymentStatus: "authorized",
      settlement: "retrying",
    });
    const r1 = (await receipt(ctx, P, rideId)).json.data;
    expect(r1.paymentState).toBe("hold_releasing");
    expect(r1.paymentText).toMatch(/being released/);
    expect(r1.paymentText).not.toMatch(/not charged/i);
    expect(ctx.push.to(TOKEN).map((m) => m.data.kind)).not.toContain(
      "hold_released",
    );

    const cancelCalls = ctx.stripe.calls.cancel;
    await sweep(ctx.deps);
    expect(ctx.stripe.calls.cancel).toBe(cancelCalls);

    advanceClock(ctx, SETTLEMENT.baseRetrySeconds + 1);
    await sweep(ctx.deps);
    expect(ctx.stripe.intents.get(intentId)!.status).toBe("canceled");
    const r2 = (await receipt(ctx, P, rideId)).json.data;
    expect(r2).toMatchObject({
      paymentState: "hold_released",
      settlement: "settled",
    });
    expect(r2.paymentText).toMatch(/not charged/);
    expect(ctx.push.to(TOKEN).map((m) => m.data.kind)).toContain(
      "hold_released",
    );
    expect((await ledger(rideId)).map((e) => e.kind)).toEqual([
      "authorized",
      "settlement_failed",
      "released",
    ]);
  });

  it("flags a ride for review after repeated failures but keeps retrying", async () => {
    await completedRide().then(async ({ rideId }) => {
      const errorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const capture = ctx.stripe.capturePaymentIntent.bind(ctx.stripe);
      ctx.stripe.capturePaymentIntent = async () => {
        throw new Error("Stripe unavailable");
      };
      await db.query(
        "UPDATE mobility.rides SET payment_status = 'authorized', paid_at = NULL, captured_cents = NULL, settled_at = NULL WHERE id = $1",
        [rideId],
      );
      const intent = [...ctx.stripe.intents.values()][0];
      ctx.stripe.setIntent(intent.id, {
        status: "requires_capture",
        amountReceived: 0,
      });
      for (let i = 0; i < SETTLEMENT.reviewAfterAttempts; i++) {
        advanceClock(ctx, SETTLEMENT.maxRetrySeconds + 1);
        await sweep(ctx.deps);
      }
      const flagged = await row(rideId);
      expect(flagged).toMatchObject({
        needs_review: true,
        review_reason: "settlement_failing",
        settlement_attempts: SETTLEMENT.reviewAfterAttempts,
        payment_status: "authorized",
      });
      expect((await viewRide(ctx, P, rideId)).json.data.settlement).toBe(
        "needs_review",
      );
      ctx.stripe.capturePaymentIntent = capture;
      advanceClock(ctx, SETTLEMENT.maxRetrySeconds + 1);
      await sweep(ctx.deps);
      errorSpy.mockRestore();
      expect(await row(rideId)).toMatchObject({ payment_status: "paid" });
    });
  });
});

describe("authorization expiry", () => {
  it("does not try to capture a hold Stripe has already expired", async () => {
    await onlineDriver(ctx, D);
    const { rideId, intentId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    await drive(ctx, D, rideId, "in_progress");
    advanceClock(ctx, 8 * 24 * 3600);
    ctx.stripe.expireHold(intentId);
    const captures = ctx.stripe.calls.capture;
    await setStatus(ctx, D, rideId, "completed");

    expect(ctx.stripe.calls.capture).toBe(captures);
    expect(await row(rideId)).toMatchObject({
      status: "completed",
      payment_status: "expired",
      needs_review: true,
      review_reason: "authorization_expired_before_capture",
    });
    expect((await ledger(rideId)).map((e) => e.kind)).toContain(
      "capture_skipped_expired",
    );
    const r = (await receipt(ctx, P, rideId)).json.data;
    expect(r).toMatchObject({ paymentState: "hold_expired", chargedCents: 0 });
  });

  it("still captures when our estimate has passed but Stripe reports the hold as valid", async () => {
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    await drive(ctx, D, rideId, "in_progress");
    await db.query(
      "UPDATE mobility.rides SET authorization_expires_at = $2 WHERE id = $1",
      [rideId, new Date(ctx.clock.now.getTime() - 1000)],
    );
    await setStatus(ctx, D, rideId, "completed");
    expect(await row(rideId)).toMatchObject({ payment_status: "paid" });
  });

  it("ends a search whose hold is about to expire and releases it", async () => {
    const { rideId, intentId } = await requestRide(ctx, P);
    await db.query(
      "UPDATE mobility.rides SET authorization_expires_at = $2 WHERE id = $1",
      [rideId, new Date(ctx.clock.now.getTime() + 30 * 60 * 1000)],
    );
    const view = (await viewRide(ctx, P, rideId)).json.data;
    expect(view).toMatchObject({
      status: "cancelled",
      cancelledBy: "system",
      cancelReason: "authorization_expiring",
      paymentStatus: "cancelled",
    });
    expect(ctx.stripe.intents.get(intentId)!.status).toBe("canceled");
  });

  it("flags, but does not cut short, an active trip whose hold is close to expiring", async () => {
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    await db.query(
      "UPDATE mobility.rides SET authorization_expires_at = $2 WHERE id = $1",
      [
        rideId,
        new Date(
          ctx.clock.now.getTime() + MATCHING.authorizationSafetySeconds * 500,
        ),
      ],
    );
    await sweep(ctx.deps);
    expect(await row(rideId)).toMatchObject({
      status: "accepted",
      needs_review: true,
      review_reason: "authorization_expiring_during_trip",
    });
  });

  it("records Stripe's capture deadline when the hold is placed", async () => {
    const { rideId, intentId } = await requestRide(ctx, P);
    const intent = ctx.stripe.intents.get(intentId)!;
    expect(
      new Date((await row(rideId)).authorization_expires_at).getTime(),
    ).toBe(intent.captureBefore! * 1000);
  });
});

describe("receipts", () => {
  it("shows the confirmed charge for a completed trip, derived from Stripe", async () => {
    const { rideId } = await completedRide();
    const r = (await receipt(ctx, P, rideId)).json.data;
    const ride = await row(rideId);
    expect(r).toMatchObject({
      outcome: "completed",
      isLegacyDemo: false,
      quotedFareCents: ride.fare_cents,
      chargedCents: ride.captured_cents,
      netChargedCents: ride.captured_cents,
      refundedCents: 0,
      currency: "usd",
      paymentState: "charged",
      settlement: "settled",
      driver: { name: `Driver ${D}`, vehicle: "Toyota Prius" },
    });
    expect(r.completedAt).not.toBeNull();
  });

  it("returns only the caller's own receipts", async () => {
    const { rideId } = await completedRide();
    expect(
      (await receipts(ctx, P)).json.data.map(
        (x: { rideId: string }) => x.rideId,
      ),
    ).toEqual([rideId]);
    expect((await receipts(ctx, "user_other")).json.data).toEqual([]);
    expect((await receipt(ctx, "user_other", rideId)).status).toBe(404);
    expect((await receipt(ctx, D, rideId)).status).toBe(404);
  });

  it("keeps legacy demo bookings distinguishable", async () => {
    const { rideId } = await requestRide(ctx, P, { authorize: false });
    await db.query(
      `UPDATE mobility.rides SET status = 'legacy', demo_driver_id = 1, requested_at = NULL,
              payment_status = 'paid', paid_at = now(), captured_cents = fare_cents
        WHERE id = $1`,
      [rideId],
    );
    const r = (await receipt(ctx, P, rideId)).json.data;
    expect(r).toMatchObject({
      isLegacyDemo: true,
      paymentState: "legacy_demo",
      legacyDemoDriver: "James Wilson",
      driver: null,
    });
  });

  it("gives drivers only their own completed trips, without payment details", async () => {
    const { rideId } = await completedRide();
    const trips = (await call(ctx, listDriverTrips, { user: D })).json.data;
    expect(trips).toHaveLength(1);
    expect(trips[0].rideId).toBe(rideId);
    expect(Object.keys(trips[0]).sort()).toEqual(
      [
        "acceptedAt",
        "completedAt",
        "currency",
        "destination",
        "distanceMeters",
        "fareCents",
        "pickup",
        "rideId",
        "startedAt",
      ].sort(),
    );
    await onlineDriver(ctx, "user_driver_two", 20_000);
    expect(
      (await call(ctx, listDriverTrips, { user: "user_driver_two" })).json.data,
    ).toEqual([]);
    expect((await call(ctx, listDriverTrips, { user: P })).status).toBe(403);
  });
});

describe("support requests", () => {
  it("records a request for the passenger's own ride without issuing any refund", async () => {
    const { rideId } = await completedRide();
    const res = await call(ctx, createSupportRequest, {
      user: P,
      params: { id: rideId },
      body: {
        category: "charge_question",
        message: "I was charged but the trip felt short.",
      },
    });
    expect(res.status).toBe(201);
    expect(ctx.stripe.calls.createRefund).toBe(0);
    const stranger = await call(ctx, createSupportRequest, {
      user: "user_other",
      params: { id: rideId },
      body: { category: "other", message: "Let me see this ride" },
    });
    expect(stranger.status).toBe(404);
  });
});
