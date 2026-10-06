import { ensureRideEarning } from "./earnings";
import { ApiError } from "./errors";

import type { SqlClient } from "./db";
import type { RideRow } from "./lifecycle";
import type {
  CollectionView,
  DriverBalanceView,
  DriverSettlementView,
} from "../shared/contracts";
import type { Currency } from "../shared/currency";

export const COLLECTION = {
  unrecordedReviewSeconds: 2 * 3600,
} as const;

export type CollectionOutcome = "pos" | "cash" | "unpaid" | "waived";

const COLLECTION_REVIEW_REASONS = [
  "passenger_unpaid",
  "collection_not_recorded",
];

export function collectionView(
  row: RideRow,
  viewer: "passenger" | "driver",
): CollectionView | null {
  if (row.payment_method !== "in_vehicle" || !row.collection_status)
    return null;
  return {
    status: row.collection_status,
    method: row.collection_method,
    collectedAt: row.collected_at
      ? new Date(row.collected_at).toISOString()
      : null,
    canRecord: viewer === "driver" && row.collection_status === "pending",
  };
}

export async function assertNoUnpaidRide(db: SqlClient, userId: string) {
  const { rows } = await db.query(
    "SELECT 1 FROM mobility.rides WHERE user_id = $1 AND collection_status = 'unpaid' LIMIT 1",
    [userId],
  );
  if (rows.length) {
    throw new ApiError(
      409,
      "UNPAID_RIDE",
      "A previous trip is recorded as unpaid. Contact support to settle it before requesting another ride.",
    );
  }
}

export async function recordCollection(
  tx: SqlClient,
  ride: RideRow,
  input: {
    outcome: CollectionOutcome;
    by: "driver" | "operator";
    operatorId?: string | null;
    note?: string | null;
    now: Date;
  },
): Promise<RideRow> {
  if (ride.payment_method !== "in_vehicle" || ride.status !== "completed") {
    throw new ApiError(
      409,
      "COLLECTION_NOT_ALLOWED",
      "Payment can only be recorded for a completed trip that is paid in the vehicle.",
    );
  }
  const current = ride.collection_status ?? "pending";
  const same =
    (current === "collected" && ride.collection_method === input.outcome) ||
    (current === input.outcome &&
      (input.outcome === "unpaid" || input.outcome === "waived"));
  if (same) return ride;
  const open =
    current === "pending" || (input.by === "operator" && current === "unpaid");
  if (!open) {
    throw new ApiError(
      409,
      "COLLECTION_RECORDED",
      "The payment for this trip has already been recorded.",
    );
  }
  if (input.outcome === "waived" && input.by !== "operator") {
    throw new ApiError(403, "FORBIDDEN", "Only support can waive a payment.");
  }

  const collected = input.outcome === "pos" || input.outcome === "cash";
  const { rows } = await tx.query<RideRow>(
    `UPDATE mobility.rides
        SET collection_status = $2::varchar,
            collection_method = $3::varchar,
            collected_at = $4::timestamptz,
            payment_status = $5::varchar,
            paid_at = $4::timestamptz,
            captured_cents = CASE WHEN $6::boolean THEN fare_cents ELSE captured_cents END,
            settled_at = COALESCE(settled_at, $7::timestamptz),
            collection_recorded_by = $8::varchar,
            collection_operator_id = $9::uuid,
            collection_note = $10::varchar,
            needs_review = CASE
              WHEN $2::varchar = 'unpaid' THEN true
              WHEN review_reason = ANY($11::text[]) THEN false
              ELSE needs_review END,
            review_reason = CASE WHEN $2::varchar = 'unpaid' THEN 'passenger_unpaid' ELSE review_reason END,
            review_resolved_at = CASE WHEN $2::varchar = 'unpaid' THEN NULL ELSE review_resolved_at END,
            version = version + 1, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [
      ride.id,
      collected ? "collected" : input.outcome,
      collected ? input.outcome : null,
      collected ? input.now : null,
      collected ? "paid" : input.outcome === "unpaid" ? "failed" : "cancelled",
      collected,
      input.now,
      input.by,
      input.operatorId ?? null,
      input.note ? input.note.slice(0, 500) : null,
      COLLECTION_REVIEW_REASONS,
    ],
  );
  await tx.query(
    `INSERT INTO mobility.ride_events
       (ride_id, from_status, to_status, actor, reason, created_at)
     VALUES ($1, 'completed', 'completed', $2, $3, $4)`,
    [ride.id, input.by, `collection_${input.outcome}`, input.now],
  );
  if (collected) await ensureRideEarning(tx, ride.id, input.now);
  return rows[0];
}

export async function flagUnrecordedCollections(db: SqlClient, now: Date) {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE mobility.rides
        SET needs_review = true, review_reason = 'collection_not_recorded',
            review_resolved_at = NULL, version = version + 1, updated_at = now()
      WHERE collection_status = 'pending' AND status = 'completed'
        AND completed_at <= $1 AND NOT needs_review
      RETURNING id`,
    [new Date(now.getTime() - COLLECTION.unrecordedReviewSeconds * 1000)],
  );
  return rows.length;
}

interface BalanceRow {
  driver_profile_id: string;
  display_name: string;
  currency: string;
  owed_to_driver: string | number;
  owed_by_driver: string | number;
  paid_to_driver: string | number;
  received_from_driver: string | number;
  last_settlement_at: Date | null;
}

const BALANCE_SQL = `
  SELECT dp.id AS driver_profile_id, dp.display_name, c.currency,
         COALESCE((SELECT sum(e.driver_amount_cents) FROM mobility.earning_entries e
                    WHERE e.driver_profile_id = dp.id AND e.currency = c.currency
                      AND e.funds_held_by = 'platform'), 0) AS owed_to_driver,
         COALESCE((SELECT sum(e.commission_cents) FROM mobility.earning_entries e
                    WHERE e.driver_profile_id = dp.id AND e.currency = c.currency
                      AND e.funds_held_by = 'driver'), 0) AS owed_by_driver,
         COALESCE((SELECT sum(s.amount_cents) FROM mobility.driver_settlements s
                    WHERE s.driver_profile_id = dp.id AND s.currency = c.currency
                      AND s.direction = 'to_driver'), 0) AS paid_to_driver,
         COALESCE((SELECT sum(s.amount_cents) FROM mobility.driver_settlements s
                    WHERE s.driver_profile_id = dp.id AND s.currency = c.currency
                      AND s.direction = 'from_driver'), 0) AS received_from_driver,
         (SELECT max(s.created_at) FROM mobility.driver_settlements s
           WHERE s.driver_profile_id = dp.id AND s.currency = c.currency) AS last_settlement_at
    FROM mobility.driver_profiles dp
    CROSS JOIN (SELECT $1::char(3) AS currency) c`;

function balanceFrom(row: BalanceRow, currency: Currency): DriverBalanceView {
  const owedToDriver = Number(row.owed_to_driver);
  const owedByDriver = Number(row.owed_by_driver);
  const paidToDriver = Number(row.paid_to_driver);
  const receivedFromDriver = Number(row.received_from_driver);
  return {
    currency,
    earnedHeldByPlatformCents: owedToDriver,
    commissionOnCashCents: owedByDriver,
    paidToDriverCents: paidToDriver,
    receivedFromDriverCents: receivedFromDriver,
    netOwedToDriverCents:
      owedToDriver - owedByDriver - paidToDriver + receivedFromDriver,
    lastSettlementAt: row.last_settlement_at
      ? new Date(row.last_settlement_at).toISOString()
      : null,
  };
}

export async function driverBalance(
  db: SqlClient,
  profileId: string,
  currency: Currency,
): Promise<DriverBalanceView> {
  const { rows } = await db.query<BalanceRow>(
    `${BALANCE_SQL} WHERE dp.id = $2`,
    [currency, profileId],
  );
  return balanceFrom(rows[0], currency);
}

export async function listDriverBalances(db: SqlClient, currency: Currency) {
  const { rows } = await db.query<BalanceRow>(
    `${BALANCE_SQL}
      WHERE dp.status IN ('approved', 'suspended')
         OR EXISTS (SELECT 1 FROM mobility.earning_entries e WHERE e.driver_profile_id = dp.id)
      ORDER BY dp.display_name, dp.id
      LIMIT 500`,
    [currency],
  );
  return rows.map((row) => ({
    driverProfileId: row.driver_profile_id,
    displayName: row.display_name,
    balance: balanceFrom(row, currency),
  }));
}

interface SettlementRow {
  id: string;
  direction: "to_driver" | "from_driver";
  amount_cents: number;
  currency: string;
  method: "bank_transfer" | "cash";
  reference: string | null;
  note: string | null;
  operator: string | null;
  created_at: Date;
}

const settlementView = (s: SettlementRow): DriverSettlementView => ({
  id: s.id,
  direction: s.direction,
  amountCents: s.amount_cents,
  currency: s.currency.trim() === "all" ? "all" : "usd",
  method: s.method,
  reference: s.reference,
  note: s.note,
  operator: s.operator,
  createdAt: new Date(s.created_at).toISOString(),
});

export async function listSettlements(
  db: SqlClient,
  profileId: string,
  limit = 50,
) {
  const { rows } = await db.query<SettlementRow>(
    `SELECT s.id, s.direction, s.amount_cents, s.currency, s.method, s.reference,
            s.note, o.display_name AS operator, s.created_at
       FROM mobility.driver_settlements s
       LEFT JOIN mobility.operators o ON o.id = s.operator_id
      WHERE s.driver_profile_id = $1
      ORDER BY s.created_at DESC, s.id DESC LIMIT $2`,
    [profileId, limit],
  );
  return rows.map(settlementView);
}

export async function createSettlement(
  tx: SqlClient,
  input: {
    profileId: string;
    direction: "to_driver" | "from_driver";
    amountCents: number;
    currency: Currency;
    method: "bank_transfer" | "cash";
    reference: string | null;
    note: string | null;
    operatorId: string;
    idempotencyKey: string;
    now: Date;
  },
): Promise<{ created: boolean }> {
  const { rows: driver } = await tx.query(
    "SELECT 1 FROM mobility.driver_profiles WHERE id = $1 FOR UPDATE",
    [input.profileId],
  );
  if (!driver.length) throw new ApiError(404, "NOT_FOUND", "Driver not found.");
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO mobility.driver_settlements
       (driver_profile_id, direction, amount_cents, currency, method, reference,
        note, operator_id, idempotency_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.profileId,
      input.direction,
      input.amountCents,
      input.currency,
      input.method,
      input.reference,
      input.note,
      input.operatorId,
      input.idempotencyKey,
      input.now,
    ],
  );
  if (rows.length) return { created: true };
  const { rows: existing } = await tx.query<{
    driver_profile_id: string;
    direction: string;
    amount_cents: number;
  }>(
    "SELECT driver_profile_id, direction, amount_cents FROM mobility.driver_settlements WHERE idempotency_key = $1",
    [input.idempotencyKey],
  );
  const same =
    existing[0]?.driver_profile_id === input.profileId &&
    existing[0].direction === input.direction &&
    existing[0].amount_cents === input.amountCents;
  if (!same) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "This submission was already used for a different transfer.",
    );
  }
  return { created: false };
}
