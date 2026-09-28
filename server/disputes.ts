import { type Database, transaction } from "./db";
import { recordDisputeMovement } from "./earnings";
import { flagRideReview } from "./review";

import type { DisputeSnapshot, PaymentGateway } from "./payments";

export const DISPUTE_OPEN = [
  "warning_needs_response",
  "warning_under_review",
  "needs_response",
  "under_review",
];
export const DISPUTE_CLOSED = ["warning_closed", "won", "lost"];

export const DISPUTES = { resyncAfterSeconds: 3600 } as const;

export interface DisputeRow {
  id: string;
  stripe_dispute_id: string;
  subject: "fare" | "tip" | "unknown";
  ride_id: string | null;
  tip_id: string | null;
  stripe_payment_intent_id: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  reason: string | null;
  funds_withdrawn_cents: number;
  funds_reinstated_cents: number;
  needs_review: boolean;
  review_note: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

export function fundsFrom(snapshot: DisputeSnapshot) {
  let withdrawn = 0;
  let reinstated = 0;
  for (const t of snapshot.balanceTransactions) {
    if (t.amount < 0) withdrawn += -t.amount;
    else reinstated += t.amount;
  }
  return { withdrawn, reinstated };
}

export async function syncDispute(
  deps: { db: Database; now: () => Date },
  snapshot: DisputeSnapshot,
): Promise<DisputeRow> {
  const now = deps.now();
  return transaction(deps.db, async (tx) => {
    let subject: DisputeRow["subject"] = "unknown";
    let rideId: string | null = null;
    let tipId: string | null = null;
    if (snapshot.paymentIntentId) {
      const { rows: rides } = await tx.query<{ id: string }>(
        "SELECT id FROM mobility.rides WHERE stripe_payment_intent_id = $1",
        [snapshot.paymentIntentId],
      );
      if (rides[0]) {
        subject = "fare";
        rideId = rides[0].id;
      } else {
        const { rows: tips } = await tx.query<{ id: string; ride_id: string }>(
          "SELECT id, ride_id FROM mobility.tips WHERE stripe_payment_intent_id = $1",
          [snapshot.paymentIntentId],
        );
        if (tips[0]) {
          subject = "tip";
          tipId = tips[0].id;
          rideId = tips[0].ride_id;
        }
      }
    }

    const { rows: before } = await tx.query<DisputeRow>(
      "SELECT * FROM mobility.disputes WHERE stripe_dispute_id = $1 FOR UPDATE",
      [snapshot.id],
    );
    const previous = before[0] ?? null;
    await tx.query(
      `INSERT INTO mobility.disputes
         (stripe_dispute_id, subject, ride_id, tip_id, stripe_payment_intent_id,
          amount_cents, currency, status, reason, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT (stripe_dispute_id) DO UPDATE
         SET amount_cents = EXCLUDED.amount_cents, status = EXCLUDED.status,
             reason = EXCLUDED.reason, updated_at = EXCLUDED.updated_at`,
      [
        snapshot.id,
        subject,
        rideId,
        tipId,
        snapshot.paymentIntentId,
        snapshot.amount,
        snapshot.currency,
        snapshot.status,
        snapshot.reason,
        now,
      ],
    );
    const { rows } = await tx.query<DisputeRow>(
      "SELECT * FROM mobility.disputes WHERE stripe_dispute_id = $1 FOR UPDATE",
      [snapshot.id],
    );
    const dispute = rows[0];

    for (const txn of snapshot.balanceTransactions) {
      await recordDisputeMovement(tx, dispute, txn, now);
    }

    const { withdrawn, reinstated } = fundsFrom(snapshot);
    const { rows: recordedRows } = await tx.query<{ net: number }>(
      `SELECT COALESCE(-sum(gross_cents), 0)::int AS net
         FROM mobility.earning_entries WHERE dispute_id = $1`,
      [dispute.id],
    );
    const recorded = recordedRows[0].net;
    const notes: string[] = [];
    if (dispute.subject === "unknown") {
      notes.push("No ride or tip matches the disputed payment.");
    }
    if (
      !DISPUTE_OPEN.includes(snapshot.status) &&
      !DISPUTE_CLOSED.includes(snapshot.status)
    ) {
      notes.push(`Unrecognised dispute status "${snapshot.status}".`);
    }
    if (snapshot.currency !== "usd") {
      notes.push(`Unexpected currency ${snapshot.currency}.`);
    }
    if (dispute.subject !== "unknown" && recorded !== withdrawn - reinstated) {
      notes.push(
        `Driver earnings reflect ${recorded} cents withdrawn but Stripe reports ${withdrawn - reinstated}.`,
      );
    }
    if (snapshot.status === "lost" && withdrawn === 0) {
      notes.push(
        "The dispute was lost but Stripe reports no withdrawn funds yet.",
      );
    }
    if (snapshot.status === "won" && withdrawn > reinstated) {
      notes.push(
        "The dispute was won but the funds haven't been reinstated yet.",
      );
    }
    const needsReview = notes.length > 0;
    const closed = DISPUTE_CLOSED.includes(snapshot.status);
    const { rows: updated } = await tx.query<DisputeRow>(
      `UPDATE mobility.disputes
          SET funds_withdrawn_cents = $2, funds_reinstated_cents = $3,
              needs_review = $4, review_note = $5,
              closed_at = CASE WHEN $6::boolean THEN COALESCE(closed_at, $7::timestamptz) ELSE NULL END,
              updated_at = $7
        WHERE id = $1 RETURNING *`,
      [
        dispute.id,
        withdrawn,
        reinstated,
        needsReview,
        needsReview ? notes.join(" ").slice(0, 300) : null,
        closed,
        now,
      ],
    );

    const changed =
      !previous ||
      previous.status !== snapshot.status ||
      (!previous.needs_review && needsReview);
    const actionable =
      needsReview || !snapshot.status.startsWith("warning_") || !previous;
    if (dispute.ride_id && changed && actionable) {
      await flagRideReview(tx, dispute.ride_id, "payment_dispute");
    }
    return updated[0];
  });
}

export async function syncDisputesForIntent(
  deps: { db: Database; payments: PaymentGateway; now: () => Date },
  paymentIntentId: string,
) {
  const disputes = await deps.payments.listDisputes(paymentIntentId);
  for (const d of disputes) await syncDispute(deps, d);
  return disputes.length;
}

export async function syncOpenDisputes(
  deps: { db: Database; payments: PaymentGateway; now: () => Date },
  limit = 20,
) {
  const { rows } = await deps.db.query<{ stripe_dispute_id: string }>(
    `SELECT stripe_dispute_id FROM mobility.disputes
      WHERE (closed_at IS NULL OR needs_review) AND updated_at <= $1
      ORDER BY updated_at LIMIT $2`,
    [
      new Date(deps.now().getTime() - DISPUTES.resyncAfterSeconds * 1000),
      limit,
    ],
  );
  for (const { stripe_dispute_id } of rows) {
    try {
      await syncDispute(
        deps,
        await deps.payments.retrieveDispute(stripe_dispute_id),
      );
    } catch {
      continue;
    }
  }
  return rows.length;
}
