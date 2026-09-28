import {
  TIP_RULES,
  type TipIneligibleReason,
  type TipState,
  type TipStatus,
  type TipView,
} from "../shared/contracts";

import { type Database, type SqlClient, transaction } from "./db";
import { recordTipEarning, type TipLedgerRow } from "./earnings";
import { ApiError, notFound } from "./errors";

import type { IntentSnapshot, PaymentGateway } from "./payments";

export const TIPS = {
  syncAfterSeconds: 60,
  abandonAfterSeconds: 24 * 3600,
} as const;

interface TipDeps {
  db: Database;
  payments: PaymentGateway;
  now: () => Date;
}

export interface TipRow extends TipLedgerRow {
  user_id: string;
  status: TipStatus;
  idempotency_key: string;
  refunded_cents: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

interface TipRideRow {
  id: string;
  user_id: string;
  status: string;
  payment_status: string;
  demo_driver_id: number | null;
  driver_profile_id: string | null;
  completed_at: Date | null;
  captured_cents: number | null;
  fare_cents: number;
  currency: string;
  driver_name: string | null;
}

const DAY_MS = 24 * 3600 * 1000;
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export function tipStatusFor(intent: IntentSnapshot): TipStatus {
  switch (intent.status) {
    case "succeeded":
      return "succeeded";
    case "processing":
    case "requires_capture":
      return "processing";
    case "requires_action":
      return "requires_action";
    case "canceled":
      return "canceled";
    case "requires_payment_method":
      return intent.hasPaymentError ? "failed" : "pending";
    default:
      return "pending";
  }
}

export function tipEligibility(
  ride: TipRideRow,
  now: Date,
  active: { status: TipStatus } | null,
): { reason: TipIneligibleReason | null; tipBy: Date | null } {
  if (ride.status === "legacy" || ride.demo_driver_id !== null) {
    return { reason: "simulated", tipBy: null };
  }
  if (ride.status !== "completed" || !ride.completed_at) {
    return { reason: "not_completed", tipBy: null };
  }
  if (!ride.driver_profile_id) return { reason: "no_driver", tipBy: null };
  const tipBy = new Date(
    new Date(ride.completed_at).getTime() + TIP_RULES.windowDays * DAY_MS,
  );
  if (ride.payment_status !== "paid") {
    return { reason: "payment_pending", tipBy };
  }
  if (
    active &&
    (active.status === "succeeded" || active.status === "processing")
  ) {
    return { reason: "already_tipped", tipBy };
  }
  if (now.getTime() > tipBy.getTime())
    return { reason: "window_closed", tipBy };
  return { reason: null, tipBy };
}

export function tipSuggestions(fareCents: number): number[] {
  const values = TIP_RULES.suggestedPercents.map((pct) => {
    const raw = Math.round((fareCents * pct) / 100 / 50) * 50;
    return Math.min(TIP_RULES.maxCents, Math.max(TIP_RULES.minCents, raw));
  });
  return [...new Set(values)].sort((a, b) => a - b);
}

export const tipView = (t: TipRow): TipView => ({
  id: t.id,
  amountCents: t.amount_cents,
  currency: "usd",
  status: t.status,
  refundedCents: t.refunded_cents,
  lastError: t.last_error,
  createdAt: iso(t.created_at)!,
  paidAt: iso(t.paid_at),
});

async function loadRide(db: SqlClient, rideId: string, lock = false) {
  const { rows } = await db.query<TipRideRow>(
    `SELECT r.id, r.user_id, r.status, r.payment_status, r.demo_driver_id,
            r.driver_profile_id, r.completed_at, r.captured_cents, r.fare_cents,
            r.currency, dp.display_name AS driver_name
       FROM mobility.rides r
       LEFT JOIN mobility.driver_profiles dp ON dp.id = r.driver_profile_id
      WHERE r.id = $1${lock ? " FOR SHARE OF r" : ""}`,
    [rideId],
  );
  return rows[0] ?? null;
}

async function activeTip(db: SqlClient, rideId: string, lock = false) {
  const { rows } = await db.query<TipRow>(
    `SELECT * FROM mobility.tips WHERE ride_id = $1 AND status <> 'canceled'${lock ? " FOR UPDATE" : ""}`,
    [rideId],
  );
  return rows[0] ?? null;
}

async function ownedRide(
  db: SqlClient,
  userId: string,
  rideId: string,
  lock = false,
) {
  const ride = await loadRide(db, rideId, lock);
  if (!ride || ride.user_id !== userId) throw notFound("Ride");
  return ride;
}

export async function tipState(
  db: SqlClient,
  userId: string,
  rideId: string,
  now: Date,
): Promise<TipState> {
  const ride = await ownedRide(db, userId, rideId);
  const active = await activeTip(db, rideId);
  const { reason, tipBy } = tipEligibility(ride, now, active);
  return {
    eligible: reason === null,
    reason,
    minCents: TIP_RULES.minCents,
    maxCents: TIP_RULES.maxCents,
    suggestionsCents: tipSuggestions(ride.captured_cents ?? ride.fare_cents),
    driverName: ride.driver_name,
    tipBy: iso(tipBy),
    tip: active ? tipView(active) : null,
  };
}

const NOT_ALLOWED: Record<TipIneligibleReason, string> = {
  simulated: "Simulated trips can't be tipped.",
  not_completed: "Only completed trips can be tipped.",
  no_driver: "There's no driver to tip for this trip.",
  payment_pending: "You can tip once the fare payment is confirmed.",
  window_closed: `Tips can be added within ${TIP_RULES.windowDays} days of the trip.`,
  already_tipped: "You've already tipped for this trip.",
};

export async function startTip(
  deps: TipDeps,
  userId: string,
  rideId: string,
  input: { amountCents: number; idempotencyKey: string },
  customerId: () => Promise<string>,
) {
  const now = deps.now();
  const tip = await transaction(deps.db, async (tx) => {
    const ride = await ownedRide(tx, userId, rideId, true);
    const { rows: byKey } = await tx.query<TipRow>(
      "SELECT * FROM mobility.tips WHERE idempotency_key = $1",
      [input.idempotencyKey],
    );
    if (byKey[0]) {
      if (
        byKey[0].ride_id !== rideId ||
        byKey[0].amount_cents !== input.amountCents
      ) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This confirmation was already used for a different tip.",
        );
      }
      return byKey[0];
    }
    const active = await activeTip(tx, rideId, true);
    const { reason } = tipEligibility(ride, now, active);
    if (reason) {
      throw new ApiError(
        409,
        reason === "already_tipped" ? "TIP_ALREADY_PAID" : "TIP_NOT_ALLOWED",
        NOT_ALLOWED[reason],
      );
    }
    if (active) return sameAmount(active, input.amountCents);
    const { rows: inserted } = await tx.query<TipRow>(
      `INSERT INTO mobility.tips
         (ride_id, user_id, driver_profile_id, amount_cents, currency,
          idempotency_key, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (ride_id) WHERE status <> 'canceled' DO NOTHING
       RETURNING *`,
      [
        rideId,
        userId,
        ride.driver_profile_id,
        input.amountCents,
        ride.currency.trim(),
        input.idempotencyKey,
        now,
      ],
    );
    if (inserted[0]) return inserted[0];
    const raced = await activeTip(tx, rideId, true);
    if (!raced) throw new ApiError(409, "RETRY", "Please try again.");
    return sameAmount(raced, input.amountCents);
  });

  if (tip.status === "canceled") {
    throw new ApiError(409, "TIP_CANCELED", "This tip was cancelled.");
  }
  if (tip.status === "succeeded" || tip.status === "processing") {
    throw new ApiError(409, "TIP_ALREADY_PAID", NOT_ALLOWED.already_tipped);
  }

  const customer = await customerId();
  let intent: IntentSnapshot;
  if (tip.stripe_payment_intent_id) {
    intent = await deps.payments.retrievePaymentIntent(
      tip.stripe_payment_intent_id,
    );
  } else {
    intent = await deps.payments.createPaymentIntent(
      {
        amount: tip.amount_cents,
        currency: tip.currency.trim(),
        customer,
        metadata: { tip_id: tip.id, ride_id: tip.ride_id, kind: "tip" },
        captureMethod: "automatic",
        description: "Tip for your driver",
      },
      `tip-${tip.id}`,
    );
    const { rows } = await deps.db.query<{ stripe_payment_intent_id: string }>(
      `UPDATE mobility.tips
          SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $2)
        WHERE id = $1 RETURNING stripe_payment_intent_id`,
      [tip.id, intent.id],
    );
    if (rows[0].stripe_payment_intent_id !== intent.id) {
      intent = await deps.payments.retrievePaymentIntent(
        rows[0].stripe_payment_intent_id,
      );
    }
  }
  const synced = await syncTip(deps, tip.id, intent);
  if (synced.status === "succeeded" || synced.status === "processing") {
    throw new ApiError(409, "TIP_ALREADY_PAID", NOT_ALLOWED.already_tipped);
  }
  if (synced.status === "canceled" || !intent.client_secret) {
    throw new ApiError(409, "TIP_CANCELED", "This tip was cancelled.");
  }
  const ephemeralKey = await deps.payments.createEphemeralKey(customer);
  return {
    tip: tipView(synced),
    paymentIntentClientSecret: intent.client_secret,
    customerId: customer,
    customerEphemeralKeySecret: ephemeralKey.secret,
  };
}

function sameAmount(active: TipRow, amountCents: number) {
  if (active.status === "succeeded" || active.status === "processing") {
    throw new ApiError(409, "TIP_ALREADY_PAID", NOT_ALLOWED.already_tipped);
  }
  if (active.amount_cents !== amountCents) {
    throw new ApiError(
      409,
      "TIP_IN_PROGRESS",
      "You already started a tip with a different amount. Cancel it first to choose another amount.",
    );
  }
  return active;
}

export async function syncTip(
  deps: { db: Database; now: () => Date },
  tipId: string,
  intent: IntentSnapshot,
): Promise<TipRow> {
  const now = deps.now();
  return transaction(deps.db, async (tx) => {
    const { rows } = await tx.query<TipRow>(
      "SELECT * FROM mobility.tips WHERE id = $1 FOR UPDATE",
      [tipId],
    );
    const tip = rows[0];
    if (!tip) throw notFound("Tip");
    if (
      tip.stripe_payment_intent_id !== intent.id ||
      intent.metadata.tip_id !== tip.id ||
      intent.amount !== tip.amount_cents ||
      intent.currency !== tip.currency.trim()
    ) {
      console.error(JSON.stringify({ event: "tip_payment_mismatch", tipId }));
      throw new ApiError(
        409,
        "PAYMENT_MISMATCH",
        "This payment does not match the tip.",
      );
    }
    const next = tipStatusFor(intent);
    if (
      tip.status === "succeeded" ||
      tip.status === "canceled" ||
      next === tip.status
    ) {
      const { rows: touched } = await tx.query<TipRow>(
        "UPDATE mobility.tips SET updated_at = $2 WHERE id = $1 RETURNING *",
        [tip.id, now],
      );
      return touched[0];
    }
    const { rows: updated } = await tx.query<TipRow>(
      `UPDATE mobility.tips
          SET status = $2, last_error = $3, updated_at = $4,
              paid_at = CASE WHEN $2::varchar = 'succeeded' THEN $4::timestamptz ELSE NULL END
        WHERE id = $1 RETURNING *`,
      [
        tip.id,
        next,
        next === "failed"
          ? "The card was declined. Try again or use another card."
          : null,
        now,
      ],
    );
    if (next === "succeeded") await recordTipEarning(tx, updated[0], now);
    return updated[0];
  });
}

export async function refreshTip(
  deps: TipDeps,
  userId: string,
  rideId: string,
) {
  await ownedRide(deps.db, userId, rideId);
  const tip = await activeTip(deps.db, rideId);
  if (!tip) return null;
  if (!tip.stripe_payment_intent_id) return tipView(tip);
  const intent = await deps.payments.retrievePaymentIntent(
    tip.stripe_payment_intent_id,
  );
  return tipView(await syncTip(deps, tip.id, intent));
}

export async function cancelTip(deps: TipDeps, userId: string, rideId: string) {
  await ownedRide(deps.db, userId, rideId);
  const tip = await activeTip(deps.db, rideId);
  if (!tip) throw notFound("Tip");
  return tipView(await cancelTipRow(deps, tip));
}

async function cancelTipRow(deps: TipDeps, tip: TipRow): Promise<TipRow> {
  if (tip.status === "succeeded" || tip.status === "processing") {
    throw new ApiError(
      409,
      "TIP_ALREADY_PAID",
      "This tip has already been paid and can't be cancelled.",
    );
  }
  if (!tip.stripe_payment_intent_id) {
    const { rows } = await deps.db.query<TipRow>(
      `UPDATE mobility.tips SET status = 'canceled', updated_at = $2
        WHERE id = $1 AND status = 'creating' AND stripe_payment_intent_id IS NULL
        RETURNING *`,
      [tip.id, deps.now()],
    );
    if (rows[0]) return rows[0];
    const { rows: fresh } = await deps.db.query<TipRow>(
      "SELECT * FROM mobility.tips WHERE id = $1",
      [tip.id],
    );
    return cancelTipRow(deps, fresh[0]);
  }
  let intent: IntentSnapshot;
  try {
    intent = await deps.payments.cancelPaymentIntent(
      tip.stripe_payment_intent_id,
      `tip-${tip.id}-cancel`,
    );
  } catch {
    intent = await deps.payments.retrievePaymentIntent(
      tip.stripe_payment_intent_id,
    );
  }
  const synced = await syncTip(deps, tip.id, intent);
  if (synced.status !== "canceled") {
    throw new ApiError(
      409,
      "TIP_ALREADY_PAID",
      "This tip has already been paid and can't be cancelled.",
    );
  }
  return synced;
}

export async function tipForIntent(db: SqlClient, paymentIntentId: string) {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM mobility.tips WHERE stripe_payment_intent_id = $1",
    [paymentIntentId],
  );
  return rows[0]?.id ?? null;
}

export async function syncOpenTips(deps: TipDeps, limit = 20) {
  const now = deps.now();
  const { rows: stale } = await deps.db.query<TipRow>(
    `SELECT * FROM mobility.tips
      WHERE status IN ('pending', 'requires_action', 'processing', 'failed')
        AND stripe_payment_intent_id IS NOT NULL AND updated_at <= $1
      ORDER BY updated_at LIMIT $2`,
    [new Date(now.getTime() - TIPS.syncAfterSeconds * 1000), limit],
  );
  for (const tip of stale) {
    try {
      const intent = await deps.payments.retrievePaymentIntent(
        tip.stripe_payment_intent_id!,
      );
      const synced = await syncTip(deps, tip.id, intent);
      if (
        synced.status !== "succeeded" &&
        synced.status !== "processing" &&
        now.getTime() - new Date(synced.created_at).getTime() >
          TIPS.abandonAfterSeconds * 1000
      ) {
        await cancelTipRow(deps, synced);
      }
    } catch {
      continue;
    }
  }
  const { rows: unstarted } = await deps.db.query<TipRow>(
    `SELECT * FROM mobility.tips
      WHERE status = 'creating' AND created_at <= $1 LIMIT $2`,
    [new Date(now.getTime() - TIPS.abandonAfterSeconds * 1000), limit],
  );
  for (const tip of unstarted) {
    await cancelTipRow(deps, tip).catch(() => undefined);
  }
  return stale.length + unstarted.length;
}
