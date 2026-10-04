import { type Database, type SqlClient, transaction } from "./db";
import {
  policyAt,
  refundSplit,
  reversalSplit,
  splitAmount,
} from "./earningsPolicy";

import type { EarningEntryView } from "../shared/contracts";

interface EarnableRide {
  id: string;
  status: string;
  payment_status: string;
  driver_profile_id: string | null;
  demo_driver_id: number | null;
  captured_cents: number | null;
  currency: string;
  paid_at: Date | null;
  stripe_payment_intent_id: string | null;
  payment_method: string;
  collection_method: string | null;
}

export interface RideEarningRow {
  ride_id: string;
  driver_profile_id: string;
  currency: string;
  fare_cents: number;
  commission_policy_version: string;
  commission_rate_bps: number;
  commission_cents: number;
  driver_share_cents: number;
  stripe_payment_intent_id: string | null;
  earned_at: Date;
}

export interface EntryRow {
  kind: EarningEntryView["kind"];
  gross_cents: number;
  commission_cents: number;
  driver_amount_cents: number;
  policy_version: string;
  occurred_at: Date;
}

export interface TipLedgerRow {
  id: string;
  ride_id: string;
  driver_profile_id: string;
  amount_cents: number;
  currency: string;
  stripe_payment_intent_id: string | null;
  paid_at: Date | null;
}

export const isEarnable = (ride: EarnableRide) =>
  ride.status === "completed" &&
  ride.payment_status === "paid" &&
  ride.driver_profile_id !== null &&
  ride.demo_driver_id === null &&
  (ride.stripe_payment_intent_id !== null ||
    (ride.payment_method === "in_vehicle" &&
      ride.collection_method !== null)) &&
  (ride.captured_cents ?? 0) > 0;

export const entryView = (e: EntryRow): EarningEntryView => ({
  kind: e.kind,
  grossCents: e.gross_cents,
  commissionCents: e.commission_cents,
  driverAmountCents: e.driver_amount_cents,
  policyVersion: e.policy_version,
  occurredAt: new Date(e.occurred_at).toISOString(),
});

async function insertEntry(
  tx: SqlClient,
  entry: {
    driverProfileId: string;
    rideId: string;
    tipId?: string | null;
    disputeId?: string | null;
    kind: EarningEntryView["kind"];
    currency: string;
    grossCents: number;
    commissionCents: number;
    driverCents: number;
    policyVersion: string;
    sourceKey: string;
    stripeObjectId: string | null;
    occurredAt: Date;
    fundsHeldBy?: "platform" | "driver";
  },
) {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO mobility.earning_entries
       (driver_profile_id, ride_id, tip_id, kind, currency, gross_cents,
        commission_cents, driver_amount_cents, policy_version, source_key,
        stripe_object_id, occurred_at, dispute_id, funds_held_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (source_key) DO NOTHING
     RETURNING id`,
    [
      entry.driverProfileId,
      entry.rideId,
      entry.tipId ?? null,
      entry.kind,
      entry.currency.trim(),
      entry.grossCents,
      entry.commissionCents,
      entry.driverCents,
      entry.policyVersion,
      entry.sourceKey,
      entry.stripeObjectId,
      entry.occurredAt,
      entry.disputeId ?? null,
      entry.fundsHeldBy ?? "platform",
    ],
  );
  return rows.length > 0;
}

const REVERSAL_KINDS = {
  fare: [
    "fare_refund_adjustment",
    "dispute_withdrawal",
    "dispute_reinstatement",
  ],
  tip: ["tip_refund_adjustment", "dispute_withdrawal", "dispute_reinstatement"],
};

async function fareReversed(tx: SqlClient, rideId: string) {
  const { rows } = await tx.query<{ reversed: number }>(
    `SELECT COALESCE(-sum(gross_cents), 0)::int AS reversed
       FROM mobility.earning_entries
      WHERE ride_id = $1 AND tip_id IS NULL AND kind = ANY($2::text[])`,
    [rideId, REVERSAL_KINDS.fare],
  );
  return rows[0].reversed;
}

async function tipReversed(tx: SqlClient, tipId: string) {
  const { rows } = await tx.query<{ reversed: number }>(
    `SELECT COALESCE(-sum(gross_cents), 0)::int AS reversed
       FROM mobility.earning_entries
      WHERE tip_id = $1 AND kind = ANY($2::text[])`,
    [tipId, REVERSAL_KINDS.tip],
  );
  return rows[0].reversed;
}

export async function ensureRideEarning(
  tx: SqlClient,
  rideId: string,
  now: Date,
): Promise<RideEarningRow | null> {
  const { rows } = await tx.query<EarnableRide>(
    `SELECT id, status, payment_status, driver_profile_id, demo_driver_id,
            captured_cents, currency, paid_at, stripe_payment_intent_id,
            payment_method, collection_method
       FROM mobility.rides WHERE id = $1`,
    [rideId],
  );
  const ride = rows[0];
  if (!ride || !isEarnable(ride)) return null;
  const earnedAt = ride.paid_at ? new Date(ride.paid_at) : now;
  const policy = policyAt(earnedAt);
  const split = splitAmount(ride.captured_cents!, policy.fareCommissionBps);
  await tx.query(
    `INSERT INTO mobility.ride_earnings
       (ride_id, driver_profile_id, currency, fare_cents, commission_policy_version,
        commission_rate_bps, commission_cents, driver_share_cents,
        stripe_payment_intent_id, earned_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (ride_id) DO NOTHING`,
    [
      ride.id,
      ride.driver_profile_id,
      ride.currency.trim(),
      ride.captured_cents,
      policy.version,
      policy.fareCommissionBps,
      split.commissionCents,
      split.driverCents,
      ride.stripe_payment_intent_id,
      earnedAt,
    ],
  );
  const { rows: stored } = await tx.query<RideEarningRow>(
    "SELECT * FROM mobility.ride_earnings WHERE ride_id = $1",
    [ride.id],
  );
  const earning = stored[0];
  await insertEntry(tx, {
    driverProfileId: earning.driver_profile_id,
    rideId: earning.ride_id,
    kind: "ride_earning",
    currency: earning.currency,
    grossCents: earning.fare_cents,
    commissionCents: earning.commission_cents,
    driverCents: earning.driver_share_cents,
    policyVersion: earning.commission_policy_version,
    sourceKey:
      ride.payment_method === "in_vehicle"
        ? `collection:${earning.ride_id}`
        : `capture:${earning.ride_id}`,
    stripeObjectId: earning.stripe_payment_intent_id,
    occurredAt: new Date(earning.earned_at),
    fundsHeldBy: ride.collection_method === "cash" ? "driver" : "platform",
  });
  return earning;
}

export async function recordFareRefund(
  tx: SqlClient,
  rideId: string,
  stripeRefundId: string,
  refundCents: number,
  now: Date,
): Promise<boolean> {
  await ensureRideEarning(tx, rideId, now);
  const { rows } = await tx.query<RideEarningRow>(
    "SELECT * FROM mobility.ride_earnings WHERE ride_id = $1 FOR UPDATE",
    [rideId],
  );
  const earning = rows[0];
  if (!earning) return false;
  const sourceKey = `refund:${stripeRefundId}`;
  const seen = await tx.query(
    "SELECT 1 FROM mobility.earning_entries WHERE source_key = $1",
    [sourceKey],
  );
  if (seen.rows.length) return false;
  const split = refundSplit(
    earning,
    await fareReversed(tx, rideId),
    refundCents,
  );
  if (split.grossCents <= 0) return false;
  return insertEntry(tx, {
    driverProfileId: earning.driver_profile_id,
    rideId,
    kind: "fare_refund_adjustment",
    currency: earning.currency,
    grossCents: -split.grossCents,
    commissionCents: -split.commissionCents,
    driverCents: -split.driverCents,
    policyVersion: earning.commission_policy_version,
    sourceKey,
    stripeObjectId: stripeRefundId,
    occurredAt: now,
  });
}

export async function recordTipEarning(
  tx: SqlClient,
  tip: TipLedgerRow,
  now: Date,
): Promise<boolean> {
  const paidAt = tip.paid_at ? new Date(tip.paid_at) : now;
  const policy = policyAt(paidAt);
  const split = splitAmount(tip.amount_cents, policy.tipCommissionBps);
  return insertEntry(tx, {
    driverProfileId: tip.driver_profile_id,
    rideId: tip.ride_id,
    tipId: tip.id,
    kind: "tip",
    currency: tip.currency,
    grossCents: tip.amount_cents,
    commissionCents: split.commissionCents,
    driverCents: split.driverCents,
    policyVersion: policy.version,
    sourceKey: `tip:${tip.id}`,
    stripeObjectId: tip.stripe_payment_intent_id,
    occurredAt: paidAt,
  });
}

export async function recordTipRefund(
  tx: SqlClient,
  tip: TipLedgerRow,
  stripeRefundId: string,
  refundCents: number,
  now: Date,
): Promise<boolean> {
  await recordTipEarning(tx, tip, now);
  const sourceKey = `refund:${stripeRefundId}`;
  const seen = await tx.query(
    "SELECT 1 FROM mobility.earning_entries WHERE source_key = $1",
    [sourceKey],
  );
  if (seen.rows.length) return false;
  const { rows } = await tx.query<{
    driver_amount_cents: number;
    policy_version: string;
  }>(
    "SELECT driver_amount_cents, policy_version FROM mobility.earning_entries WHERE source_key = $1",
    [`tip:${tip.id}`],
  );
  const split = refundSplit(
    {
      fare_cents: tip.amount_cents,
      driver_share_cents: rows[0].driver_amount_cents,
    },
    await tipReversed(tx, tip.id),
    refundCents,
  );
  if (split.grossCents <= 0) return false;
  return insertEntry(tx, {
    driverProfileId: tip.driver_profile_id,
    rideId: tip.ride_id,
    tipId: tip.id,
    kind: "tip_refund_adjustment",
    currency: tip.currency,
    grossCents: -split.grossCents,
    commissionCents: -split.commissionCents,
    driverCents: -split.driverCents,
    policyVersion: rows[0].policy_version,
    sourceKey,
    stripeObjectId: stripeRefundId,
    occurredAt: now,
  });
}

export interface DisputeRef {
  id: string;
  subject: "fare" | "tip" | "unknown";
  ride_id: string | null;
  tip_id: string | null;
}

export type DisputeMovement =
  | { recorded: boolean; capped: boolean }
  | { recorded: false; capped: false; missingEarning: true };

export async function recordDisputeMovement(
  tx: SqlClient,
  dispute: DisputeRef,
  txn: { id: string; amount: number },
  now: Date,
): Promise<DisputeMovement> {
  const sourceKey = `dispute_txn:${txn.id}`;
  const seen = await tx.query(
    "SELECT 1 FROM mobility.earning_entries WHERE source_key = $1",
    [sourceKey],
  );
  if (seen.rows.length) return { recorded: false, capped: false };
  if (txn.amount === 0 || dispute.subject === "unknown" || !dispute.ride_id) {
    return { recorded: false, capped: false };
  }

  let base: {
    driverProfileId: string;
    currency: string;
    grossCents: number;
    driverCents: number;
    policyVersion: string;
  } | null = null;
  let reversed = 0;
  if (dispute.subject === "fare") {
    await ensureRideEarning(tx, dispute.ride_id, now);
    const { rows } = await tx.query<RideEarningRow>(
      "SELECT * FROM mobility.ride_earnings WHERE ride_id = $1 FOR UPDATE",
      [dispute.ride_id],
    );
    if (rows[0]) {
      base = {
        driverProfileId: rows[0].driver_profile_id,
        currency: rows[0].currency,
        grossCents: rows[0].fare_cents,
        driverCents: rows[0].driver_share_cents,
        policyVersion: rows[0].commission_policy_version,
      };
      reversed = await fareReversed(tx, dispute.ride_id);
    }
  } else {
    const { rows: tips } = await tx.query<TipLedgerRow & { status: string }>(
      "SELECT * FROM mobility.tips WHERE id = $1 FOR UPDATE",
      [dispute.tip_id],
    );
    const tip = tips[0];
    if (tip?.status === "succeeded") {
      await recordTipEarning(tx, tip, now);
      const { rows } = await tx.query<{
        driver_amount_cents: number;
        policy_version: string;
      }>(
        "SELECT driver_amount_cents, policy_version FROM mobility.earning_entries WHERE source_key = $1",
        [`tip:${tip.id}`],
      );
      base = {
        driverProfileId: tip.driver_profile_id,
        currency: tip.currency,
        grossCents: tip.amount_cents,
        driverCents: rows[0].driver_amount_cents,
        policyVersion: rows[0].policy_version,
      };
      reversed = await tipReversed(tx, tip.id);
    }
  }
  if (!base) return { recorded: false, capped: false, missingEarning: true };

  let after: number;
  let capped = false;
  if (txn.amount < 0) {
    const want = -txn.amount;
    after = Math.min(reversed + want, base.grossCents);
    capped = reversed + want > base.grossCents;
  } else {
    const { rows } = await tx.query<{ withdrawn: number }>(
      `SELECT COALESCE(-sum(gross_cents), 0)::int AS withdrawn
         FROM mobility.earning_entries WHERE dispute_id = $1`,
      [dispute.id],
    );
    const give = Math.min(txn.amount, Math.max(0, rows[0].withdrawn));
    after = reversed - give;
    capped = txn.amount > rows[0].withdrawn;
  }
  const split = reversalSplit(
    { fare_cents: base.grossCents, driver_share_cents: base.driverCents },
    reversed,
    after,
  );
  if (split.grossCents === 0) return { recorded: false, capped };
  const recorded = await insertEntry(tx, {
    driverProfileId: base.driverProfileId,
    rideId: dispute.ride_id,
    tipId: dispute.subject === "tip" ? dispute.tip_id : null,
    disputeId: dispute.id,
    kind: split.grossCents < 0 ? "dispute_reinstatement" : "dispute_withdrawal",
    currency: base.currency,
    grossCents: -split.grossCents,
    commissionCents: -split.commissionCents,
    driverCents: -split.driverCents,
    policyVersion: base.policyVersion,
    sourceKey,
    stripeObjectId: txn.id,
    occurredAt: now,
  });
  return { recorded, capped };
}

export async function reconcileEarnings(
  deps: { db: Database; now: () => Date },
  limit = 50,
) {
  const now = deps.now();
  const healed = { rides: 0, refunds: 0, tips: 0 };
  const { rows: rides } = await deps.db.query<{ id: string }>(
    `SELECT r.id FROM mobility.rides r
      WHERE r.status = 'completed' AND r.payment_status = 'paid'
        AND r.driver_profile_id IS NOT NULL AND r.demo_driver_id IS NULL
        AND COALESCE(r.captured_cents, 0) > 0
        AND NOT EXISTS (SELECT 1 FROM mobility.earning_entries e
                         WHERE e.source_key = 'capture:' || r.id::text)
      LIMIT $1`,
    [limit],
  );
  for (const { id } of rides) {
    await transaction(deps.db, (tx) => ensureRideEarning(tx, id, now));
    healed.rides++;
  }
  const { rows: refunds } = await deps.db.query<{
    ride_id: string;
    stripe_refund_id: string;
    amount_cents: number;
  }>(
    `SELECT f.ride_id, f.stripe_refund_id, f.amount_cents FROM mobility.refunds f
      WHERE f.status = 'succeeded' AND f.stripe_refund_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM mobility.earning_entries e
                         WHERE e.source_key = 'refund:' || f.stripe_refund_id)
      LIMIT $1`,
    [limit],
  );
  for (const f of refunds) {
    const done = await transaction(deps.db, (tx) =>
      recordFareRefund(tx, f.ride_id, f.stripe_refund_id, f.amount_cents, now),
    );
    if (done) healed.refunds++;
  }
  const { rows: tips } = await deps.db.query<TipLedgerRow>(
    `SELECT t.* FROM mobility.tips t
      WHERE t.status = 'succeeded'
        AND NOT EXISTS (SELECT 1 FROM mobility.earning_entries e
                         WHERE e.source_key = 'tip:' || t.id::text)
      LIMIT $1`,
    [limit],
  );
  for (const tip of tips) {
    await transaction(deps.db, (tx) => recordTipEarning(tx, tip, now));
    healed.tips++;
  }
  const { rows: tipRefunds } = await deps.db.query<{
    tip_id: string;
    stripe_refund_id: string;
    amount_cents: number;
  }>(
    `SELECT f.tip_id, f.stripe_refund_id, f.amount_cents FROM mobility.tip_refunds f
      WHERE f.status = 'succeeded' AND f.stripe_refund_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM mobility.earning_entries e
                         WHERE e.source_key = 'refund:' || f.stripe_refund_id)
      LIMIT $1`,
    [limit],
  );
  for (const f of tipRefunds) {
    const done = await transaction(deps.db, async (tx) => {
      const { rows } = await tx.query<TipLedgerRow>(
        "SELECT * FROM mobility.tips WHERE id = $1 FOR UPDATE",
        [f.tip_id],
      );
      return recordTipRefund(
        tx,
        rows[0],
        f.stripe_refund_id,
        f.amount_cents,
        now,
      );
    });
    if (done) healed.refunds++;
  }
  return healed;
}

export async function reconcileRide(
  db: SqlClient,
  rideId: string,
): Promise<{ ok: boolean; issues: string[] }> {
  const { rows } = await db.query<
    EarnableRide & {
      refunded_cents: number;
      earning_fare: number | null;
      entry_fare: number | null;
      refund_entries: number;
      captured_events: number;
    }
  >(
    `SELECT r.id, r.status, r.payment_status, r.driver_profile_id, r.demo_driver_id,
            r.captured_cents, r.currency, r.paid_at, r.stripe_payment_intent_id,
            r.refunded_cents, re.fare_cents AS earning_fare,
            (SELECT gross_cents FROM mobility.earning_entries
              WHERE source_key = 'capture:' || r.id::text) AS entry_fare,
            (SELECT COALESCE(-sum(gross_cents), 0)::int FROM mobility.earning_entries
              WHERE ride_id = r.id AND kind = 'fare_refund_adjustment') AS refund_entries,
            (SELECT count(*)::int FROM mobility.payment_events
              WHERE ride_id = r.id AND kind = 'captured') AS captured_events
       FROM mobility.rides r
       LEFT JOIN mobility.ride_earnings re ON re.ride_id = r.id
      WHERE r.id = $1`,
    [rideId],
  );
  const r = rows[0];
  const issues: string[] = [];
  if (!r) return { ok: false, issues: ["ride not found"] };
  if (isEarnable(r)) {
    if (r.earning_fare === null)
      issues.push("captured ride has no earning record");
    else if (r.earning_fare !== r.captured_cents)
      issues.push("earning fare differs from the captured amount");
    if (r.entry_fare === null) issues.push("earning ledger entry missing");
    if (r.captured_events === 0)
      issues.push("payment ledger has no capture event");
  } else if (r.earning_fare !== null) {
    issues.push("earning recorded for a ride that is not captured");
  }
  if (r.refund_entries !== r.refunded_cents) {
    issues.push("refund adjustments differ from succeeded refunds");
  }
  const { rows: tipRows } = await db.query<{
    status: string;
    amount_cents: number;
    refunded_cents: number;
    entry: number | null;
    refunds: number;
    succeeded_refunds: number;
  }>(
    `SELECT t.status, t.amount_cents, t.refunded_cents,
            (SELECT gross_cents FROM mobility.earning_entries
              WHERE source_key = 'tip:' || t.id::text) AS entry,
            (SELECT COALESCE(-sum(gross_cents), 0)::int FROM mobility.earning_entries
              WHERE tip_id = t.id AND kind = 'tip_refund_adjustment') AS refunds,
            (SELECT COALESCE(sum(amount_cents), 0)::int FROM mobility.tip_refunds
              WHERE tip_id = t.id AND status = 'succeeded') AS succeeded_refunds
       FROM mobility.tips t WHERE t.ride_id = $1 AND t.status <> 'canceled'`,
    [rideId],
  );
  for (const t of tipRows) {
    if (t.status === "succeeded" && t.entry !== t.amount_cents)
      issues.push("paid tip is missing from earnings");
    if (t.status !== "succeeded" && t.entry !== null)
      issues.push("unpaid tip counted as earnings");
    if (t.succeeded_refunds !== t.refunded_cents)
      issues.push("tip refund total differs from succeeded tip refunds");
    if (t.refunds !== t.refunded_cents)
      issues.push("tip refund adjustments differ from tip refunds");
  }
  const { rows: disputes } = await db.query<{
    stripe_dispute_id: string;
    funds_withdrawn_cents: number;
    funds_reinstated_cents: number;
    needs_review: boolean;
    review_note: string | null;
    recorded: number;
  }>(
    `SELECT d.stripe_dispute_id, d.funds_withdrawn_cents, d.funds_reinstated_cents,
            d.needs_review, d.review_note,
            (SELECT COALESCE(-sum(gross_cents), 0)::int FROM mobility.earning_entries
              WHERE dispute_id = d.id) AS recorded
       FROM mobility.disputes d WHERE d.ride_id = $1`,
    [rideId],
  );
  for (const d of disputes) {
    if (d.recorded !== d.funds_withdrawn_cents - d.funds_reinstated_cents) {
      issues.push(
        `dispute ${d.stripe_dispute_id}: earnings adjustments differ from funds withdrawn`,
      );
    }
    if (d.needs_review) {
      issues.push(
        `dispute ${d.stripe_dispute_id} needs review: ${d.review_note ?? ""}`.trim(),
      );
    }
  }
  return { ok: issues.length === 0, issues };
}
