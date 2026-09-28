import { randomUUID } from "node:crypto";

import { reconcileRide } from "../../server/earnings";
import { sweep } from "../../server/rides";
import {
  createTipRefundAction,
  rideDetail,
  syncRideFromStripe,
} from "../../server/routes/admin";
import { earningsSummary, listEarnings } from "../../server/routes/earnings";
import { getReceipt } from "../../server/routes/receipts";
import { createTip, refreshTipPayment } from "../../server/routes/tips";
import { stripeWebhook } from "../../server/routes/webhook";

import {
  call,
  createContext,
  resetDb,
  signWebhook,
  testDb,
  type TestContext,
} from "./helpers";
import {
  adminGet,
  adminPost,
  advanceClock,
  assertInvariants,
  assignedRide,
  drive,
  makeOperator,
} from "./scenario";

import type {
  AdminRideDetail,
  DriverEarningRide,
  EarningsSummary,
  Page,
  Receipt,
  TipCheckout,
} from "../../shared/contracts";

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
const OPS = "user_operator";
const VIEWER = "user_viewer";

let eventSeq = 0;
const webhook = (type: string, object: object, id = `evt_${++eventSeq}`) => {
  const signed = signWebhook({ id, object: "event", type, data: { object } });
  return call(ctx, stripeWebhook, {
    method: "POST",
    rawBody: signed.payload,
    headers: {
      "stripe-signature": signed.header,
      "content-type": "application/json",
    },
  });
};

const entries = async (rideId: string) =>
  (
    await db.query(
      `SELECT kind, gross_cents, commission_cents, driver_amount_cents, tip_id
         FROM mobility.earning_entries WHERE ride_id = $1 ORDER BY id`,
      [rideId],
    )
  ).rows;

const kinds = async (rideId: string) =>
  (await entries(rideId)).map((e) => e.kind);

const ride = async (rideId: string) =>
  (await db.query("SELECT * FROM mobility.rides WHERE id = $1", [rideId]))
    .rows[0];

const detail = async (rideId: string, user = OPS) =>
  (await adminGet(ctx, user, rideDetail, { params: { id: rideId } })).json
    .data as AdminRideDetail;

const receipt = async (rideId: string) =>
  (await call(ctx, getReceipt, { user: P, params: { id: rideId } })).json
    .data as Receipt;

const summary = async () =>
  (
    await call(ctx, earningsSummary, {
      user: A,
      url: "http://localhost/api/driver/earnings/summary",
    })
  ).json.data as EarningsSummary;

async function completedRide() {
  const rideId = await assignedRide(ctx, P, A);
  await drive(ctx, A, rideId);
  return rideId;
}

async function paidTip(rideId: string, amountCents = 600) {
  const res = await call(ctx, createTip, {
    user: P,
    params: { id: rideId },
    body: { amountCents, idempotencyKey: randomUUID(), consent: true },
  });
  const pi = (res.json.data as TipCheckout).paymentIntentClientSecret.split(
    "_secret",
  )[0];
  ctx.stripe.pay(pi);
  await call(ctx, refreshTipPayment, {
    user: P,
    params: { id: rideId },
    body: {},
  });
  const { rows } = await db.query(
    "SELECT id FROM mobility.tips WHERE ride_id = $1 AND status = 'succeeded'",
    [rideId],
  );
  return { tipId: rows[0].id as string, pi };
}

const refundTip = (
  tipId: string,
  amountCents: number,
  expectedMaxRefundableCents: number,
  idempotencyKey: string = randomUUID(),
  user = OPS,
) =>
  adminPost(
    ctx,
    user,
    createTipRefundAction,
    { id: tipId },
    {
      amountCents,
      reason: "Passenger asked",
      expectedMaxRefundableCents,
      idempotencyKey,
    },
  );

describe("operator tip refunds", () => {
  it("refunds part and then the rest of a paid tip, never more", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const { tipId } = await paidTip(rideId, 600);
    expect((await detail(rideId)).earnings.tipRefundable).toMatchObject({
      capturedCents: 600,
      maxRefundableCents: 600,
      refundable: true,
    });

    const key = randomUUID();
    const first = await refundTip(tipId, 200, 600, key);
    expect(first.status).toBe(201);
    expect(first.json.data).toMatchObject({
      status: "succeeded",
      duplicate: false,
    });
    const again = await refundTip(tipId, 200, 600, key);
    expect(again.status).toBe(200);
    expect(again.json.data.duplicate).toBe(true);

    expect((await refundTip(tipId, 500, 400)).json.error.code).toBe(
      "EXCEEDS_REFUNDABLE",
    );
    expect((await refundTip(tipId, 100, 600)).json.error.code).toBe(
      "REFUNDABLE_CHANGED",
    );
    expect((await refundTip(tipId, 400, 400)).json.data.status).toBe(
      "succeeded",
    );
    expect((await refundTip(tipId, 1, 0)).json.error.code).toBe(
      "NOT_REFUNDABLE",
    );

    const tipEntries = (await entries(rideId)).filter((e) => e.tip_id);
    expect(tipEntries.map((e) => [e.kind, e.gross_cents])).toEqual([
      ["tip", 600],
      ["tip_refund_adjustment", -200],
      ["tip_refund_adjustment", -400],
    ]);
    expect((await receipt(rideId)).tip).toMatchObject({
      refundedCents: 600,
      refundPendingCents: 0,
    });
    const s = await summary();
    expect(s.confirmed.tipsCents).toBe(600);
    expect(s.confirmed.adjustmentsCents).toBe(-600);
    expect(ctx.stripe.refunds.size).toBe(2);
    expect((await reconcileRide(db, rideId)).ok).toBe(true);

    const { rows: audits } = await db.query(
      `SELECT a.result, a.operator_id, o.user_id FROM mobility.audit_log a
         JOIN mobility.operators o ON o.id = a.operator_id
        WHERE a.action = 'tip_refund_create' ORDER BY a.id`,
    );
    expect(audits.length).toBeGreaterThanOrEqual(5);
    expect(audits.every((a) => a.operator_id)).toBe(true);
  });

  it("shows a pending refund as pending and counts it only when Stripe confirms", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const { tipId } = await paidTip(rideId, 500);
    ctx.stripe.refundMode = "pending";
    const res = await refundTip(tipId, 300, 500);
    expect(res.json.data.status).toBe("pending");
    expect(await kinds(rideId)).not.toContain("tip_refund_adjustment");
    expect((await receipt(rideId)).tip).toMatchObject({
      refundedCents: 0,
      refundPendingCents: 300,
    });
    expect((await detail(rideId)).earnings.tipRefundable?.inFlightCents).toBe(
      300,
    );

    const refundId = [...ctx.stripe.refunds.keys()][0];
    ctx.stripe.setRefund(refundId, { status: "succeeded" });
    for (const id of ["evt_tp_1", "evt_tp_1", "evt_tp_2"]) {
      await webhook("refund.updated", { id: refundId, object: "refund" }, id);
    }
    advanceClock(ctx, 120);
    await sweep(ctx.deps);
    expect(
      (await kinds(rideId)).filter((k) => k === "tip_refund_adjustment"),
    ).toHaveLength(1);
    expect((await receipt(rideId)).tip).toMatchObject({
      refundedCents: 300,
      refundPendingCents: 0,
    });
  });

  it("records declined refunds as failed and retries after a Stripe outage without doubling", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const { tipId } = await paidTip(rideId, 500);
    ctx.stripe.refundMode = "reject";
    const failed = await refundTip(tipId, 100, 500);
    expect(failed.json.data.status).toBe("failed");
    expect(await kinds(rideId)).not.toContain("tip_refund_adjustment");

    ctx.stripe.refundMode = "down";
    const down = await refundTip(tipId, 100, 500);
    expect(down.json.data).toMatchObject({
      status: "creating",
      stripeReachable: false,
    });
    ctx.stripe.refundMode = "succeed";
    advanceClock(ctx, 61);
    await sweep(ctx.deps);
    await sweep(ctx.deps);
    expect(ctx.stripe.refunds.size).toBe(1);
    expect(
      (await detail(rideId)).earnings.tipRefunds.map((r) => r.status),
    ).toEqual(["failed", "succeeded"]);
  });

  it("refuses operators without refund permission, non-operators, unpaid tips and live keys", async () => {
    await makeOperator(ctx, OPS);
    await makeOperator(ctx, VIEWER, "view,support");
    const rideId = await completedRide();
    const { tipId } = await paidTip(rideId, 500);

    const passenger = await refundTip(tipId, 100, 500, randomUUID(), P);
    expect(passenger.json.error.code).toBe("NOT_AN_OPERATOR");
    const driver = await refundTip(tipId, 100, 500, randomUUID(), A);
    expect(driver.status).toBe(403);
    const viewer = await refundTip(tipId, 100, 500, randomUUID(), VIEWER);
    expect(viewer.json.error.code).toBe("PERMISSION_DENIED");
    const { rows } = await db.query(
      "SELECT result FROM mobility.audit_log WHERE action = 'tip_refund_create_denied'",
    );
    expect(rows.length).toBe(3);

    const key = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_live_not_real";
    try {
      const live = await refundTip(tipId, 100, 500);
      expect(live.json.error.code).toBe("LIVE_REFUNDS_DISABLED");
    } finally {
      process.env.STRIPE_SECRET_KEY = key;
    }
    expect(ctx.stripe.refunds.size).toBe(0);
  });

  it("serialises concurrent refunds so the total never exceeds the tip", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const { tipId } = await paidTip(rideId, 500);
    const results = await Promise.all([
      refundTip(tipId, 400, 500),
      refundTip(tipId, 400, 500),
      refundTip(tipId, 400, 500),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const { rows } = await db.query(
      "SELECT refunded_cents FROM mobility.tips WHERE id = $1",
      [tipId],
    );
    expect(rows[0].refunded_cents).toBe(400);
  });
});

describe("refunds made in the Stripe Dashboard", () => {
  it("imports a fare refund once and updates receipt, earnings and reconciliation", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const pi = (await ride(rideId)).stripe_payment_intent_id;
    const refund = await ctx.stripe.createRefund(
      { paymentIntentId: pi, amount: 300, metadata: {} },
      "dashboard-1",
    );
    await webhook("charge.refunded", {
      id: "ch_1",
      object: "charge",
      payment_intent: pi,
    });
    await webhook("refund.created", { id: refund.id, object: "refund" });
    await webhook("refund.updated", { id: refund.id, object: "refund" });

    expect((await ride(rideId)).refunded_cents).toBe(300);
    expect(
      (await entries(rideId)).filter(
        (e) => e.kind === "fare_refund_adjustment",
      ),
    ).toEqual([expect.objectContaining({ gross_cents: -300 })]);
    expect((await receipt(rideId)).refundedCents).toBe(300);
    const d = await detail(rideId);
    expect(d.refunds).toMatchObject([
      {
        source: "stripe",
        status: "succeeded",
        operatorName: "Stripe (outside the app)",
      },
    ]);
    expect(d.earnings.reconciliation.ok).toBe(true);
  });

  it("does not count a pending Dashboard refund until it succeeds", async () => {
    const rideId = await completedRide();
    const pi = (await ride(rideId)).stripe_payment_intent_id;
    ctx.stripe.refundMode = "pending";
    const refund = await ctx.stripe.createRefund(
      { paymentIntentId: pi, amount: 250, metadata: {} },
      "dashboard-2",
    );
    await webhook("refund.created", { id: refund.id, object: "refund" });
    expect((await ride(rideId)).refunded_cents).toBe(0);
    expect(await kinds(rideId)).toEqual(["ride_earning"]);
    expect((await receipt(rideId)).refundPendingCents).toBe(250);

    ctx.stripe.setRefund(refund.id, { status: "succeeded" });
    await webhook("refund.updated", { id: refund.id, object: "refund" });
    expect((await ride(rideId)).refunded_cents).toBe(250);
  });

  it("imports a tip refund made in Stripe", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const { pi } = await paidTip(rideId, 400);
    const refund = await ctx.stripe.createRefund(
      { paymentIntentId: pi, amount: 150, metadata: {} },
      "dashboard-tip",
    );
    await webhook("refund.created", { id: refund.id, object: "refund" });
    const d = await detail(rideId);
    expect(d.earnings.tipRefunds).toMatchObject([
      { source: "stripe", status: "succeeded", amountCents: 150 },
    ]);
    expect((await receipt(rideId)).tip?.refundedCents).toBe(150);
    expect(d.earnings.reconciliation.ok).toBe(true);
  });

  it("handles out-of-order refund events and flags a refund Stripe later reverses", async () => {
    const rideId = await completedRide();
    const pi = (await ride(rideId)).stripe_payment_intent_id;
    const refund = await ctx.stripe.createRefund(
      { paymentIntentId: pi, amount: 200, metadata: {} },
      "dashboard-3",
    );
    await webhook("refund.updated", { id: refund.id, object: "refund" });
    await webhook("refund.created", { id: refund.id, object: "refund" });
    expect(
      (await kinds(rideId)).filter((k) => k === "fare_refund_adjustment"),
    ).toHaveLength(1);

    ctx.stripe.setRefund(refund.id, { status: "failed" });
    await webhook("refund.failed", { id: refund.id, object: "refund" });
    const row = await ride(rideId);
    expect(row).toMatchObject({
      refunded_cents: 200,
      needs_review: true,
      review_reason: "refund_reversed",
    });
    expect(
      (await kinds(rideId)).filter((k) => k === "fare_refund_adjustment"),
    ).toHaveLength(1);
  });

  it("finds refunds and disputes missed by webhooks when an operator refreshes from Stripe", async () => {
    await makeOperator(ctx, OPS);
    await makeOperator(ctx, VIEWER, "view");
    const rideId = await completedRide();
    const pi = (await ride(rideId)).stripe_payment_intent_id;
    await ctx.stripe.createRefund(
      { paymentIntentId: pi, amount: 100, metadata: {} },
      "dashboard-missed",
    );
    ctx.stripe.openDispute(pi, { status: "warning_needs_response" });
    expect((await ride(rideId)).refunded_cents).toBe(0);

    const denied = await adminPost(
      ctx,
      VIEWER,
      syncRideFromStripe,
      { id: rideId },
      {},
    );
    expect(denied.json.error.code).toBe("PERMISSION_DENIED");
    const res = await adminPost(
      ctx,
      OPS,
      syncRideFromStripe,
      { id: rideId },
      {},
    );
    expect(res.json.data).toMatchObject({ fareRefunds: 1, disputes: 1 });
    expect((await ride(rideId)).refunded_cents).toBe(100);
    expect((await detail(rideId)).earnings.disputes).toHaveLength(1);
  });
});

describe("payment disputes", () => {
  it("withdraws and reinstates driver earnings as separate reversible entries", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const r = await ride(rideId);
    const pi = r.stripe_payment_intent_id;
    const fare = r.captured_cents;

    const dp = ctx.stripe.openDispute(pi);
    await webhook("charge.dispute.created", { id: dp, object: "dispute" });
    expect(await kinds(rideId)).toEqual(["ride_earning"]);
    expect(await ride(rideId)).toMatchObject({
      needs_review: true,
      review_reason: "payment_dispute",
    });
    expect((await detail(rideId)).refundable.refundable).toBe(false);
    expect((await summary()).disputes.open).toBe(1);

    ctx.stripe.withdrawDispute(dp);
    await webhook("charge.dispute.funds_withdrawn", {
      id: dp,
      object: "dispute",
    });
    let s = await summary();
    expect(s.confirmed.disputesCents).toBe(-fare);
    expect(s.confirmed.netCents).toBe(0);
    const list = (
      await call(ctx, listEarnings, {
        user: A,
        url: "http://localhost/api/driver/earnings",
      })
    ).json.data as Page<DriverEarningRide>;
    expect(list.items[0]).toMatchObject({
      disputeOpen: true,
      disputesCents: -fare,
      driverShareCents: fare,
    });

    ctx.stripe.reinstateDispute(dp);
    ctx.stripe.setDispute(dp, { status: "won" });
    await webhook("charge.dispute.funds_reinstated", {
      id: dp,
      object: "dispute",
    });
    await webhook("charge.dispute.closed", { id: dp, object: "dispute" });

    expect(await kinds(rideId)).toEqual([
      "ride_earning",
      "dispute_withdrawal",
      "dispute_reinstatement",
    ]);
    s = await summary();
    expect(s.confirmed.disputesCents).toBe(0);
    expect(s.confirmed.netCents).toBe(fare);
    expect(s.disputes.open).toBe(0);
    const d = await detail(rideId);
    expect(d.earnings.disputes[0]).toMatchObject({
      status: "won",
      fundsWithdrawnCents: fare,
      fundsReinstatedCents: fare,
      needsReview: false,
    });
    expect(d.earnings.reconciliation.ok).toBe(true);
    expect((await receipt(rideId)).disputes).toEqual([
      { subject: "fare", status: "won", amountCents: fare },
    ]);
  });

  it("keeps funds withdrawn when a dispute is lost", async () => {
    const rideId = await completedRide();
    const pi = (await ride(rideId)).stripe_payment_intent_id;
    const dp = ctx.stripe.openDispute(pi);
    ctx.stripe.withdrawDispute(dp);
    ctx.stripe.setDispute(dp, { status: "lost" });
    await webhook("charge.dispute.closed", { id: dp, object: "dispute" });
    const { rows } = await db.query(
      "SELECT status, closed_at, needs_review FROM mobility.disputes",
    );
    expect(rows[0]).toMatchObject({ status: "lost", needs_review: false });
    expect(rows[0].closed_at).not.toBeNull();
    expect((await summary()).confirmed.netCents).toBe(0);
  });

  it("converges on Stripe's state for replayed, concurrent and out-of-order events", async () => {
    const rideId = await completedRide();
    const pi = (await ride(rideId)).stripe_payment_intent_id;
    const dp = ctx.stripe.openDispute(pi);
    ctx.stripe.withdrawDispute(dp);
    ctx.stripe.reinstateDispute(dp);
    ctx.stripe.setDispute(dp, { status: "won" });

    await webhook(
      "charge.dispute.funds_reinstated",
      { id: dp, object: "dispute" },
      "evt_late",
    );
    await Promise.all([
      webhook("charge.dispute.created", { id: dp, object: "dispute" }),
      webhook("charge.dispute.funds_withdrawn", { id: dp, object: "dispute" }),
      webhook(
        "charge.dispute.funds_reinstated",
        { id: dp, object: "dispute" },
        "evt_late",
      ),
    ]);
    advanceClock(ctx, 3601);
    await sweep(ctx.deps);
    expect(await kinds(rideId)).toEqual([
      "ride_earning",
      "dispute_withdrawal",
      "dispute_reinstatement",
    ]);
    expect((await reconcileRide(db, rideId)).ok).toBe(true);
  });

  it("applies tip disputes to the tip and blocks tip refunds while open", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const { tipId, pi } = await paidTip(rideId, 500);
    const dp = ctx.stripe.openDispute(pi);
    ctx.stripe.withdrawDispute(dp);
    await webhook("charge.dispute.created", { id: dp, object: "dispute" });
    const tipDisputes = (await entries(rideId)).filter(
      (e) => e.kind === "dispute_withdrawal",
    );
    expect(tipDisputes).toEqual([
      expect.objectContaining({ gross_cents: -500, tip_id: tipId }),
    ]);
    expect((await refundTip(tipId, 100, 500)).json.error.code).toBe(
      "NOT_REFUNDABLE",
    );
    expect((await summary()).confirmed.netCents).toBe(
      (await ride(rideId)).captured_cents,
    );
  });

  it("flags uncertain cases for review instead of guessing", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const r = await ride(rideId);
    const refund = await ctx.stripe.createRefund(
      {
        paymentIntentId: r.stripe_payment_intent_id,
        amount: 400,
        metadata: {},
      },
      "dashboard-before-dispute",
    );
    await webhook("refund.created", { id: refund.id, object: "refund" });
    const dp = ctx.stripe.openDispute(r.stripe_payment_intent_id, {
      amount: r.captured_cents,
    });
    ctx.stripe.withdrawDispute(dp);
    await webhook("charge.dispute.funds_withdrawn", {
      id: dp,
      object: "dispute",
    });

    const withdrawn = (await entries(rideId)).filter(
      (e) => e.kind === "dispute_withdrawal",
    );
    expect(withdrawn).toEqual([
      expect.objectContaining({ gross_cents: -(r.captured_cents - 400) }),
    ]);
    const d = await detail(rideId);
    expect(d.earnings.disputes[0].needsReview).toBe(true);
    expect(d.earnings.disputes[0].reviewNote).toMatch(/Stripe reports/);
    expect(d.earnings.reconciliation.ok).toBe(false);

    const stray = await ctx.stripe.createPaymentIntent(
      { amount: 999, currency: "usd", customer: "cus_x", metadata: {} },
      "stray-intent",
    );
    ctx.stripe.pay(stray.id);
    const unknown = ctx.stripe.openDispute(stray.id);
    await webhook("charge.dispute.created", { id: unknown, object: "dispute" });
    const { rows } = await db.query(
      "SELECT subject, needs_review, review_note FROM mobility.disputes WHERE stripe_dispute_id = $1",
      [unknown],
    );
    expect(rows[0]).toMatchObject({ subject: "unknown", needs_review: true });
  });
});
