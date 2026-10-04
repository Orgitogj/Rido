import {
  type AssignedDriver,
  type RideView,
  type SettlementState,
} from "../shared/contracts";

import { type IdentityAdmin, processAccountDeletions } from "./account";
import { cancellationPreview } from "./cancellation";
import { chatSummary, purgeExpiredChats } from "./chat";
import { type Database, type SqlClient, transaction } from "./db";
import { syncOpenDisputes } from "./disputes";
import { ensureRideEarning, reconcileEarnings } from "./earnings";
import { ApiError, notFound } from "./errors";
import { claimJob, recordStep } from "./jobs";
import {
  allowedActions,
  lockRide,
  type RideRow,
  TERMINAL_STATUSES,
  transitionRide,
  UNCHARGED_END_STATUSES,
} from "./lifecycle";
import {
  advanceRide,
  MATCHING,
  offerToNextDriver,
  refreshMatchRanking,
} from "./matching";
import {
  checkReceipts,
  deliverPending,
  enqueueNotification,
  type PushGateway,
} from "./notifications";
import { NOTIFY } from "./notificationText";
import {
  canChangePayment,
  type IntentSnapshot,
  type PaymentGateway,
  paymentStatusFor,
} from "./payments";
import { pruneRateLimits } from "./rateLimit";
import { ratingState, summarySql, toSummary } from "./ratings";
import { resubmitStaleRefunds, syncOpenRefunds } from "./refunds";
import { pruneRoutingUsage } from "./routingBudget";
import { redactExpiredEvidence } from "./safety";
import { purgeSupportAttachments } from "./supportAttachments";
import { syncOpenTipRefunds } from "./tipRefunds";
import { syncOpenTips } from "./tips";
import { enforceDriverEligibility, purgeDriverDocuments } from "./verification";

import type { RoutingProvider } from "./routing";
import type { DocumentStorage } from "./storage";

export interface RideDeps {
  db: Database;
  payments: PaymentGateway;
  identity?: IdentityAdmin | null;
  push?: PushGateway | null;
  storage?: DocumentStorage | null;
  routing?: RoutingProvider | null;
  now: () => Date;
}

const log = (event: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ event, ...fields }));

export async function withLockedRide<T>(
  deps: RideDeps,
  rideId: string,
  fn: (tx: SqlClient, ride: RideRow) => Promise<T>,
): Promise<T> {
  const result = await transaction(deps.db, async (tx) => {
    const ride = await lockRide(tx, rideId);
    if (!ride) throw notFound("Ride");
    return fn(tx, ride);
  });
  await deliverPending(deps).catch(() => {
    log("notification_delivery_deferred", { rideId });
  });
  return result;
}

export const SETTLEMENT = {
  baseRetrySeconds: 30,
  maxRetrySeconds: 3600,
  reviewAfterAttempts: 6,
  fallbackHoldSeconds: 7 * 24 * 3600 - 3600,
} as const;

const FINAL_PAYMENT: RideRow["payment_status"][] = [
  "paid",
  "cancelled",
  "expired",
];

export function settlementNeed(ride: RideRow): "capture" | "release" | null {
  if (!ride.stripe_payment_intent_id || ride.settled_at) return null;
  if (ride.status === "completed" && ride.payment_status === "authorized") {
    return "capture";
  }
  if (
    UNCHARGED_END_STATUSES.includes(ride.status) &&
    !FINAL_PAYMENT.includes(ride.payment_status)
  ) {
    return "release";
  }
  return null;
}

export function settlementState(ride: RideRow): SettlementState {
  if (settlementNeed(ride)) {
    if (ride.needs_review) return "needs_review";
    return ride.settlement_attempts > 0 ? "retrying" : "pending";
  }
  return ride.settled_at ? "settled" : "none";
}

async function ledger(
  tx: SqlClient,
  rideId: string,
  kind: string,
  amount: number | null,
  stripeObjectId: string | null,
  actor: string,
  detail: string | null = null,
) {
  await tx.query(
    `INSERT INTO mobility.payment_events
       (ride_id, kind, amount_cents, stripe_object_id, actor, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [rideId, kind, amount, stripeObjectId, actor, detail],
  );
}

async function recordIntent(
  tx: SqlClient,
  ride: RideRow,
  intent: IntentSnapshot,
  now: Date,
): Promise<RideRow> {
  const next = paymentStatusFor(intent);
  if (!canChangePayment(ride.payment_status, next)) return ride;
  if (next === "paid" && ride.status !== "completed") {
    log("paid_before_completion", { rideId: ride.id });
  }
  const expiresAt =
    next === "authorized"
      ? intent.captureBefore
        ? new Date(intent.captureBefore * 1000)
        : new Date(now.getTime() + SETTLEMENT.fallbackHoldSeconds * 1000)
      : ride.authorization_expires_at;
  const captured =
    next === "paid"
      ? intent.amountReceived || intent.amount
      : ride.captured_cents;
  const settled =
    TERMINAL_STATUSES.includes(ride.status) && FINAL_PAYMENT.includes(next);
  const expiredAfterTrip = next === "expired" && ride.status === "completed";

  const { rows } = await tx.query<RideRow>(
    `UPDATE mobility.rides
        SET payment_status = $2::varchar,
            authorized_at = CASE WHEN $2::varchar = 'authorized' THEN $3::timestamptz ELSE authorized_at END,
            paid_at = CASE WHEN $2::varchar = 'paid' THEN $3::timestamptz ELSE NULL END,
            captured_cents = $4,
            authorization_expires_at = $5,
            settled_at = CASE WHEN $6::boolean THEN COALESCE(settled_at, $3::timestamptz) ELSE settled_at END,
            settlement_error = CASE WHEN $6::boolean THEN NULL ELSE settlement_error END,
            next_settlement_at = CASE WHEN $6::boolean THEN NULL ELSE next_settlement_at END,
            needs_review = needs_review OR $7::boolean,
            review_reason = CASE WHEN $7::boolean THEN 'authorization_expired_before_capture' ELSE review_reason END,
            version = version + 1, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [ride.id, next, now, captured, expiresAt, settled, expiredAfterTrip],
  );
  const updated = rows[0];

  if (next === "authorized") {
    await ledger(
      tx,
      ride.id,
      "authorized",
      ride.fare_cents,
      intent.id,
      "stripe",
    );
  } else if (next === "paid") {
    await ledger(tx, ride.id, "captured", captured, intent.id, "stripe");
    await ensureRideEarning(tx, ride.id, now);
  } else if (next === "cancelled" && ride.authorized_at) {
    await ledger(tx, ride.id, "released", ride.fare_cents, intent.id, "stripe");
    await enqueueNotification(
      tx,
      {
        userId: ride.user_id,
        rideId: ride.id,
        kind: "hold_released",
        dedupeKey: `ride:${ride.id}:hold_released`,
        ...NOTIFY.holdReleased(ride.fare_cents),
        target: `/receipt/${ride.id}`,
      },
      now,
    );
  } else if (next === "expired") {
    await ledger(tx, ride.id, "expired", ride.fare_cents, intent.id, "stripe");
  }
  return updated;
}

export async function syncIntent(
  deps: RideDeps,
  rideId: string,
  intent: IntentSnapshot,
): Promise<RideRow> {
  if (intent.status === "requires_capture") {
    await refreshMatchRanking(deps, rideId).catch(() =>
      log("ranking_refresh_failed", { rideId }),
    );
  }
  const ride = await withLockedRide(deps, rideId, async (tx, ride) => {
    if (
      ride.stripe_payment_intent_id !== intent.id ||
      intent.amount !== ride.fare_cents ||
      intent.currency !== ride.currency.trim() ||
      intent.metadata.ride_id !== ride.id
    ) {
      log("payment_mismatch", { rideId: ride.id });
      throw new ApiError(
        409,
        "PAYMENT_MISMATCH",
        "This payment does not match the booking.",
      );
    }
    const now = deps.now();
    ride = await recordIntent(tx, ride, intent, now);

    if (
      ride.payment_status === "authorized" &&
      ride.status === "awaiting_payment"
    ) {
      ride = await transitionRide(tx, ride, "requested", {
        actor: "system",
        now,
        set: {
          search_deadline: new Date(
            now.getTime() + MATCHING.searchTimeoutSeconds * 1000,
          ),
        },
      });
      ride = await offerToNextDriver(tx, ride, now);
    }
    return ride;
  });
  return settlePayment(deps, ride, { force: true });
}

export async function settlePayment(
  deps: RideDeps,
  ride: RideRow,
  opts: { force?: boolean } = {},
): Promise<RideRow> {
  const need = settlementNeed(ride);
  const pi = ride.stripe_payment_intent_id;
  if (!need || !pi) return ride;
  const now = deps.now();
  if (
    !opts.force &&
    ride.next_settlement_at &&
    new Date(ride.next_settlement_at) > now
  ) {
    return ride;
  }

  let intent: IntentSnapshot | null = null;
  let failure: string | null = null;
  let skippedExpired = false;
  try {
    if (need === "capture") {
      const pastDeadline =
        ride.authorization_expires_at &&
        now >= new Date(ride.authorization_expires_at);
      if (pastDeadline) {
        intent = await deps.payments.retrievePaymentIntent(pi);
        if (intent.status === "requires_capture") {
          intent = await deps.payments.capturePaymentIntent(
            pi,
            `ride-${ride.id}-capture`,
          );
        } else {
          skippedExpired = true;
        }
      } else {
        intent = await deps.payments.capturePaymentIntent(
          pi,
          `ride-${ride.id}-capture`,
        );
      }
    } else {
      intent = await deps.payments.cancelPaymentIntent(
        pi,
        `ride-${ride.id}-release`,
      );
    }
  } catch (error) {
    failure = (error instanceof Error ? error.message : "unknown").slice(
      0,
      100,
    );
    log("payment_settlement_deferred", { rideId: ride.id, need });
    try {
      intent = await deps.payments.retrievePaymentIntent(pi);
    } catch {
      intent = null;
    }
  }

  return withLockedRide(deps, ride.id, async (tx, current) => {
    let row = current;
    if (intent) {
      if (skippedExpired) {
        await ledger(
          tx,
          row.id,
          "capture_skipped_expired",
          row.fare_cents,
          pi,
          "system",
          `stripe_status_${intent.status}`,
        );
      }
      row = await recordIntent(tx, row, intent, now);
    }
    if (!failure || !settlementNeed(row)) return row;
    const attempts = row.settlement_attempts + 1;
    const delay = Math.min(
      SETTLEMENT.maxRetrySeconds,
      SETTLEMENT.baseRetrySeconds * 2 ** (attempts - 1),
    );
    await ledger(tx, row.id, "settlement_failed", null, pi, "system", failure);
    const { rows } = await tx.query<RideRow>(
      `UPDATE mobility.rides
          SET settlement_attempts = $2, settlement_error = $3,
              next_settlement_at = $4,
              needs_review = needs_review OR $5::boolean,
              review_reason = CASE WHEN $5::boolean AND NOT needs_review
                                   THEN 'settlement_failing' ELSE review_reason END,
              version = version + 1, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [
        row.id,
        attempts,
        failure,
        new Date(now.getTime() + delay * 1000),
        attempts >= SETTLEMENT.reviewAfterAttempts,
      ],
    );
    return rows[0];
  });
}

export async function advanceRideById(
  deps: RideDeps,
  rideId: string,
): Promise<RideRow> {
  await refreshMatchRanking(deps, rideId).catch(() =>
    log("ranking_refresh_failed", { rideId }),
  );
  const ride = await withLockedRide(deps, rideId, (tx, ride) =>
    advanceRide(tx, ride, deps.now()),
  );
  return settlePayment(deps, ride);
}

export const SWEEP = {
  heartbeatMaintenanceSeconds: 20,
} as const;

export async function sweep(
  deps: RideDeps,
  limit = 25,
  opts: { maintenance?: "always" | "throttled" } = {},
): Promise<number> {
  const now = deps.now();
  const { rows } = await deps.db.query<{ id: string }>(
    `SELECT id FROM mobility.rides
      WHERE status IN ('requested', 'offered')
         OR (status = 'awaiting_payment' AND created_at <= $1)
         OR (settled_at IS NULL AND stripe_payment_intent_id IS NOT NULL
             AND ((status = 'completed' AND payment_status = 'authorized')
               OR (status IN ('cancelled', 'no_driver', 'interrupted')
                   AND payment_status NOT IN ('cancelled', 'paid', 'expired')))
             AND (next_settlement_at IS NULL OR next_settlement_at <= $2))
         OR (status IN ('accepted', 'arriving', 'arrived', 'in_progress')
             AND authorization_expires_at <= $3 AND NOT needs_review)
      ORDER BY created_at
      LIMIT $4`,
    [
      new Date(now.getTime() - MATCHING.awaitingPaymentTtlSeconds * 1000),
      now,
      new Date(now.getTime() + MATCHING.authorizationSafetySeconds * 1000),
      limit,
    ],
  );
  for (const { id } of rows) {
    try {
      await advanceRideById(deps, id);
    } catch {
      log("sweep_ride_failed", { rideId: id });
    }
  }
  const maintain =
    opts.maintenance !== "throttled" ||
    (await claimJob(
      deps.db,
      "maintenance",
      now,
      SWEEP.heartbeatMaintenanceSeconds,
    ));
  if (maintain) {
    const identityDeps = {
      db: deps.db,
      payments: deps.payments,
      identity: deps.identity ?? null,
      now: deps.now,
    };
    const steps: [string, () => Promise<unknown>][] = [
      ["refund_sync", () => syncOpenRefunds(deps)],
      ["tip_sync", () => syncOpenTips(deps)],
      ["tip_refund_sync", () => syncOpenTipRefunds(deps)],
      ["dispute_sync", () => syncOpenDisputes(deps)],
      ["safety_evidence_redaction", () => redactExpiredEvidence(deps)],
      ["account_deletion", () => processAccountDeletions(identityDeps)],
      ["routing_usage_prune", () => pruneRoutingUsage(deps.db, now)],
      ["rate_limit_prune", () => pruneRateLimits(deps.db, now)],
      ["driver_eligibility", () => enforceDriverEligibility(deps)],
      ["support_attachment_purge", () => purgeSupportAttachments(deps)],
      ["driver_document_purge", () => purgeDriverDocuments(deps)],
      ["earnings_reconcile", () => reconcileEarnings(deps)],
      ["refund_resubmit", () => resubmitStaleRefunds(deps)],
      ["chat_purge", () => purgeExpiredChats(deps)],
      ["push_receipts", () => checkReceipts(deps)],
    ];
    for (const [name, run] of steps) {
      const error = await recordStep(deps.db, name, now, run);
      if (error) log(`${name}_failed`, {});
    }
  }
  await deliverPending(deps, 100).catch(() => {});
  return rows.length;
}

interface ViewRow extends RideRow {
  passenger_name: string | null;
  driver_name: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_plate: string | null;
  vehicle_seats: number | null;
  vehicle_color: string | null;
  demo_driver_name: string | null;
  chat_seq: number;
  passenger_unread: number;
  driver_unread: number;
  passenger_rating_stars: number | null;
  passenger_rating_comment: string | null;
  passenger_rating_at: Date | null;
  driver_rating_stars: number | null;
  driver_rating_comment: string | null;
  driver_rating_at: Date | null;
  driver_summary: { count: number; avg: number | null } | null;
  passenger_summary: { count: number; avg: number | null } | null;
}

const viewSql = (nowRef: string) => `
  SELECT r.*, COALESCE(r.passenger_name, u.name) AS passenger_name,
         dp.display_name AS driver_name, dp.vehicle_make, dp.vehicle_model,
         dp.vehicle_plate, dp.vehicle_seats, dp.vehicle_color,
         CASE WHEN dd.id IS NULL THEN NULL
              ELSE dd.first_name || ' ' || dd.last_name END AS demo_driver_name,
         COALESCE(c.last_seq, 0) AS chat_seq,
         (SELECT count(*)::int FROM mobility.ride_messages m
           WHERE m.ride_id = r.id AND m.sender_role = 'driver'
             AND m.seq > COALESCE(c.passenger_read_seq, 0)) AS passenger_unread,
         (SELECT count(*)::int FROM mobility.ride_messages m
           WHERE m.ride_id = r.id AND m.sender_role = 'passenger'
             AND m.driver_profile_id = r.driver_profile_id
             AND m.seq > COALESCE(c.driver_read_seq, 0)) AS driver_unread,
         rp.stars AS passenger_rating_stars, rp.comment AS passenger_rating_comment,
         rp.created_at AS passenger_rating_at,
         rd.stars AS driver_rating_stars, rd.comment AS driver_rating_comment,
         rd.created_at AS driver_rating_at,
         CASE WHEN dp.id IS NULL THEN NULL
              ELSE ${summarySql("dp.user_id", "passenger", nowRef)} END AS driver_summary,
         ${summarySql("r.user_id", "driver", nowRef)} AS passenger_summary
    FROM mobility.rides r
    JOIN mobility.users u ON u.id = r.user_id
    LEFT JOIN mobility.driver_profiles dp ON dp.id = r.driver_profile_id
    LEFT JOIN mobility.demo_drivers dd ON dd.id = r.demo_driver_id
    LEFT JOIN mobility.ride_chats c ON c.ride_id = r.id
    LEFT JOIN mobility.ratings rp ON rp.ride_id = r.id AND rp.rater_role = 'passenger'
    LEFT JOIN mobility.ratings rd ON rd.ride_id = r.id AND rd.rater_role = 'driver'`;

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

function toView(
  row: ViewRow,
  viewer: "passenger" | "driver",
  now: Date,
): RideView {
  let driver: AssignedDriver | null = null;
  if (row.driver_profile_id && row.driver_name) {
    driver = {
      name: row.driver_name,
      vehicle: `${row.vehicle_make} ${row.vehicle_model}`,
      color: row.vehicle_color,
      plate: row.vehicle_plate ?? "",
      seats: row.vehicle_seats ?? 0,
    };
  }
  const mine =
    viewer === "passenger"
      ? row.passenger_rating_at
        ? {
            stars: row.passenger_rating_stars!,
            comment: row.passenger_rating_comment,
            created_at: row.passenger_rating_at,
          }
        : null
      : row.driver_rating_at
        ? {
            stars: row.driver_rating_stars!,
            comment: row.driver_rating_comment,
            created_at: row.driver_rating_at,
          }
        : null;
  return {
    id: row.id,
    viewer,
    status: row.status,
    paymentStatus: row.payment_status,
    version: row.version,
    fareCents: row.fare_cents,
    currency: "usd",
    pickup: {
      address: row.origin_address,
      latitude: row.origin_latitude,
      longitude: row.origin_longitude,
    },
    destination: {
      address: row.destination_address,
      latitude: row.destination_latitude,
      longitude: row.destination_longitude,
    },
    distanceMeters: row.distance_meters,
    durationSeconds: row.duration_seconds,
    createdAt: iso(row.created_at)!,
    requestedAt: iso(row.requested_at),
    searchDeadline: iso(row.search_deadline),
    acceptedAt: iso(row.accepted_at),
    arrivedAt: iso(row.arrived_at),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    cancelledAt: iso(row.cancelled_at),
    cancelledBy: row.cancelled_by,
    cancelReason: row.cancel_reason,
    driver,
    passengerName:
      viewer === "driver" ? (row.passenger_name ?? "Passenger") : null,
    legacyDemoDriver: row.status === "legacy" ? row.demo_driver_name : null,
    allowedActions: allowedActions(row.status, viewer),
    cancellation: cancellationPreview(row, viewer),
    rematchCount: row.rematch_count,
    settlement: viewer === "passenger" ? settlementState(row) : "none",
    chat: chatSummary(
      row,
      viewer === "passenger" ? row.passenger_unread : row.driver_unread,
      now,
    ),
    rating: ratingState(row, mine, now),
    counterpartRating:
      viewer === "passenger"
        ? driver
          ? toSummary(row.driver_summary)
          : null
        : toSummary(row.passenger_summary),
    serverTime: now.toISOString(),
  };
}

export async function rideViews(
  db: SqlClient,
  where: string,
  values: unknown[],
  viewer: "passenger" | "driver",
  now: Date,
  suffix = "",
): Promise<RideView[]> {
  const { rows } = await db.query<ViewRow>(
    `${viewSql(`$${values.length + 1}::timestamptz`)} WHERE ${where} ${suffix}`,
    [...values, now],
  );
  return rows.map((r) => toView(r, viewer, now));
}

export async function rideView(
  db: SqlClient,
  rideId: string,
  viewer: "passenger" | "driver",
  now: Date,
): Promise<RideView> {
  const [view] = await rideViews(db, "r.id = $1", [rideId], viewer, now);
  if (!view) throw notFound("Ride");
  return view;
}
