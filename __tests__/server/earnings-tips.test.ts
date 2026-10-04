import { randomUUID } from "node:crypto";

import { reconcileRide } from "../../server/earnings";
import {
  COMMISSION_POLICIES,
  policyAt,
  refundSplit,
  splitAmount,
  validatePolicies,
} from "../../server/earningsPolicy";
import {
  applyRefundSnapshot,
  createOperatorRefund,
} from "../../server/refunds";
import { sweep } from "../../server/rides";
import {
  earningsSummary,
  listEarnings,
  rideEarnings,
} from "../../server/routes/earnings";
import {
  cancelTipPayment,
  createTip,
  getTip,
  refreshTipPayment,
} from "../../server/routes/tips";
import { stripeWebhook } from "../../server/routes/webhook";
import { TIPS } from "../../server/tips";

import {
  call,
  createContext,
  resetDb,
  signWebhook,
  testDb,
  type TestContext,
} from "./helpers";
import {
  advanceClock,
  assertInvariants,
  assign,
  assignedRide,
  cancel,
  drive,
  interrupt,
  makeOperator,
  onlineDriver,
  requestRide,
} from "./scenario";

import type {
  DriverEarningRide,
  EarningsSummary,
  Page,
  TipCheckout,
  TipState,
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
const Q = "user_other_passenger";
const A = "user_driver_a";
const B = "user_driver_b";
const OPS = "user_operator";

const summary = async (driver: string, query: Record<string, string> = {}) => {
  const res = await call(ctx, earningsSummary, {
    user: driver,
    url: `http://localhost/api/driver/earnings/summary?${new URLSearchParams(query)}`,
  });
  return res;
};

const earningsList = (driver: string, query: Record<string, string> = {}) =>
  call(ctx, listEarnings, {
    user: driver,
    url: `http://localhost/api/driver/earnings?${new URLSearchParams(query)}`,
  });

const entries = async (rideId: string) =>
  (
    await db.query(
      `SELECT kind, gross_cents, commission_cents, driver_amount_cents, policy_version
         FROM mobility.earning_entries WHERE ride_id = $1 ORDER BY id`,
      [rideId],
    )
  ).rows;

const earningRow = async (rideId: string) =>
  (
    await db.query("SELECT * FROM mobility.ride_earnings WHERE ride_id = $1", [
      rideId,
    ])
  ).rows[0];

const rideRow = async (rideId: string) =>
  (await db.query("SELECT * FROM mobility.rides WHERE id = $1", [rideId]))
    .rows[0];

const startTip = (
  user: string,
  rideId: string,
  amountCents: number,
  idempotencyKey: string = randomUUID(),
  consent: unknown = true,
) =>
  call(ctx, createTip, {
    user,
    params: { id: rideId },
    body: { amountCents, idempotencyKey, consent },
  });

const tipState = async (user: string, rideId: string) =>
  (await call(ctx, getTip, { user, params: { id: rideId } })).json
    .data as TipState;

const refreshTip = (user: string, rideId: string) =>
  call(ctx, refreshTipPayment, {
    user,
    params: { id: rideId },
    body: {},
  });

const webhook = (id: string, type: string, object: object) => {
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

async function completedRide(passenger = P, driver = A) {
  const rideId = await assignedRide(ctx, passenger, driver);
  await drive(ctx, driver, rideId);
  return rideId;
}

async function withPolicy<T>(
  policy: { version: string; effectiveFrom: Date; fareBps: number },
  fn: () => Promise<T>,
) {
  COMMISSION_POLICIES.push({
    version: policy.version,
    effectiveFrom: policy.effectiveFrom.toISOString(),
    fareCommissionBps: policy.fareBps,
    tipCommissionBps: 0,
    label: "test policy",
  });
  try {
    return await fn();
  } finally {
    COMMISSION_POLICIES.pop();
  }
}

async function operatorRefund(rideId: string, amountCents: number) {
  const { rows } = await db.query(
    `SELECT o.id, o.display_name, u.clerk_id FROM mobility.operators o
       JOIN mobility.users u ON u.id = o.user_id WHERE u.clerk_id = $1`,
    [OPS],
  );
  const ride = await rideRow(rideId);
  const { rows: flight } = await db.query(
    "SELECT COALESCE(sum(amount_cents), 0)::int AS n FROM mobility.refunds WHERE ride_id = $1 AND status IN ('creating','pending','requires_action')",
    [rideId],
  );
  return createOperatorRefund(ctx.deps, {
    rideId,
    amountCents,
    reason: "test refund",
    expectedMaxRefundableCents:
      ride.captured_cents - ride.refunded_cents - flight[0].n,
    idempotencyKey: randomUUID(),
    operator: rows[0],
  });
}

describe("commission policy", () => {
  it("is defined once, versioned and valid, with a labelled 0% default", () => {
    expect(validatePolicies(COMMISSION_POLICIES)).toEqual([]);
    expect(policyAt(new Date())).toMatchObject({
      version: "dev-0",
      fareCommissionBps: 0,
      tipCommissionBps: 0,
    });
    expect(policyAt(new Date()).label).toMatch(/Development default/);
    expect(
      validatePolicies([
        { ...COMMISSION_POLICIES[0] },
        { ...COMMISSION_POLICIES[0], fareCommissionBps: 20_001 },
      ]),
    ).toEqual(
      expect.arrayContaining([
        "duplicate version dev-0",
        "dev-0 has an invalid rate",
      ]),
    );
  });

  it("splits in integer cents and refunds exactly the recorded share", () => {
    expect(splitAmount(1999, 2000)).toEqual({
      commissionCents: 400,
      driverCents: 1599,
    });
    expect(splitAmount(1999, 0)).toEqual({
      commissionCents: 0,
      driverCents: 1999,
    });
    const earning = { fare_cents: 1999, driver_share_cents: 1599 };
    const first = refundSplit(earning, 0, 333);
    const rest = refundSplit(earning, 333, 5000);
    expect(first.grossCents + rest.grossCents).toBe(1999);
    expect(first.driverCents + rest.driverCents).toBe(1599);
    expect(first.commissionCents + rest.commissionCents).toBe(400);
  });
});

describe("earnings from captured fares", () => {
  it("records one earning when Stripe confirms the capture", async () => {
    const rideId = await completedRide();
    const ride = await rideRow(rideId);
    expect(ride.payment_status).toBe("paid");
    expect(await earningRow(rideId)).toMatchObject({
      fare_cents: ride.captured_cents,
      commission_policy_version: "dev-0",
      commission_rate_bps: 0,
      commission_cents: 0,
      driver_share_cents: ride.captured_cents,
    });
    expect(await entries(rideId)).toEqual([
      {
        kind: "ride_earning",
        gross_cents: ride.captured_cents,
        commission_cents: 0,
        driver_amount_cents: ride.captured_cents,
        policy_version: "dev-0",
      },
    ]);

    const s = (await summary(A)).json.data as EarningsSummary;
    expect(s.confirmed).toMatchObject({
      rides: 1,
      fareCents: ride.captured_cents,
      driverShareCents: ride.captured_cents,
      netCents: ride.captured_cents,
    });
    expect(s.pending.rides).toBe(0);
    expect(s.payouts.available).toBe(false);
    expect(JSON.stringify(s)).not.toMatch(/paidOut|paid_out/);
  });

  it("keeps a pending capture out of earnings until Stripe confirms it, then counts it once", async () => {
    const rideId = await assignedRide(ctx, P, A);
    ctx.stripe.failNext.capture = true;
    await drive(ctx, A, rideId);
    expect((await rideRow(rideId)).payment_status).toBe("authorized");
    expect(await earningRow(rideId)).toBeUndefined();

    const s = (await summary(A)).json.data as EarningsSummary;
    expect(s.confirmed.netCents).toBe(0);
    expect(s.pending).toMatchObject({ rides: 1 });
    const list = (await earningsList(A)).json.data as Page<DriverEarningRide>;
    expect(list.items[0]).toMatchObject({
      state: "pending",
      driverShareCents: null,
      netCents: 0,
    });

    advanceClock(ctx, 31);
    await sweep(ctx.deps);
    await sweep(ctx.deps);
    const intentId = (await rideRow(rideId)).stripe_payment_intent_id;
    await webhook("evt_capture_1", "payment_intent.succeeded", {
      id: intentId,
      object: "payment_intent",
    });
    await webhook("evt_capture_1", "payment_intent.succeeded", {
      id: intentId,
      object: "payment_intent",
    });
    await webhook("evt_capture_2", "payment_intent.succeeded", {
      id: intentId,
      object: "payment_intent",
    });
    expect((await entries(rideId)).map((e) => e.kind)).toEqual([
      "ride_earning",
    ]);
    const after = (await summary(A)).json.data as EarningsSummary;
    expect(after.pending.rides).toBe(0);
    expect(after.confirmed.rides).toBe(1);
  });

  it("never earns on cancelled or interrupted rides", async () => {
    const cancelled = await assignedRide(ctx, P, A);
    await cancel(ctx, P, cancelled);
    const interrupted = await requestRide(ctx, P);
    await assign(ctx, A, interrupted.rideId);
    await drive(ctx, A, interrupted.rideId, "in_progress");
    await interrupt(ctx, A, interrupted.rideId);
    await sweep(ctx.deps);

    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.earning_entries",
    );
    expect(rows[0].n).toBe(0);
    const s = (await summary(A)).json.data as EarningsSummary;
    expect(s.confirmed.netCents).toBe(0);
    expect(s.pending.rides).toBe(0);
    expect(
      ((await earningsList(A)).json.data as Page<DriverEarningRide>).items,
    ).toEqual([]);
  });

  it("stores the commission rate on each ride so later policies don't rewrite history", async () => {
    await onlineDriver(ctx, A);
    const first = await requestRide(ctx, P);
    await assign(ctx, A, first.rideId);
    await drive(ctx, A, first.rideId);
    advanceClock(ctx, 10);

    await withPolicy(
      {
        version: "test-20",
        effectiveFrom: new Date(ctx.clock.now.getTime() - 5000),
        fareBps: 2000,
      },
      async () => {
        const second = await requestRide(ctx, Q);
        await assign(ctx, A, second.rideId);
        await drive(ctx, A, second.rideId);
        const fare = (await rideRow(second.rideId)).captured_cents;
        expect(await earningRow(second.rideId)).toMatchObject({
          commission_policy_version: "test-20",
          commission_rate_bps: 2000,
          commission_cents: splitAmount(fare, 2000).commissionCents,
        });
      },
    );
    expect(await earningRow(first.rideId)).toMatchObject({
      commission_policy_version: "dev-0",
      commission_rate_bps: 0,
      commission_cents: 0,
    });
    const s = (await summary(A)).json.data as EarningsSummary;
    expect(s.confirmed.rides).toBe(2);
    expect(s.confirmed.commissionCents).toBeGreaterThan(0);
    expect(s.confirmed.fareCents).toBe(
      s.confirmed.commissionCents + s.confirmed.driverShareCents,
    );
  });
});

describe("refund adjustments", () => {
  it("records partial and full refunds as separate, proportional adjustments", async () => {
    await makeOperator(ctx, OPS);
    await withPolicy(
      {
        version: "test-15",
        effectiveFrom: new Date("2000-01-01T00:00:00Z"),
        fareBps: 1500,
      },
      async () => {
        const rideId = await completedRide();
        const earning = await earningRow(rideId);

        const partial = await operatorRefund(rideId, 333);
        expect(partial.refund.status).toBe("succeeded");
        const rest = await operatorRefund(rideId, earning.fare_cents - 333);
        expect(rest.refund.status).toBe("succeeded");

        const rows = await entries(rideId);
        expect(rows.map((e) => e.kind)).toEqual([
          "ride_earning",
          "fare_refund_adjustment",
          "fare_refund_adjustment",
        ]);
        expect(rows[0]).toMatchObject({
          gross_cents: earning.fare_cents,
          driver_amount_cents: earning.driver_share_cents,
        });
        const adj = rows.slice(1);
        expect(adj[0].gross_cents).toBe(-333);
        expect(adj.reduce((s, e) => s + e.driver_amount_cents, 0)).toBe(
          -earning.driver_share_cents,
        );
        expect(adj.reduce((s, e) => s + e.commission_cents, 0)).toBe(
          -earning.commission_cents,
        );

        const ride = (
          await call(ctx, rideEarnings, {
            user: A,
            params: { id: rideId },
          })
        ).json.data as DriverEarningRide;
        expect(ride).toMatchObject({
          state: "confirmed",
          driverShareCents: earning.driver_share_cents,
          adjustmentsCents: -earning.driver_share_cents,
          netCents: 0,
        });
        expect((await reconcileRide(db, rideId)).ok).toBe(true);
      },
    );
  });

  it("waits for Stripe before adjusting, and ignores replays", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    ctx.stripe.refundMode = "pending";
    const result = await operatorRefund(rideId, 200);
    expect(result.refund.status).toBe("pending");
    expect((await entries(rideId)).length).toBe(1);

    const stripeId = result.refund.stripe_refund_id!;
    ctx.stripe.setRefund(stripeId, { status: "succeeded" });
    for (const id of ["evt_r1", "evt_r1", "evt_r2"]) {
      await webhook(id, "refund.updated", { id: stripeId, object: "refund" });
    }
    await applyRefundSnapshot(db, await ctx.stripe.retrieveRefund(stripeId));
    const adj = (await entries(rideId)).filter(
      (e) => e.kind === "fare_refund_adjustment",
    );
    expect(adj).toHaveLength(1);
    expect(adj[0].gross_cents).toBe(-200);
  });
});

describe("earnings ownership and privacy", () => {
  it("shows each driver only their own earnings, without passenger payment details", async () => {
    const rideId = await completedRide();
    await onlineDriver(ctx, B, 900);

    expect(
      (await call(ctx, rideEarnings, { user: B, params: { id: rideId } }))
        .status,
    ).toBe(404);
    expect(
      ((await earningsList(B)).json.data as Page<DriverEarningRide>).items,
    ).toEqual([]);
    expect(
      ((await summary(B)).json.data as EarningsSummary).confirmed.netCents,
    ).toBe(0);

    const notDriver = await summary(P);
    expect(notDriver.status).toBe(403);
    expect(notDriver.json.error.code).toBe("NOT_A_DRIVER");
    expect((await earningsList(P)).status).toBe(403);

    const body = JSON.stringify((await earningsList(A)).json.data);
    expect(body).toContain(rideId);
    expect(body).not.toMatch(/pi_\d|cus_|user_passenger|passenger|email|card/i);
  });

  it("paginates completed rides for the selected period", async () => {
    await onlineDriver(ctx, A);
    for (const rider of ["user_r1", "user_r2", "user_r3"]) {
      const { rideId } = await requestRide(ctx, rider);
      await assign(ctx, A, rideId);
      await drive(ctx, A, rideId);
      advanceClock(ctx, 5);
    }
    const page1 = (await earningsList(A, { limit: "2" })).json
      .data as Page<DriverEarningRide>;
    expect(page1.items).toHaveLength(2);
    const page2 = (
      await earningsList(A, { limit: "2", cursor: page1.nextCursor! })
    ).json.data as Page<DriverEarningRide>;
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect(
      new Set([...page1.items, ...page2.items].map((r) => r.rideId)).size,
    ).toBe(3);

    const future = new Date(ctx.clock.now.getTime() + 3600_000).toISOString();
    const empty = (await summary(A, { from: future })).json
      .data as EarningsSummary;
    expect(empty.confirmed.rides).toBe(0);
  });
});

describe("tips", () => {
  it("requires explicit consent and a server-limited amount, and never charges on its own", async () => {
    const rideId = await completedRide();
    const missingConsent = await call(ctx, createTip, {
      user: P,
      params: { id: rideId },
      body: { amountCents: 300, idempotencyKey: randomUUID() },
    });
    expect(missingConsent.status).toBe(400);
    expect((await startTip(P, rideId, 300, randomUUID(), false)).status).toBe(
      400,
    );
    expect((await startTip(P, rideId, 99)).status).toBe(400);
    expect((await startTip(P, rideId, 5001)).status).toBe(400);

    const created = await startTip(P, rideId, 300);
    expect(created.status).toBe(200);
    const checkout = created.json.data as TipCheckout;
    expect(checkout.tip).toMatchObject({ amountCents: 300, status: "pending" });
    const tipIntent = checkout.paymentIntentClientSecret.split("_secret")[0];
    expect(tipIntent).not.toBe(
      (await rideRow(rideId)).stripe_payment_intent_id,
    );
    expect(ctx.stripe.intentInputs.get(tipIntent)).toMatchObject({
      captureMethod: "automatic",
      description: "Tip for your driver",
    });
    expect(ctx.stripe.intents.get(tipIntent)?.status).toBe(
      "requires_payment_method",
    );
    expect((await entries(rideId)).map((e) => e.kind)).toEqual([
      "ride_earning",
    ]);
  });

  it("is only for the passenger of a completed, paid, real trip", async () => {
    const active = await assignedRide(ctx, P, A);
    expect((await startTip(P, active, 300)).json.error.code).toBe(
      "TIP_NOT_ALLOWED",
    );
    await cancel(ctx, P, active);
    expect((await startTip(P, active, 300)).status).toBe(409);

    const interrupted = await requestRide(ctx, P);
    await assign(ctx, A, interrupted.rideId);
    await drive(ctx, A, interrupted.rideId, "in_progress");
    await interrupt(ctx, A, interrupted.rideId);
    expect((await startTip(P, interrupted.rideId, 300)).status).toBe(409);

    const unpaid = await requestRide(ctx, P);
    await assign(ctx, A, unpaid.rideId);
    ctx.stripe.failNext.capture = true;
    await drive(ctx, A, unpaid.rideId);
    const res = await startTip(P, unpaid.rideId, 300);
    expect(res.status).toBe(409);
    expect((await tipState(P, unpaid.rideId)).reason).toBe("payment_pending");

    advanceClock(ctx, 31);
    await sweep(ctx.deps);
    expect((await tipState(P, unpaid.rideId)).eligible).toBe(true);
    expect((await startTip(A, unpaid.rideId, 300)).status).toBe(404);
    expect((await startTip(Q, unpaid.rideId, 300)).status).toBe(404);

    advanceClock(ctx, 8 * 24 * 3600);
    expect((await tipState(P, unpaid.rideId)).reason).toBe("window_closed");
  });

  it("counts a tip only after Stripe confirms it, including after a decline", async () => {
    const rideId = await completedRide();
    const checkout = (await startTip(P, rideId, 500)).json.data as TipCheckout;
    const pi = checkout.paymentIntentClientSecret.split("_secret")[0];

    ctx.stripe.decline(pi);
    const declined = (await refreshTip(P, rideId)).json.data as TipState;
    expect(declined.tip).toMatchObject({ status: "failed" });
    expect(declined.tip?.lastError).toMatch(/declined/);
    expect((await entries(rideId)).some((e) => e.kind === "tip")).toBe(false);

    ctx.stripe.setIntent(pi, {
      status: "requires_action",
      hasPaymentError: false,
    });
    expect(
      ((await refreshTip(P, rideId)).json.data as TipState).tip?.status,
    ).toBe("requires_action");
    expect((await entries(rideId)).some((e) => e.kind === "tip")).toBe(false);

    const retry = (await startTip(P, rideId, 500)).json.data as TipCheckout;
    expect(retry.paymentIntentClientSecret).toBe(
      checkout.paymentIntentClientSecret,
    );
    ctx.stripe.pay(pi);
    const paid = (await refreshTip(P, rideId)).json.data as TipState;
    expect(paid.tip).toMatchObject({ status: "succeeded" });
    expect(paid.eligible).toBe(false);
    expect(paid.reason).toBe("already_tipped");

    const tipEntries = (await entries(rideId)).filter((e) => e.kind === "tip");
    expect(tipEntries).toEqual([
      {
        kind: "tip",
        gross_cents: 500,
        commission_cents: 0,
        driver_amount_cents: 500,
        policy_version: "dev-0",
      },
    ]);
    const s = (await summary(A)).json.data as EarningsSummary;
    expect(s.confirmed.tipsCents).toBe(500);
    const list = (await earningsList(A)).json.data as Page<DriverEarningRide>;
    expect(list.items[0].tip).toEqual({
      amountCents: 500,
      status: "paid",
      refundedCents: 0,
    });
    expect((await startTip(P, rideId, 500)).json.error.code).toBe(
      "TIP_ALREADY_PAID",
    );
  });

  it("prevents duplicate tips under retries, concurrent taps and changed amounts", async () => {
    const rideId = await completedRide();
    const key = randomUUID();
    const before = ctx.stripe.intents.size;
    const results = await Promise.all([
      startTip(P, rideId, 400, key),
      startTip(P, rideId, 400, key),
      startTip(P, rideId, 400),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const secrets = new Set(
      results.map(
        (r) => (r.json.data as TipCheckout).paymentIntentClientSecret,
      ),
    );
    expect(secrets.size).toBe(1);
    expect(ctx.stripe.intents.size - before).toBe(1);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.tips WHERE ride_id = $1",
      [rideId],
    );
    expect(rows[0].n).toBe(1);

    expect((await startTip(P, rideId, 700)).json.error.code).toBe(
      "TIP_IN_PROGRESS",
    );
    const reused = await startTip(P, rideId, 700, key);
    expect(reused.status).toBe(409);
    expect(["IDEMPOTENCY_KEY_REUSED", "TIP_IN_PROGRESS"]).toContain(
      reused.json.error.code,
    );

    const cancelled = await call(ctx, cancelTipPayment, {
      user: P,
      params: { id: rideId },
      body: {},
    });
    expect((cancelled.json.data as TipState).tip).toBeNull();
    const pi = (
      results[0].json.data as TipCheckout
    ).paymentIntentClientSecret.split("_secret")[0];
    expect(ctx.stripe.intents.get(pi)?.status).toBe("canceled");
    expect((await startTip(P, rideId, 700)).status).toBe(200);
  });

  it("recovers a tip paid while the app was closed, and ignores webhook replays", async () => {
    const rideId = await completedRide();
    const checkout = (await startTip(P, rideId, 250)).json.data as TipCheckout;
    const pi = checkout.paymentIntentClientSecret.split("_secret")[0];
    ctx.stripe.pay(pi);

    advanceClock(ctx, TIPS.syncAfterSeconds + 1);
    await sweep(ctx.deps);
    expect((await tipState(P, rideId)).tip?.status).toBe("succeeded");

    for (const id of ["evt_tip_1", "evt_tip_1", "evt_tip_2"]) {
      await webhook(id, "payment_intent.succeeded", {
        id: pi,
        object: "payment_intent",
      });
    }
    await refreshTip(P, rideId);
    expect(
      (await entries(rideId)).filter((e) => e.kind === "tip"),
    ).toHaveLength(1);
    expect((await reconcileRide(db, rideId)).ok).toBe(true);
  });

  it("confirms a tip from the webhook alone", async () => {
    const rideId = await completedRide();
    const checkout = (await startTip(P, rideId, 300)).json.data as TipCheckout;
    const pi = checkout.paymentIntentClientSecret.split("_secret")[0];
    ctx.stripe.pay(pi);
    await webhook("evt_tip_only", "payment_intent.succeeded", {
      id: pi,
      object: "payment_intent",
    });
    const receiptTip = (await tipState(P, rideId)).tip;
    expect(receiptTip?.status).toBe("succeeded");
    expect((await entries(rideId)).map((e) => e.kind)).toEqual([
      "ride_earning",
      "tip",
    ]);
  });

  it("adjusts earnings for a tip refunded in Stripe, once", async () => {
    const rideId = await completedRide();
    const checkout = (await startTip(P, rideId, 600)).json.data as TipCheckout;
    const pi = checkout.paymentIntentClientSecret.split("_secret")[0];
    ctx.stripe.pay(pi);
    await refreshTip(P, rideId);

    const refund = await ctx.stripe.createRefund(
      { paymentIntentId: pi, amount: 200, metadata: {} },
      "dashboard-refund",
    );
    for (const id of ["evt_tr_1", "evt_tr_1", "evt_tr_2"]) {
      await webhook(id, "charge.refunded", {
        id: "ch_1",
        object: "charge",
        payment_intent: pi,
      });
    }
    await webhook("evt_tr_3", "refund.updated", {
      id: refund.id,
      object: "refund",
    });
    const adj = (await entries(rideId)).filter(
      (e) => e.kind === "tip_refund_adjustment",
    );
    expect(adj).toEqual([
      expect.objectContaining({ gross_cents: -200, driver_amount_cents: -200 }),
    ]);
    const state = await tipState(P, rideId);
    expect(state.tip).toMatchObject({
      status: "succeeded",
      refundedCents: 200,
    });
    const s = (await summary(A)).json.data as EarningsSummary;
    expect(s.confirmed.tipsCents).toBe(600);
    expect(s.confirmed.adjustmentsCents).toBe(-200);
    expect((await reconcileRide(db, rideId)).ok).toBe(true);
  });

  it("cancels abandoned tips without charging", async () => {
    const rideId = await completedRide();
    const checkout = (await startTip(P, rideId, 300)).json.data as TipCheckout;
    const pi = checkout.paymentIntentClientSecret.split("_secret")[0];
    advanceClock(ctx, TIPS.abandonAfterSeconds + 120);
    await sweep(ctx.deps);
    expect(ctx.stripe.intents.get(pi)?.status).toBe("canceled");
    expect((await tipState(P, rideId)).tip).toBeNull();
  });
});

describe("reconciliation", () => {
  it("detects and heals a missing ledger entry from the payment ledger", async () => {
    const rideId = await completedRide();
    await db.query("DELETE FROM mobility.earning_entries WHERE ride_id = $1", [
      rideId,
    ]);
    const broken = await reconcileRide(db, rideId);
    expect(broken.ok).toBe(false);
    expect(broken.issues).toContain("earning ledger entry missing");

    await sweep(ctx.deps);
    await sweep(ctx.deps);
    expect(await reconcileRide(db, rideId)).toEqual({ ok: true, issues: [] });
    expect((await entries(rideId)).map((e) => e.kind)).toEqual([
      "ride_earning",
    ]);
  });
});
