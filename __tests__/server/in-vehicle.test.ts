import { randomUUID } from "node:crypto";

import { sweep } from "../../server/rides";
import { rideDetail } from "../../server/routes/admin";
import {
  adminRecordCollection,
  getBalance,
  listBalances,
  recordRideCollection,
  recordSettlement,
} from "../../server/routes/collection";
import { earningsSummary } from "../../server/routes/earnings";
import { createQuote } from "../../server/routes/quotes";
import { getReceipt } from "../../server/routes/receipts";
import { cancelRide, createBooking } from "../../server/routes/rides";
import { createTip, getTip } from "../../server/routes/tips";

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
  adminGet,
  adminPost,
  advanceClock,
  dashboard,
  drive,
  makeOperator,
  onlineDriver,
  setStatus,
  viewRide,
} from "./scenario";

import type {
  DriverBalanceDetail,
  EarningsSummary,
  Receipt,
  RideView,
} from "../../shared/contracts";

const db = testDb();
let ctx: TestContext;

const P = "user_passenger";
const D = "user_driver";
const OTHER = "user_other_driver";
const OPS = "user_operator";
const VIEW = "user_viewer";

beforeEach(async () => {
  await resetDb(db);
  ctx = createContext(db);
  process.env.PAYMENT_MODE = "in_vehicle";
  process.env.APP_CURRENCY = "all";
  await db.query(
    `UPDATE mobility.fare_policies
        SET currency = 'all', base_cents = 15000, per_km_cents = 6050,
            per_minute_cents = 1500, minimum_fare_cents = 30000`,
  );
});
afterEach(() => {
  process.env.PAYMENT_MODE = "card_online";
  process.env.APP_CURRENCY = "usd";
});
afterAll(() => db.end());

async function book(passenger = P) {
  const quote = await call(ctx, createQuote, {
    user: passenger,
    body: { pickup: PICKUP, destination: DESTINATION },
  });
  expect(quote.status).toBe(201);
  const booking = await call(ctx, createBooking, {
    user: passenger,
    body: { quoteId: quote.json.data.quote.id },
  });
  return { quote: quote.json.data, booking };
}

async function completedRide() {
  await onlineDriver(ctx, D);
  const { quote, booking } = await book();
  const rideId: string = booking.json.data.rideId;
  const offer = (await dashboard(ctx, D)).offer!;
  await accept(ctx, D, offer.id);
  await drive(ctx, D, rideId);
  return { rideId, fare: quote.quote.fareCents as number };
}

const collect = (user: string, rideId: string, method: string) =>
  call(ctx, recordRideCollection, {
    user,
    params: { id: rideId },
    body: { method },
  });

const rowOf = async (rideId: string) =>
  (await db.query("SELECT * FROM mobility.rides WHERE id = $1", [rideId]))
    .rows[0];

describe("booking without a card", () => {
  it("quotes in whole lek and starts matching at once without any payment provider call", async () => {
    await onlineDriver(ctx, D);
    const { quote, booking } = await book();
    expect(quote.paymentMethod).toBe("in_vehicle");
    expect(quote.quote.currency).toBe("all");
    expect(quote.quote.fareCents % 100).toBe(0);
    expect(quote.quote.fareCents).toBe(44300);

    expect(booking.status).toBe(201);
    expect(booking.json.data).toMatchObject({
      paymentMethod: "in_vehicle",
      currency: "all",
      fareCents: 44300,
      status: "offered",
    });
    expect(booking.json.data.paymentIntentClientSecret).toBeUndefined();
    expect(ctx.stripe.intents.size).toBe(0);
    expect((await dashboard(ctx, D)).offer?.rideId).toBe(
      booking.json.data.rideId,
    );

    const view = (await viewRide(ctx, P, booking.json.data.rideId)).json
      .data as RideView;
    expect(view).toMatchObject({
      paymentMethod: "in_vehicle",
      paymentStatus: "pending",
      currency: "all",
      collection: null,
    });
    expect(view.cancellation?.consequence).toMatch(/nothing to pay/i);
  });

  it("returns the same ride for a repeated or concurrent request and never a second active ride", async () => {
    await onlineDriver(ctx, D);
    const quote = await call(ctx, createQuote, {
      user: P,
      body: { pickup: PICKUP, destination: DESTINATION },
    });
    const body = { quoteId: quote.json.data.quote.id };
    const [a, b] = await Promise.all([
      call(ctx, createBooking, { user: P, body }),
      call(ctx, createBooking, { user: P, body }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.json.data.rideId).toBe(b.json.data.rideId);
    const again = await call(ctx, createBooking, { user: P, body });
    expect(again.status).toBe(200);
    expect(again.json.data.rideId).toBe(a.json.data.rideId);
    const { rows } = await db.query("SELECT id FROM mobility.rides");
    expect(rows).toHaveLength(1);
    const { rows: offers } = await db.query(
      "SELECT id FROM mobility.ride_offers WHERE status = 'pending'",
    );
    expect(offers).toHaveLength(1);

    const second = await call(ctx, createQuote, {
      user: P,
      body: {
        pickup: PICKUP,
        destination: { ...DESTINATION, latitude: DESTINATION.latitude + 0.01 },
      },
    });
    const refused = await call(ctx, createBooking, {
      user: P,
      body: { quoteId: second.json.data.quote.id },
    });
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe("ACTIVE_RIDE_EXISTS");
  });

  it("ends a cancelled or unmatched request with nothing to pay", async () => {
    const { booking } = await book();
    const rideId: string = booking.json.data.rideId;
    expect(booking.json.data.status).toBe("requested");
    const cancelled = await call(ctx, cancelRide, {
      user: P,
      params: { id: rideId },
      body: {},
    });
    expect(cancelled.status).toBe(200);
    const row = await rowOf(rideId);
    expect(row.status).toBe("cancelled");
    expect(row.payment_status).toBe("pending");
    expect(row.collection_status).toBeNull();
    const receipt = (
      await call(ctx, getReceipt, { user: P, params: { id: rideId } })
    ).json.data as Receipt;
    expect(receipt.paymentState).toBe("nothing_due");
    expect(receipt.chargedCents).toBe(0);
    expect(ctx.stripe.intents.size).toBe(0);
  });
});

describe("recording the payment", () => {
  it("asks the driver to record the payment after completion and records a terminal payment for the business", async () => {
    const { rideId, fare } = await completedRide();
    expect(ctx.stripe.intents.size).toBe(0);
    let row = await rowOf(rideId);
    expect(row.collection_status).toBe("pending");
    expect(row.payment_status).toBe("pending");

    const driverView = (await viewRide(ctx, D, rideId)).json.data as RideView;
    expect(driverView.collection).toMatchObject({
      status: "pending",
      canRecord: true,
    });
    const passengerView = (await viewRide(ctx, P, rideId)).json
      .data as RideView;
    expect(passengerView.collection).toMatchObject({
      status: "pending",
      canRecord: false,
    });
    expect((await dashboard(ctx, D)).collectionsDue).toEqual([
      expect.objectContaining({ rideId, fareCents: fare, currency: "all" }),
    ]);

    const res = await collect(D, rideId, "pos");
    expect(res.status).toBe(200);
    expect(res.json.data.collection).toMatchObject({
      status: "collected",
      method: "pos",
      canRecord: false,
    });
    row = await rowOf(rideId);
    expect(row.payment_status).toBe("paid");
    expect(row.captured_cents).toBe(fare);
    expect(row.collection_recorded_by).toBe("driver");
    expect((await dashboard(ctx, D)).collectionsDue).toEqual([]);

    const { rows: entries } = await db.query(
      "SELECT kind, gross_cents, driver_amount_cents, commission_cents, funds_held_by, currency FROM mobility.earning_entries WHERE ride_id = $1",
      [rideId],
    );
    expect(entries).toEqual([
      {
        kind: "ride_earning",
        gross_cents: fare,
        driver_amount_cents: fare,
        commission_cents: 0,
        funds_held_by: "platform",
        currency: "all",
      },
    ]);
    const receipt = (
      await call(ctx, getReceipt, { user: P, params: { id: rideId } })
    ).json.data as Receipt;
    expect(receipt).toMatchObject({
      paymentState: "paid_pos",
      paymentMethod: "in_vehicle",
      currency: "all",
      chargedCents: fare,
      collection: { status: "collected", method: "pos" },
    });
  });

  it("is idempotent, refuses a different second answer, and writes one earning under concurrent taps", async () => {
    const { rideId } = await completedRide();
    const [a, b] = await Promise.all([
      collect(D, rideId, "cash"),
      collect(D, rideId, "cash"),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await collect(D, rideId, "cash")).status).toBe(200);
    const changed = await collect(D, rideId, "pos");
    expect(changed.status).toBe(409);
    expect(changed.json.error.code).toBe("COLLECTION_RECORDED");
    const { rows } = await db.query(
      "SELECT funds_held_by FROM mobility.earning_entries WHERE ride_id = $1",
      [rideId],
    );
    expect(rows).toEqual([{ funds_held_by: "driver" }]);
    const { rows: events } = await db.query(
      "SELECT reason FROM mobility.ride_events WHERE ride_id = $1 AND reason LIKE 'collection_%'",
      [rideId],
    );
    expect(events).toEqual([{ reason: "collection_cash" }]);
  });

  it("lets only the assigned driver record it, only after completion, and validates the method", async () => {
    await onlineDriver(ctx, D);
    await onlineDriver(ctx, OTHER, 5000);
    const { booking } = await book();
    const rideId: string = booking.json.data.rideId;
    const offer = (await dashboard(ctx, D)).offer!;
    await accept(ctx, D, offer.id);
    await drive(ctx, D, rideId, "in_progress");
    const early = await collect(D, rideId, "pos");
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe("COLLECTION_NOT_ALLOWED");
    expect((await setStatus(ctx, D, rideId, "completed")).status).toBe(200);
    expect((await collect(P, rideId, "pos")).status).toBe(404);
    expect((await collect(OTHER, rideId, "pos")).status).toBe(404);
    expect((await collect(D, rideId, "card")).status).toBe(400);
    expect((await collect(D, rideId, "waived")).status).toBe(400);
    expect((await collect(D, randomUUID(), "pos")).status).toBe(404);
    expect((await rowOf(rideId)).collection_status).toBe("pending");
  });

  it("doesn't offer in-app tips for trips paid in the vehicle", async () => {
    const { rideId } = await completedRide();
    await collect(D, rideId, "pos");
    const state = await call(ctx, getTip, { user: P, params: { id: rideId } });
    expect(state.json.data).toMatchObject({
      eligible: false,
      reason: "not_available",
    });
    const started = await call(ctx, createTip, {
      user: P,
      params: { id: rideId },
      body: { amountCents: 200, idempotencyKey: randomUUID(), consent: true },
    });
    expect(started.status).toBe(409);
    expect(ctx.stripe.intents.size).toBe(0);
  });
});

describe("unpaid trips", () => {
  it("flags the trip, blocks the passenger's next request, and unblocks when support settles or waives it", async () => {
    await makeOperator(ctx, OPS, "view,support,refund");
    await makeOperator(ctx, VIEW, "view");
    const { rideId, fare } = await completedRide();
    const unpaid = await collect(D, rideId, "unpaid");
    expect(unpaid.status).toBe(200);
    let row = await rowOf(rideId);
    expect(row).toMatchObject({
      collection_status: "unpaid",
      payment_status: "failed",
      needs_review: true,
      review_reason: "passenger_unpaid",
    });
    const { rows: none } = await db.query(
      "SELECT 1 FROM mobility.earning_entries WHERE ride_id = $1",
      [rideId],
    );
    expect(none).toEqual([]);

    const quote = await call(ctx, createQuote, {
      user: P,
      body: { pickup: PICKUP, destination: DESTINATION },
    });
    expect(quote.status).toBe(409);
    expect(quote.json.error.code).toBe("UNPAID_RIDE");

    const receipt = (
      await call(ctx, getReceipt, { user: P, params: { id: rideId } })
    ).json.data as Receipt;
    expect(receipt.paymentState).toBe("unpaid");

    const body = { outcome: "cash", note: "Passenger paid the driver later." };
    expect(
      (await adminPost(ctx, VIEW, adminRecordCollection, { id: rideId }, body))
        .status,
    ).toBe(403);
    expect(
      (await adminPost(ctx, P, adminRecordCollection, { id: rideId }, body))
        .status,
    ).toBe(403);
    expect(
      (
        await adminPost(
          ctx,
          OPS,
          adminRecordCollection,
          { id: rideId },
          { outcome: "cash", note: "" },
        )
      ).status,
    ).toBe(400);
    const settled = await adminPost(
      ctx,
      OPS,
      adminRecordCollection,
      { id: rideId },
      body,
    );
    expect(settled.status).toBe(200);
    row = await rowOf(rideId);
    expect(row).toMatchObject({
      collection_status: "collected",
      collection_method: "cash",
      payment_status: "paid",
      captured_cents: fare,
      needs_review: false,
      collection_recorded_by: "operator",
    });
    const { rows: audit } = await db.query(
      "SELECT result FROM mobility.audit_log WHERE target_id = $1 ORDER BY id",
      [rideId],
    );
    expect(audit.filter((a) => a.result === "denied").length).toBeGreaterThan(
      0,
    );
    expect(audit.filter((a) => a.result === "succeeded")).toHaveLength(1);

    const detail = await adminGet(ctx, VIEW, rideDetail, {
      params: { id: rideId },
    });
    expect(detail.json.data.ride).toMatchObject({
      paymentMethod: "in_vehicle",
      collection: { status: "collected", method: "cash", canRecord: false },
    });

    const next = await call(ctx, createQuote, {
      user: P,
      body: { pickup: PICKUP, destination: DESTINATION },
    });
    expect(next.status).toBe(201);
  });

  it("lets support waive an unpaid trip without recording earnings", async () => {
    await makeOperator(ctx, OPS, "view,support");
    const { rideId } = await completedRide();
    await collect(D, rideId, "unpaid");
    const waived = await adminPost(
      ctx,
      OPS,
      adminRecordCollection,
      { id: rideId },
      {
        outcome: "waived",
        note: "Driver took a wrong route; agreed to waive.",
      },
    );
    expect(waived.status).toBe(200);
    const row = await rowOf(rideId);
    expect(row).toMatchObject({
      collection_status: "waived",
      payment_status: "cancelled",
      needs_review: false,
      captured_cents: null,
    });
    const { rows } = await db.query(
      "SELECT 1 FROM mobility.earning_entries WHERE ride_id = $1",
      [rideId],
    );
    expect(rows).toEqual([]);
    const again = await adminPost(
      ctx,
      OPS,
      adminRecordCollection,
      { id: rideId },
      { outcome: "pos", note: "Changed my mind." },
    );
    expect(again.status).toBe(409);
    expect(
      (
        await call(ctx, createQuote, {
          user: P,
          body: { pickup: PICKUP, destination: DESTINATION },
        })
      ).status,
    ).toBe(201);
  });

  it("flags a completed trip whose payment the driver never recorded", async () => {
    process.env.CRON_SECRET = "test-cron-secret-123";
    const { rideId } = await completedRide();
    await sweep(ctx.deps, 25, { maintenance: "always" });
    expect((await rowOf(rideId)).needs_review).toBe(false);
    advanceClock(ctx, 2 * 3600 + 60);
    await sweep(ctx.deps, 25, { maintenance: "always" });
    expect(await rowOf(rideId)).toMatchObject({
      needs_review: true,
      review_reason: "collection_not_recorded",
      collection_status: "pending",
    });
    expect((await collect(D, rideId, "pos")).status).toBe(200);
    expect((await rowOf(rideId)).needs_review).toBe(false);
  });
});

describe("driver balance and recorded transfers", () => {
  const transfer = (
    user: string,
    profileId: string,
    body: Record<string, unknown>,
  ) => adminPost(ctx, user, recordSettlement, { id: profileId }, body);

  it("tracks what the business owes the driver for terminal payments and records bank transfers once", async () => {
    await makeOperator(ctx, OPS, "view,support,refund");
    await makeOperator(ctx, VIEW, "view,support");
    const { rideId, fare } = await completedRide();
    await collect(D, rideId, "pos");
    const { rows } = await db.query<{ id: string }>(
      "SELECT dp.id FROM mobility.driver_profiles dp JOIN mobility.users u ON u.id = dp.user_id WHERE u.clerk_id = $1",
      [D],
    );
    const profileId = rows[0].id;

    const summary = (await call(ctx, earningsSummary, { user: D })).json
      .data as EarningsSummary;
    expect(summary.currency).toBe("all");
    expect(summary.balance).toMatchObject({
      currency: "all",
      earnedHeldByPlatformCents: fare,
      commissionOnCashCents: 0,
      paidToDriverCents: 0,
      netOwedToDriverCents: fare,
    });
    expect(summary.settlements).toEqual([]);

    const key = randomUUID();
    const body = {
      direction: "to_driver",
      amountCents: 30000,
      method: "bank_transfer",
      reference: "TRX-1",
      idempotencyKey: key,
    };
    expect((await transfer(VIEW, profileId, body)).status).toBe(403);
    expect((await transfer(D, profileId, body)).status).toBe(403);
    expect(
      (await transfer(OPS, profileId, { ...body, amountCents: 30050 })).status,
    ).toBe(400);
    expect(
      (await transfer(OPS, profileId, { ...body, amountCents: 0 })).status,
    ).toBe(400);
    expect((await transfer(OPS, randomUUID(), body)).status).toBe(404);

    const [a, b] = await Promise.all([
      transfer(OPS, profileId, body),
      transfer(OPS, profileId, body),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const conflict = await transfer(OPS, profileId, {
      ...body,
      amountCents: 10000,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error.code).toBe("IDEMPOTENCY_CONFLICT");

    const detail = (
      await adminGet(ctx, OPS, getBalance, { params: { id: profileId } })
    ).json.data as DriverBalanceDetail;
    expect(detail.settlements).toHaveLength(1);
    expect(detail.settlements[0]).toMatchObject({
      direction: "to_driver",
      amountCents: 30000,
      currency: "all",
      method: "bank_transfer",
      reference: "TRX-1",
    });
    expect(detail.balance).toMatchObject({
      paidToDriverCents: 30000,
      netOwedToDriverCents: fare - 30000,
    });
    const list = (await adminGet(ctx, OPS, listBalances)).json.data;
    expect(list).toEqual([
      expect.objectContaining({
        driverProfileId: profileId,
        balance: expect.objectContaining({
          netOwedToDriverCents: fare - 30000,
        }),
      }),
    ]);
    expect((await adminGet(ctx, VIEW, listBalances)).status).toBe(403);

    const mine = (await call(ctx, earningsSummary, { user: D })).json
      .data as EarningsSummary;
    expect(mine.balance.netOwedToDriverCents).toBe(fare - 30000);
    expect(mine.settlements).toHaveLength(1);
    expect(JSON.stringify(mine.settlements)).not.toContain("Op user_operator");
    const { rows: audit } = await db.query(
      "SELECT result FROM mobility.audit_log WHERE action = 'driver_settlement_create' AND result = 'succeeded'",
    );
    expect(audit).toHaveLength(1);
  });

  it("counts cash as money the driver already holds, so nothing is owed to the driver for it", async () => {
    const { rideId, fare } = await completedRide();
    await collect(D, rideId, "cash");
    const summary = (await call(ctx, earningsSummary, { user: D })).json
      .data as EarningsSummary;
    expect(summary.confirmed.fareCents).toBe(fare);
    expect(summary.balance).toMatchObject({
      earnedHeldByPlatformCents: 0,
      commissionOnCashCents: 0,
      netOwedToDriverCents: 0,
    });
  });
});

describe("card mode stays available", () => {
  it("keeps the card flow when the mode is switched back", async () => {
    process.env.PAYMENT_MODE = "card_online";
    await onlineDriver(ctx, D);
    const { quote, booking } = await book();
    expect(quote.paymentMethod).toBe("card_online");
    expect(booking.json.data.paymentMethod).toBe("card_online");
    expect(booking.json.data.paymentIntentClientSecret).toBeTruthy();
    expect(ctx.stripe.intents.size).toBe(1);
    const rideId: string = booking.json.data.rideId;
    expect((await rowOf(rideId)).status).toBe("awaiting_payment");
    expect((await collect(D, rideId, "pos")).status).toBe(404);
  });
});
