import { type Database, type SqlClient, transaction } from "./db";
import { recordTipRefund, type TipLedgerRow } from "./earnings";
import { ApiError } from "./errors";
import { flagRideReview } from "./review";

import type { PaymentGateway, RefundSnapshot } from "./payments";
import type { RefundableSummary } from "../shared/contracts";

const OPEN = ["creating", "pending", "requires_action"];
const STATUSES = [
  "pending",
  "requires_action",
  "succeeded",
  "failed",
  "canceled",
];

export interface TipRefundRow {
  id: string;
  tip_id: string;
  ride_id: string;
  amount_cents: number;
  status: string;
  source: "operator" | "stripe";
  reason: string;
  operator_id: string | null;
  idempotency_key: string;
  stripe_refund_id: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

interface TipChargeRow extends TipLedgerRow {
  status: string;
  refunded_cents: number;
}

export function tipRefundableSummary(
  tip: { status: string; amount_cents: number; refunded_cents: number },
  inFlightCents: number,
  openDispute: boolean,
): RefundableSummary {
  const captured = tip.status === "succeeded" ? tip.amount_cents : 0;
  const max = Math.max(0, captured - tip.refunded_cents - inFlightCents);
  const reason =
    tip.status !== "succeeded"
      ? "This tip hasn't been paid, so there is nothing to refund."
      : openDispute
        ? "This tip is under a payment dispute. Handle it in the Stripe Dashboard."
        : inFlightCents > 0
          ? "Another refund for this tip is still in progress."
          : max === 0
            ? "The tip has already been fully refunded."
            : null;
  return {
    capturedCents: captured,
    refundedCents: tip.refunded_cents,
    inFlightCents,
    maxRefundableCents: max,
    refundable: reason === null,
    reasonNotRefundable: reason,
  };
}

export async function tipInFlightCents(db: SqlClient, tipId: string) {
  const { rows } = await db.query<{ cents: number }>(
    `SELECT COALESCE(sum(amount_cents), 0)::int AS cents FROM mobility.tip_refunds
      WHERE tip_id = $1 AND status = ANY($2::text[])`,
    [tipId, OPEN],
  );
  return rows[0].cents;
}

export async function tipHasOpenDispute(db: SqlClient, tipId: string) {
  const { rows } = await db.query(
    "SELECT 1 FROM mobility.disputes WHERE tip_id = $1 AND closed_at IS NULL",
    [tipId],
  );
  return rows.length > 0;
}

export async function applyTipRefundSnapshot(
  db: Database,
  snapshot: RefundSnapshot,
  now: Date,
): Promise<boolean> {
  const status = STATUSES.includes(snapshot.status)
    ? snapshot.status
    : "pending";
  return transaction(db, async (tx) => {
    let refund = await lockByStripeId(tx, snapshot.id);
    if (!refund) {
      if (!snapshot.paymentIntentId) return false;
      const { rows: tips } = await tx.query<{ id: string; ride_id: string }>(
        "SELECT id, ride_id FROM mobility.tips WHERE stripe_payment_intent_id = $1",
        [snapshot.paymentIntentId],
      );
      if (!tips[0]) return false;
      await tx.query(
        `INSERT INTO mobility.tip_refunds
           (tip_id, ride_id, amount_cents, status, source, reason, idempotency_key,
            stripe_refund_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'creating', 'stripe',
                 'Refunded outside the app (Stripe Dashboard or API)', $4, $5, $6, $6)
         ON CONFLICT (stripe_refund_id) DO NOTHING`,
        [
          tips[0].id,
          tips[0].ride_id,
          snapshot.amount,
          `stripe:${snapshot.id}`,
          snapshot.id,
          now,
        ],
      );
      refund = await lockByStripeId(tx, snapshot.id);
      if (!refund) return false;
    }
    if (refund.status === status) return true;
    if (refund.status === "succeeded") {
      if (status === "failed" || status === "canceled") {
        await flagRideReview(tx, refund.ride_id, "refund_reversed");
        await tx.query(
          "UPDATE mobility.tip_refunds SET last_error = $2, updated_at = $3 WHERE id = $1",
          [refund.id, `Stripe now reports this refund as ${status}`, now],
        );
      }
      return true;
    }
    if (!OPEN.includes(refund.status) && status !== "succeeded") return true;

    await tx.query(
      `UPDATE mobility.tip_refunds SET status = $2, last_error = $3, updated_at = $4
        WHERE id = $1`,
      [refund.id, status, snapshot.failureReason, now],
    );
    if (status === "succeeded") {
      const { rows } = await tx.query<TipChargeRow>(
        "SELECT * FROM mobility.tips WHERE id = $1 FOR UPDATE",
        [refund.tip_id],
      );
      const tip = rows[0];
      if (tip.status !== "succeeded") {
        await flagRideReview(tx, refund.ride_id, "refund_mismatch");
        return true;
      }
      await recordTipRefund(tx, tip, snapshot.id, refund.amount_cents, now);
      await tx.query(
        `UPDATE mobility.tips
            SET refunded_cents = LEAST(amount_cents, (
                  SELECT COALESCE(sum(amount_cents), 0)::int FROM mobility.tip_refunds
                   WHERE tip_id = $1 AND status = 'succeeded')),
                updated_at = $2
          WHERE id = $1`,
        [tip.id, now],
      );
    }
    return true;
  });
}

async function lockByStripeId(tx: SqlClient, stripeRefundId: string) {
  const { rows } = await tx.query<TipRefundRow>(
    "SELECT * FROM mobility.tip_refunds WHERE stripe_refund_id = $1 FOR UPDATE",
    [stripeRefundId],
  );
  return rows[0] ?? null;
}

async function submitTipRefund(
  deps: { db: Database; payments: PaymentGateway; now: () => Date },
  refund: TipRefundRow,
  paymentIntentId: string,
): Promise<{
  refund: TipRefundRow;
  outcome: "submitted" | "failed" | "unknown";
}> {
  let snapshot: RefundSnapshot;
  try {
    snapshot = await deps.payments.createRefund(
      {
        paymentIntentId,
        amount: refund.amount_cents,
        metadata: { tip_id: refund.tip_id, tip_refund_id: refund.id },
      },
      refund.idempotency_key,
    );
  } catch (error) {
    const status = Number((error as { statusCode?: unknown })?.statusCode);
    if (status >= 400 && status < 500) {
      const { rows } = await deps.db.query<TipRefundRow>(
        `UPDATE mobility.tip_refunds SET status = 'failed', last_error = $2, updated_at = $3
          WHERE id = $1 RETURNING *`,
        [refund.id, String((error as Error).message).slice(0, 200), deps.now()],
      );
      return { refund: rows[0], outcome: "failed" };
    }
    await deps.db.query(
      "UPDATE mobility.tip_refunds SET updated_at = $2 WHERE id = $1",
      [refund.id, deps.now()],
    );
    return { refund, outcome: "unknown" };
  }
  await deps.db.query(
    `UPDATE mobility.tip_refunds SET stripe_refund_id = $2, status = 'pending', updated_at = $3
      WHERE id = $1 AND stripe_refund_id IS NULL`,
    [refund.id, snapshot.id, deps.now()],
  );
  await applyTipRefundSnapshot(deps.db, snapshot, deps.now());
  const { rows } = await deps.db.query<TipRefundRow>(
    "SELECT * FROM mobility.tip_refunds WHERE id = $1",
    [refund.id],
  );
  return { refund: rows[0], outcome: "submitted" };
}

export async function createTipRefund(
  deps: { db: Database; payments: PaymentGateway; now: () => Date },
  input: {
    tipId: string;
    amountCents: number;
    reason: string;
    expectedMaxRefundableCents: number;
    idempotencyKey: string;
    operatorId: string;
  },
): Promise<{
  refund: TipRefundRow;
  outcome: "submitted" | "failed" | "unknown" | "existing";
  created: boolean;
}> {
  const now = deps.now();
  const prepared = await transaction(deps.db, async (tx) => {
    const { rows } = await tx.query<TipChargeRow>(
      "SELECT * FROM mobility.tips WHERE id = $1 FOR UPDATE",
      [input.tipId],
    );
    const tip = rows[0];
    if (!tip) throw new ApiError(404, "NOT_FOUND", "Tip not found.");
    const { rows: existing } = await tx.query<TipRefundRow>(
      "SELECT * FROM mobility.tip_refunds WHERE idempotency_key = $1",
      [input.idempotencyKey],
    );
    if (existing[0]) {
      if (
        existing[0].tip_id !== tip.id ||
        existing[0].amount_cents !== input.amountCents
      ) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This confirmation was already used for a different refund.",
        );
      }
      return { tip, refund: existing[0], created: false };
    }
    const summary = tipRefundableSummary(
      tip,
      await tipInFlightCents(tx, tip.id),
      await tipHasOpenDispute(tx, tip.id),
    );
    if (!summary.refundable) {
      throw new ApiError(
        409,
        summary.inFlightCents > 0 ? "REFUND_IN_PROGRESS" : "NOT_REFUNDABLE",
        summary.reasonNotRefundable ?? "This tip can't be refunded.",
      );
    }
    if (summary.maxRefundableCents !== input.expectedMaxRefundableCents) {
      throw new ApiError(
        409,
        "REFUNDABLE_CHANGED",
        "The refundable amount changed since you opened this ride. Review it again before confirming.",
      );
    }
    if (input.amountCents > summary.maxRefundableCents) {
      throw new ApiError(
        422,
        "EXCEEDS_REFUNDABLE",
        `At most ${summary.maxRefundableCents} cents can be refunded.`,
      );
    }
    const { rows: created } = await tx.query<TipRefundRow>(
      `INSERT INTO mobility.tip_refunds
         (tip_id, ride_id, amount_cents, source, reason, operator_id, idempotency_key,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'operator', $4, $5, $6, $7, $7) RETURNING *`,
      [
        tip.id,
        tip.ride_id,
        input.amountCents,
        input.reason,
        input.operatorId,
        input.idempotencyKey,
        now,
      ],
    );
    return { tip, refund: created[0], created: true };
  });

  if (!prepared.created && prepared.refund.status !== "creating") {
    return { refund: prepared.refund, outcome: "existing", created: false };
  }
  const submitted = await submitTipRefund(
    deps,
    prepared.refund,
    prepared.tip.stripe_payment_intent_id!,
  );
  return { ...submitted, created: prepared.created };
}

export async function syncTipRefundsForIntent(
  deps: { db: Database; payments: PaymentGateway; now: () => Date },
  paymentIntentId: string,
) {
  const refunds = await deps.payments.listRefunds(paymentIntentId);
  for (const refund of refunds) {
    await applyTipRefundSnapshot(deps.db, refund, deps.now());
  }
  return refunds.length;
}

export async function syncOpenTipRefunds(
  deps: { db: Database; payments: PaymentGateway; now: () => Date },
  limit = 20,
) {
  const cutoff = new Date(deps.now().getTime() - 60_000);
  const { rows: pending } = await deps.db.query<{ stripe_refund_id: string }>(
    `SELECT stripe_refund_id FROM mobility.tip_refunds
      WHERE status IN ('pending', 'requires_action') AND stripe_refund_id IS NOT NULL
        AND updated_at <= $1
      ORDER BY updated_at LIMIT $2`,
    [cutoff, limit],
  );
  for (const { stripe_refund_id } of pending) {
    try {
      await applyTipRefundSnapshot(
        deps.db,
        await deps.payments.retrieveRefund(stripe_refund_id),
        deps.now(),
      );
    } catch {
      continue;
    }
  }
  const { rows: creating } = await deps.db.query<
    TipRefundRow & { stripe_payment_intent_id: string }
  >(
    `SELECT f.*, t.stripe_payment_intent_id FROM mobility.tip_refunds f
       JOIN mobility.tips t ON t.id = f.tip_id
      WHERE f.status = 'creating' AND f.source = 'operator' AND f.updated_at <= $1
      ORDER BY f.updated_at LIMIT $2`,
    [cutoff, limit],
  );
  for (const refund of creating) {
    await submitTipRefund(deps, refund, refund.stripe_payment_intent_id).catch(
      () => undefined,
    );
  }
  return pending.length + creating.length;
}
