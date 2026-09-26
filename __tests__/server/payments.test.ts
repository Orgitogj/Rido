import { sweep } from "../../server/rides";
import { createQuote } from "../../server/routes/quotes";
import {
  createBooking,
  listRides,
  refreshRidePayment,
} from "../../server/routes/rides";
import { stripeWebhook } from "../../server/routes/webhook";

import {
  call,
  createContext,
  DESTINATION,
  PICKUP,
  resetDb,
  signWebhook,
  testDb,
  type TestContext,
} from "./helpers";
import {
  assertInvariants,
  assign,
  cancel,
  onlineDriver,
  refresh,
  requestRide,
  setStatus,
} from "./scenario";

const db = testDb();
let ctx: TestContext;

beforeEach(async () => {
  await resetDb(db);
  ctx = createContext(db);
});
afterEach(() => assertInvariants(ctx));
afterAll(() => db.end());

const P = "user_rider";
const D = "user_driver";

async function quote(user = P) {
  const res = await call(ctx, createQuote, {
    user,
    body: { pickup: PICKUP, destination: DESTINATION },
  });
  return res.json.data.quote as { id: string; fareCents: number };
}
const book = (quoteId: string, user = P) =>
  call(ctx, createBooking, { user, body: { quoteId } });
const rideRow = async (id: string) =>
  (await db.query("SELECT * FROM mobility.rides WHERE id = $1", [id])).rows[0];

async function completeTrip(rideId: string) {
  await assign(ctx, D, rideId);
  for (const s of ["arriving", "arrived", "in_progress", "completed"]) {
    const res = await setStatus(ctx, D, rideId, s);
    expect(res.status).toBe(200);
  }
}

describe("booking places a hold, not a charge", () => {
  it("creates a manual-capture PaymentIntent for the quoted amount", async () => {
    const q = await quote();
    const res = await book(q.id);
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({
      fareCents: q.fareCents,
      paymentStatus: "pending",
      paymentIntentClientSecret: expect.stringMatching(/_secret_/),
      customerId: expect.stringMatching(/^cus_/),
    });
    const intent = ctx.stripe.onlyIntent();
    expect(intent.amount).toBe(q.fareCents);
    expect(Number.isSafeInteger(intent.amount)).toBe(true);

    const ride = await rideRow(res.json.data.rideId);
    expect(ride).toMatchObject({
      status: "awaiting_payment",
      payment_status: "pending",
    });
  });

  it("starts the search only once Stripe reports the hold", async () => {
    const { rideId, intentId } = await requestRide(ctx, P, {
      authorize: false,
    });
    expect((await rideRow(rideId)).status).toBe("awaiting_payment");

    ctx.stripe.authorize(intentId);
    const view = await refresh(ctx, P, rideId);
    expect(view).toMatchObject({
      status: "requested",
      paymentStatus: "authorized",
    });
    expect(view.searchDeadline).not.toBeNull();
    expect(ctx.stripe.calls.capture).toBe(0);
  });

  it("keeps a declined card in awaiting_payment and lets the passenger retry", async () => {
    const { rideId, intentId, quoteId } = await requestRide(ctx, P, {
      authorize: false,
    });
    ctx.stripe.setIntent(intentId, {
      status: "requires_payment_method",
      hasPaymentError: true,
    });
    expect(await refresh(ctx, P, rideId)).toMatchObject({
      status: "awaiting_payment",
      paymentStatus: "failed",
    });

    const retry = await book(quoteId);
    expect(retry.status).toBe(200);
    expect(retry.json.data.rideId).toBe(rideId);
    expect(ctx.stripe.intents.size).toBe(1);

    ctx.stripe.authorize(intentId);
    expect((await refresh(ctx, P, rideId)).status).toBe("requested");
  });

  it("returns 410 for an expired quote", async () => {
    const q = await quote();
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 11 * 60 * 1000);
    const res = await book(q.id);
    expect(res.status).toBe(410);
    expect(ctx.stripe.calls.createIntent).toBe(0);
  });

  it("refuses a second concurrent ride for the same passenger", async () => {
    await requestRide(ctx, P);
    const res = await book((await quote()).id);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("ACTIVE_RIDE_EXISTS");
  });
});

describe("duplicate requests", () => {
  it("returns the same ride and PaymentIntent for the same quote, even in parallel", async () => {
    const q = await quote();
    const results = await Promise.all([book(q.id), book(q.id), book(q.id)]);
    expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(new Set(results.map((r) => r.json.data.rideId)).size).toBe(1);
    expect(ctx.stripe.intents.size).toBe(1);
    expect(ctx.stripe.customers.size).toBe(1);
  });

  it("refuses to re-open payment for a ride that is already searching", async () => {
    const { quoteId } = await requestRide(ctx, P);
    const again = await book(quoteId);
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("ALREADY_REQUESTED");
    expect(ctx.stripe.intents.size).toBe(1);
  });
});

describe("the charge happens only on completion", () => {
  it("captures exactly the held amount when the driver completes the trip", async () => {
    await onlineDriver(ctx, D);
    const { rideId, intentId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    for (const s of ["arriving", "arrived", "in_progress"]) {
      await setStatus(ctx, D, rideId, s);
      expect((await rideRow(rideId)).payment_status).toBe("authorized");
    }
    await setStatus(ctx, D, rideId, "completed");
    const row = await rideRow(rideId);
    expect(row).toMatchObject({ status: "completed", payment_status: "paid" });
    expect(row.paid_at).not.toBeNull();
    expect(ctx.stripe.intents.get(intentId)!.status).toBe("succeeded");
  });

  it("retries a failed capture later instead of losing it", async () => {
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    ctx.stripe.failNext.capture = true;
    await completeTrip(rideId);
    expect((await rideRow(rideId)).payment_status).toBe("authorized");

    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31_000);
    await sweep(ctx.deps);
    expect((await rideRow(rideId)).payment_status).toBe("paid");
  });

  it("retries a failed hold release later", async () => {
    const { rideId, intentId } = await requestRide(ctx, P);
    ctx.stripe.failNext.cancel = true;
    await cancel(ctx, P, rideId);
    expect((await rideRow(rideId)).payment_status).toBe("authorized");

    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31_000);
    await sweep(ctx.deps);
    expect((await rideRow(rideId)).payment_status).toBe("cancelled");
    expect(ctx.stripe.intents.get(intentId)!.status).toBe("canceled");
  });

  it("releases a hold placed after the passenger already cancelled", async () => {
    const { rideId, intentId } = await requestRide(ctx, P, {
      authorize: false,
    });
    await cancel(ctx, P, rideId);
    expect(ctx.stripe.intents.get(intentId)!.status).toBe("canceled");
    expect((await rideRow(rideId)).payment_status).toBe("cancelled");
  });

  it("cancels abandoned checkouts after their time limit", async () => {
    const { rideId } = await requestRide(ctx, P, { authorize: false });
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 16 * 60 * 1000);
    await sweep(ctx.deps);
    expect(await rideRow(rideId)).toMatchObject({
      status: "cancelled",
      cancel_reason: "payment_timeout",
      payment_status: "cancelled",
    });
  });

  it("refuses to record a payment whose amount doesn't match the ride", async () => {
    const { rideId, intentId } = await requestRide(ctx, P, {
      authorize: false,
    });
    ctx.stripe.setIntent(intentId, { status: "requires_capture", amount: 1 });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await call(ctx, refreshRidePayment, {
      method: "POST",
      user: P,
      params: { id: rideId },
    });
    errorSpy.mockRestore();
    expect(res.status).toBe(409);
    expect((await rideRow(rideId)).status).toBe("awaiting_payment");
  });
});

describe("Stripe webhook", () => {
  const event = (id: string, type: string, intentId: string) => ({
    id,
    object: "event",
    type,
    data: { object: { id: intentId, object: "payment_intent" } },
  });
  const deliver = (evt: object, header?: string) => {
    const signed = signWebhook(evt);
    return call(ctx, stripeWebhook, {
      method: "POST",
      rawBody: signed.payload,
      headers: {
        "stripe-signature": header ?? signed.header,
        "content-type": "application/json",
      },
    });
  };

  it("rejects missing and invalid signatures", async () => {
    const missing = await call(ctx, stripeWebhook, {
      method: "POST",
      rawBody: "{}",
    });
    expect(missing.status).toBe(400);
    const forged = await deliver(
      event("evt_1", "payment_intent.succeeded", "pi_x"),
      "t=1,v1=00",
    );
    expect(forged.json.error.code).toBe("INVALID_SIGNATURE");
  });

  it("starts the search from a verified hold event, and ignores replays", async () => {
    await onlineDriver(ctx, D);
    const { rideId, intentId } = await requestRide(ctx, P, {
      authorize: false,
    });
    ctx.stripe.authorize(intentId);
    const evt = event(
      "evt_hold",
      "payment_intent.amount_capturable_updated",
      intentId,
    );

    expect((await deliver(evt)).status).toBe(200);
    expect((await rideRow(rideId)).status).toBe("offered");

    const retrieves = ctx.stripe.calls.retrieveIntent;
    expect((await deliver(evt)).json).toEqual({
      received: true,
      duplicate: true,
    });
    expect(ctx.stripe.calls.retrieveIntent).toBe(retrieves);
  });

  it("uses Stripe's current state, so a stale event cannot undo a capture", async () => {
    await onlineDriver(ctx, D);
    const { rideId, intentId } = await requestRide(ctx, P);
    await completeTrip(rideId);
    await deliver(
      event("evt_old", "payment_intent.amount_capturable_updated", intentId),
    );
    expect((await rideRow(rideId)).payment_status).toBe("paid");
  });

  it("acknowledges events for unknown PaymentIntents", async () => {
    const res = await deliver(
      event("evt_x", "payment_intent.succeeded", "pi_unknown"),
    );
    expect(res.status).toBe(200);
  });
});

describe("history and money", () => {
  it("shows the fare in integer cents and whether it was charged", async () => {
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    await completeTrip(rideId);
    const [ride] = (await call(ctx, listRides, { user: P })).json.data;
    expect(ride).toMatchObject({ status: "completed", paymentStatus: "paid" });
    expect(Number.isSafeInteger(ride.fareCents)).toBe(true);
  });
});
