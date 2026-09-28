import { transaction } from "./db";
import { recordFareRefund } from "./earnings";
import { ApiError } from "./errors";
import { flagRideReview } from "./review";

import type { Database, SqlClient } from "./db";
import type { PaymentGateway, RefundSnapshot } from "./payments";
import type { RefundableSummary } from "../shared/contracts";

const REFUND_STATUSES = [
  "pending",
  "requires_action",
  "succeeded",
  "failed",
  "canceled",
] as const;

const OPEN = ["creating", "pending", "requires_action"];

export async function applyRefundSnapshot(
  db: Database,
  snapshot: RefundSnapshot,
  now: Date = new Date(),
): Promise<boolean> {
  const status = (REFUND_STATUSES as readonly string[]).includes(
    snapshot.status,
  )
    ? snapshot.status
    : "pending";
  return transaction(db, async (tx) => {
    const lock = () =>
      tx.query<{
        id: string;
        ride_id: string;
        status: string;
        amount_cents: number;
      }>(
        "SELECT id, ride_id, status, amount_cents FROM mobility.refunds WHERE stripe_refund_id = $1 FOR UPDATE",
        [snapshot.id],
      );
    let refund = (await lock()).rows[0];
    if (!refund) {
      if (!snapshot.paymentIntentId) return false;
      const { rows: rides } = await tx.query<{
        id: string;
        payment_status: string;
      }>(
        "SELECT id, payment_status FROM mobility.rides WHERE stripe_payment_intent_id = $1",
        [snapshot.paymentIntentId],
      );
      const ride = rides[0];
      if (!ride) return false;
      const { rows: inserted } = await tx.query(
        `INSERT INTO mobility.refunds
           (ride_id, amount_cents, status, reason, operator, idempotency_key,
            stripe_refund_id, source, created_at, updated_at)
         VALUES ($1, $2, 'creating', 'Refunded outside the app (Stripe Dashboard or API)',
                 'stripe', $3, $4, 'stripe', $5, $5)
         ON CONFLICT (stripe_refund_id) DO NOTHING
         RETURNING id`,
        [ride.id, snapshot.amount, `stripe:${snapshot.id}`, snapshot.id, now],
      );
      if (inserted[0]) {
        await tx.query(
          `INSERT INTO mobility.payment_events (ride_id, kind, amount_cents, stripe_object_id, actor, detail)
           VALUES ($1, 'refund_requested', $2, $3, 'stripe', 'created outside the app')`,
          [ride.id, snapshot.amount, snapshot.id],
        );
        if (ride.payment_status !== "paid") {
          await flagRideReview(tx, ride.id, "refund_mismatch");
        }
      }
      refund = (await lock()).rows[0];
      if (!refund) return false;
    }
    if (refund.status === status) return true;
    if (refund.status === "succeeded") {
      if (status === "failed" || status === "canceled") {
        await flagRideReview(tx, refund.ride_id, "refund_reversed");
        await tx.query(
          "UPDATE mobility.refunds SET last_error = $2, updated_at = now() WHERE id = $1",
          [refund.id, `Stripe now reports this refund as ${status}`],
        );
      }
      return true;
    }
    if (!OPEN.includes(refund.status) && status !== "succeeded") return true;

    await tx.query(
      `UPDATE mobility.refunds
          SET status = $2, last_error = $3, updated_at = now()
        WHERE id = $1`,
      [refund.id, status, snapshot.failureReason],
    );
    if (
      status === "succeeded" ||
      status === "failed" ||
      status === "canceled"
    ) {
      await tx.query(
        `INSERT INTO mobility.payment_events
           (ride_id, kind, amount_cents, stripe_object_id, actor, detail)
         VALUES ($1, $2, $3, $4, 'stripe', $5)`,
        [
          refund.ride_id,
          status === "succeeded" ? "refund_succeeded" : "refund_failed",
          refund.amount_cents,
          snapshot.id,
          snapshot.failureReason,
        ],
      );
    }
    await tx.query(
      `UPDATE mobility.rides r
          SET refunded_cents = COALESCE((
                SELECT sum(amount_cents) FROM mobility.refunds
                 WHERE ride_id = r.id AND status = 'succeeded'), 0),
              version = version + 1, updated_at = now()
        WHERE r.id = $1`,
      [refund.ride_id],
    );
    if (status === "succeeded") {
      await recordFareRefund(
        tx,
        refund.ride_id,
        snapshot.id,
        refund.amount_cents,
        now,
      );
    }
    return true;
  });
}

export async function syncRefundsForIntent(
  deps: { db: Database; payments: PaymentGateway; now: () => Date },
  paymentIntentId: string,
) {
  const refunds = await deps.payments.listRefunds(paymentIntentId);
  for (const refund of refunds) {
    await applyRefundSnapshot(deps.db, refund, deps.now());
  }
  return refunds.length;
}

export async function syncOpenRefunds(
  deps: { db: Database; payments: PaymentGateway; now: () => Date },
  limit = 20,
) {
  const { rows } = await deps.db.query<{ stripe_refund_id: string }>(
    `SELECT stripe_refund_id FROM mobility.refunds
      WHERE status IN ('pending', 'requires_action')
        AND stripe_refund_id IS NOT NULL
        AND updated_at <= $1
      ORDER BY updated_at LIMIT $2`,
    [new Date(deps.now().getTime() - 60_000), limit],
  );
  for (const { stripe_refund_id } of rows) {
    try {
      await applyRefundSnapshot(
        deps.db,
        await deps.payments.retrieveRefund(stripe_refund_id),
        deps.now(),
      );
    } catch {
      continue;
    }
  }
  return rows.length;
}

export interface RefundableRow {
  status: string;
  payment_status: string;
  captured_cents: number | null;
  refunded_cents: number;
  stripe_payment_intent_id: string | null;
}

export function refundableSummary(
  ride: RefundableRow,
  inFlightCents: number,
  openDispute = false,
): RefundableSummary {
  const captured = ride.captured_cents ?? 0;
  const max = Math.max(0, captured - ride.refunded_cents - inFlightCents);
  const reason =
    ride.status === "legacy"
      ? "Legacy demo bookings can't be refunded here."
      : ride.payment_status !== "paid" || !ride.captured_cents
        ? "Nothing was captured. An uncaptured hold is released, not refunded."
        : openDispute
          ? "This fare is under a payment dispute. Handle it in the Stripe Dashboard."
          : inFlightCents > 0
            ? "Another refund for this ride is still in progress."
            : max === 0
              ? "The captured amount has already been refunded."
              : null;
  return {
    capturedCents: captured,
    refundedCents: ride.refunded_cents,
    inFlightCents,
    maxRefundableCents: max,
    refundable: reason === null,
    reasonNotRefundable: reason,
  };
}

export async function fareHasOpenDispute(db: SqlClient, rideId: string) {
  const { rows } = await db.query(
    "SELECT 1 FROM mobility.disputes WHERE ride_id = $1 AND subject = 'fare' AND closed_at IS NULL",
    [rideId],
  );
  return rows.length > 0;
}

export async function inFlightCents(db: SqlClient, rideId: string) {
  const { rows } = await db.query<{ cents: number }>(
    `SELECT COALESCE(sum(amount_cents), 0)::int AS cents FROM mobility.refunds
      WHERE ride_id = $1 AND status = ANY($2::text[])`,
    [rideId, OPEN],
  );
  return rows[0].cents;
}

export interface RefundRecord {
  id: string;
  ride_id: string;
  amount_cents: number;
  status: string;
  idempotency_key: string;
  stripe_refund_id: string | null;
  last_error: string | null;
}

async function recordSubmission(
  db: Database,
  refund: RefundRecord,
  snapshot: RefundSnapshot,
  now: Date,
) {
  await db.query(
    `UPDATE mobility.refunds SET stripe_refund_id = $2, status = 'pending', updated_at = now()
      WHERE id = $1 AND stripe_refund_id IS NULL`,
    [refund.id, snapshot.id],
  );
  await applyRefundSnapshot(db, snapshot, now);
  const { rows } = await db.query<RefundRecord>(
    "SELECT * FROM mobility.refunds WHERE id = $1",
    [refund.id],
  );
  return rows[0];
}

export async function submitRefund(
  deps: { db: Database; payments: PaymentGateway; now?: () => Date },
  refund: RefundRecord,
  paymentIntentId: string,
): Promise<{
  refund: RefundRecord;
  outcome: "submitted" | "failed" | "unknown";
}> {
  let snapshot: RefundSnapshot;
  try {
    snapshot = await deps.payments.createRefund(
      {
        paymentIntentId,
        amount: refund.amount_cents,
        metadata: { ride_id: refund.ride_id, refund_id: refund.id },
      },
      refund.idempotency_key,
    );
  } catch (error) {
    const status = Number((error as { statusCode?: unknown })?.statusCode);
    if (status >= 400 && status < 500) {
      const message = String((error as Error).message).slice(0, 200);
      const { rows } = await deps.db.query<RefundRecord>(
        `UPDATE mobility.refunds SET status = 'failed', last_error = $2, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [refund.id, message],
      );
      await deps.db.query(
        `INSERT INTO mobility.payment_events (ride_id, kind, amount_cents, actor, detail)
         VALUES ($1, 'refund_failed', $2, 'stripe', $3)`,
        [refund.ride_id, refund.amount_cents, message],
      );
      return { refund: rows[0], outcome: "failed" };
    }
    await deps.db.query(
      "UPDATE mobility.refunds SET updated_at = now() WHERE id = $1",
      [refund.id],
    );
    return { refund, outcome: "unknown" };
  }
  return {
    refund: await recordSubmission(
      deps.db,
      refund,
      snapshot,
      deps.now ? deps.now() : new Date(),
    ),
    outcome: "submitted",
  };
}

export async function createOperatorRefund(
  deps: { db: Database; payments: PaymentGateway; now?: () => Date },
  input: {
    rideId: string;
    amountCents: number;
    reason: string;
    expectedMaxRefundableCents: number;
    idempotencyKey: string;
    supportRequestId?: string;
    operator: { id: string; display_name: string; clerk_id: string };
  },
): Promise<{
  refund: RefundRecord;
  outcome: "submitted" | "failed" | "unknown" | "existing";
  created: boolean;
}> {
  const prepared = await transaction(deps.db, async (tx) => {
    const { rows: rides } = await tx.query<RefundableRow & { id: string }>(
      "SELECT * FROM mobility.rides WHERE id = $1 FOR UPDATE",
      [input.rideId],
    );
    const ride = rides[0];
    if (!ride) throw new ApiError(404, "NOT_FOUND", "Ride not found.");

    const { rows: existing } = await tx.query<RefundRecord>(
      "SELECT * FROM mobility.refunds WHERE idempotency_key = $1",
      [input.idempotencyKey],
    );
    if (existing[0]) {
      if (
        existing[0].ride_id !== ride.id ||
        existing[0].amount_cents !== input.amountCents
      ) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This confirmation was already used for a different refund.",
        );
      }
      return { ride, refund: existing[0], created: false };
    }

    const summary = refundableSummary(
      ride,
      await inFlightCents(tx, ride.id),
      await fareHasOpenDispute(tx, ride.id),
    );
    if (!summary.refundable) {
      throw new ApiError(
        409,
        summary.inFlightCents > 0 ? "REFUND_IN_PROGRESS" : "NOT_REFUNDABLE",
        summary.reasonNotRefundable ?? "This ride can't be refunded.",
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
    if (input.supportRequestId) {
      const { rows } = await tx.query(
        "SELECT 1 FROM mobility.support_requests WHERE id = $1 AND ride_id = $2",
        [input.supportRequestId, ride.id],
      );
      if (!rows.length) {
        throw new ApiError(
          422,
          "SUPPORT_REQUEST_MISMATCH",
          "That support request belongs to a different ride.",
        );
      }
    }
    const { rows: created } = await tx.query<RefundRecord>(
      `INSERT INTO mobility.refunds
         (ride_id, amount_cents, reason, operator, operator_id, support_request_id, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        ride.id,
        input.amountCents,
        input.reason,
        input.operator.display_name,
        input.operator.id,
        input.supportRequestId ?? null,
        input.idempotencyKey,
      ],
    );
    await tx.query(
      `INSERT INTO mobility.payment_events (ride_id, kind, amount_cents, actor, detail)
       VALUES ($1, 'refund_requested', $2, $3, $4)`,
      [
        ride.id,
        input.amountCents,
        `operator:${input.operator.clerk_id}`,
        input.reason.slice(0, 200),
      ],
    );
    return { ride, refund: created[0], created: true };
  });

  if (!prepared.created && prepared.refund.status !== "creating") {
    return { refund: prepared.refund, outcome: "existing", created: false };
  }
  const submitted = await submitRefund(
    deps,
    prepared.refund,
    prepared.ride.stripe_payment_intent_id!,
  );
  return { ...submitted, created: prepared.created };
}

export async function resubmitStaleRefunds(
  deps: { db: Database; payments: PaymentGateway; now: () => Date },
  limit = 10,
) {
  const { rows } = await deps.db.query<
    RefundRecord & { stripe_payment_intent_id: string }
  >(
    `SELECT f.*, r.stripe_payment_intent_id FROM mobility.refunds f
       JOIN mobility.rides r ON r.id = f.ride_id
      WHERE f.status = 'creating' AND f.updated_at <= $1
      ORDER BY f.updated_at LIMIT $2`,
    [new Date(deps.now().getTime() - 60_000), limit],
  );
  for (const refund of rows) {
    await submitRefund(deps, refund, refund.stripe_payment_intent_id).catch(
      () => undefined,
    );
  }
  return rows.length;
}
