import {
  adminFeedbackQuerySchema,
  type AdminFeedbackItem,
  type AdminRideDetail,
  type AdminRideListItem,
  type AdminDispute,
  type AdminRefund,
  adminRefundSchema,
  adminTipRefundSchema,
  pinWaiverSchema,
  adminReviewQuerySchema,
  adminRideQuerySchema,
  type AdminSupportDetail,
  type AdminSupportItem,
  adminSupportQuerySchema,
  type OperatorMe,
  feedbackModerationSchema,
  type Page,
  type ReviewCategory,
  type ReviewItem,
  reviewResolveSchema,
  rideIdSchema,
  supportNoteSchema,
  supportReopenSchema,
  supportResolveSchema,
  supportVersionSchema,
} from "../../shared/contracts";
import { asCurrency } from "../../shared/currency";
import { type DisputeRow, syncDisputesForIntent } from "../disputes";
import { entryView, type EntryRow, reconcileRide } from "../earnings";
import { ApiError, notFound } from "../errors";
import { type Deps, parseInput, readJson } from "../http";
import { deliverPending, enqueueNotification } from "../notifications";
import { NOTIFY } from "../notificationText";
import {
  audit,
  type OperatorRow,
  permissionsOf,
  requireOperator,
} from "../operators";
import { paymentMode } from "../paymentMode";
import { pinBlocked, pinRequired } from "../pin";
import {
  applyRefundSnapshot,
  createOperatorRefund,
  fareHasOpenDispute,
  inFlightCents,
  refundableSummary,
  syncRefundsForIntent,
} from "../refunds";
import { settlementState, withLockedRide } from "../rides";
import { notifySupport } from "../support";
import {
  attachmentAccessForOperator,
  attachmentsOf,
} from "../supportAttachments";
import {
  applyTipRefundSnapshot,
  createTipRefund,
  syncTipRefundsForIntent,
  tipHasOpenDispute,
  tipInFlightCents,
  tipRefundableSummary,
  type TipRefundRow,
} from "../tipRefunds";

import type { TipStatus } from "../../shared/contracts";
import type { RideRow } from "../lifecycle";

export const stripeMode = (): OperatorMe["stripeMode"] => {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (key.startsWith("sk_test_")) return "test";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  return "unconfigured";
};

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
const maskAccount = (clerkId: string) => `user_…${clerkId.slice(-4)}`;
const query = (request: Request) =>
  Object.fromEntries(new URL(request.url).searchParams);

export function encodeCursor(at: Date | string, id: string) {
  return Buffer.from(JSON.stringify([new Date(at).toISOString(), id])).toString(
    "base64url",
  );
}

export function decodeCursor(cursor?: string): [string, string] | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      !Number.isNaN(Date.parse(value[0])) &&
      /^[0-9a-f-]{36}$/i.test(value[1])
    ) {
      return [value[0], value[1]];
    }
  } catch {
    return badCursor();
  }
  return badCursor();
}

function badCursor(): never {
  throw new ApiError(
    400,
    "INVALID_CURSOR",
    "That page link is no longer valid.",
  );
}

function page<T>(
  rows: T[],
  limit: number,
  key: (row: T) => [Date | string, string],
) {
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: more && last ? encodeCursor(...key(last)) : null,
  };
}

export async function adminMe(request: Request, _params: unknown, deps: Deps) {
  const operator = await requireOperator(request, deps, "view");
  const body: OperatorMe = {
    id: operator.id,
    displayName: operator.display_name,
    permissions: permissionsOf(operator),
    stripeMode: stripeMode(),
    paymentMode: paymentMode(),
  };
  return Response.json({ data: body });
}

const REVIEW_CATEGORY_SQL = `
  CASE WHEN r.needs_review AND r.review_resolved_at IS NULL
       THEN COALESCE(r.review_reason, 'settlement_failing')
       ELSE 'settlement_retrying' END`;

export async function listReview(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  await requireOperator(request, deps, "view");
  const q = parseInput(adminReviewQuerySchema, query(request));
  const cursor = decodeCursor(q.cursor);
  const { rows } = await deps.db.query<RideRow & { category: ReviewCategory }>(
    `SELECT r.*, ${REVIEW_CATEGORY_SQL} AS category
       FROM mobility.rides r
      WHERE ((r.needs_review AND r.review_resolved_at IS NULL)
             OR (r.settled_at IS NULL AND r.settlement_attempts > 0
                 AND r.status IN ('completed', 'cancelled', 'no_driver', 'interrupted')))
        AND ($1::text IS NULL OR ${REVIEW_CATEGORY_SQL} = $1::text)
        AND ($2::timestamptz IS NULL OR r.updated_at >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR r.updated_at < $3::timestamptz)
        AND ($4::timestamptz IS NULL OR (r.updated_at, r.id) < ($4::timestamptz, $5::uuid))
      ORDER BY r.updated_at DESC, r.id DESC
      LIMIT $6`,
    [
      q.category ?? null,
      q.from ?? null,
      q.to ?? null,
      cursor?.[0] ?? null,
      cursor?.[1] ?? null,
      q.limit + 1,
    ],
  );
  const result = page(rows, q.limit, (r) => [r.updated_at, r.id]);
  const body: Page<ReviewItem> = {
    nextCursor: result.nextCursor,
    items: result.items.map((r) => ({
      rideId: r.id,
      category: r.category,
      status: r.status,
      paymentStatus: r.payment_status,
      fareCents: r.fare_cents,
      capturedCents: r.captured_cents,
      settlementAttempts: r.settlement_attempts,
      settlementError: r.settlement_error,
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
    })),
  };
  return Response.json({ data: body });
}

export async function resolveReview(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const rideId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "support", {
    type: "ride",
    id: rideId,
    action: "review_resolve",
  });
  const { note } = await readJson(request, reviewResolveSchema);
  const { rows } = await deps.db.query<{ id: string }>(
    `UPDATE mobility.rides
        SET review_resolved_at = now(), review_resolved_by = $2, review_note = $3,
            updated_at = now()
      WHERE id = $1 AND needs_review AND review_resolved_at IS NULL
      RETURNING id`,
    [rideId, operator.id, note],
  );
  await audit(deps.db, {
    operator,
    action: "review_resolve",
    targetType: "ride",
    targetId: rideId,
    reason: note,
    result: rows[0] ? "succeeded" : "failed",
    detail: rows[0] ? {} : { error: "not_open" },
  });
  if (!rows[0]) {
    throw new ApiError(
      409,
      "ALREADY_RESOLVED",
      "This review item is already resolved or doesn't need review.",
    );
  }
  return Response.json({ data: { rideId, resolved: true } });
}

export async function waiveRidePin(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const rideId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "support", {
    type: "ride",
    id: rideId,
    action: "pin_waive",
  });
  const { reason } = await readJson(request, pinWaiverSchema);
  const now = deps.now();
  const outcome = await withLockedRide(deps, rideId, async (tx, ride) => {
    if (ride.status !== "arrived") return "NOT_AT_PICKUP" as const;
    if (!ride.pin_nonce) return "PIN_NOT_REQUIRED" as const;
    if (ride.pin_waived_at) return "ALREADY" as const;
    await tx.query(
      `UPDATE mobility.rides
          SET pin_waived_at = $2, pin_waived_by = $3, version = version + 1, updated_at = now()
        WHERE id = $1`,
      [rideId, now, operator.id],
    );
    await tx.query(
      `INSERT INTO mobility.ride_events
         (ride_id, from_status, to_status, actor, actor_user_id, reason, created_at)
       VALUES ($1, 'arrived', 'arrived', 'operator', $2, 'pin_waived', $3)`,
      [rideId, operator.user_id, now],
    );
    await enqueueNotification(
      tx,
      {
        userId: ride.user_id,
        rideId,
        kind: "pin_waived",
        dedupeKey: `ride:${rideId}:pin_waived:${ride.rematch_count}`,
        ...NOTIFY.pinWaived(),
        target: `/ride/${rideId}`,
      },
      now,
    );
    return "WAIVED" as const;
  });
  const failed = outcome === "NOT_AT_PICKUP" || outcome === "PIN_NOT_REQUIRED";
  await audit(deps.db, {
    operator,
    action: "pin_waive",
    targetType: "ride",
    targetId: rideId,
    reason,
    result: failed ? "failed" : "succeeded",
    detail: failed ? { error: outcome } : { repeated: outcome === "ALREADY" },
  });
  if (outcome === "NOT_AT_PICKUP") {
    throw new ApiError(
      409,
      outcome,
      "The PIN can only be waived while the driver is waiting at the pickup.",
    );
  }
  if (outcome === "PIN_NOT_REQUIRED") {
    throw new ApiError(409, outcome, "This ride doesn't require a trip PIN.");
  }
  return Response.json({ data: { rideId, waived: true } });
}

export async function searchRides(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  await requireOperator(request, deps, "view");
  const q = parseInput(adminRideQuerySchema, query(request));
  const cursor = decodeCursor(q.cursor);
  const { rows } = await deps.db.query<RideRow>(
    `SELECT r.* FROM mobility.rides r
      WHERE ($1::uuid IS NULL OR r.id = $1::uuid)
        AND ($2::text IS NULL OR r.status = $2::text)
        AND ($3::text IS NULL OR r.payment_status = $3::text)
        AND ($4::timestamptz IS NULL OR r.created_at >= $4::timestamptz)
        AND ($5::timestamptz IS NULL OR r.created_at < $5::timestamptz)
        AND ($6::timestamptz IS NULL OR (r.created_at, r.id) < ($6::timestamptz, $7::uuid))
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $8`,
    [
      q.rideId ?? null,
      q.status ?? null,
      q.paymentStatus ?? null,
      q.from ?? null,
      q.to ?? null,
      cursor?.[0] ?? null,
      cursor?.[1] ?? null,
      q.limit + 1,
    ],
  );
  const result = page(rows, q.limit, (r) => [r.created_at, r.id]);
  const body: Page<AdminRideListItem> = {
    nextCursor: result.nextCursor,
    items: result.items.map((r) => ({
      rideId: r.id,
      status: r.status,
      paymentStatus: r.payment_status,
      fareCents: r.fare_cents,
      capturedCents: r.captured_cents,
      refundedCents: r.refunded_cents,
      needsReview: r.needs_review && !r.review_resolved_at,
      createdAt: iso(r.created_at)!,
      pickupAddress: r.origin_address,
      destinationAddress: r.destination_address,
    })),
  };
  return Response.json({ data: body });
}

export async function rideDetail(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const rideId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "view", {
    type: "ride",
    id: rideId,
    action: "ride_view",
  });
  const { rows } = await deps.db.query<
    RideRow & {
      passenger_name: string | null;
      passenger_clerk_id: string;
      driver_name: string | null;
      vehicle_make: string | null;
      vehicle_model: string | null;
      vehicle_plate: string | null;
      review_resolver: string | null;
      pin_waiver: string | null;
      from_schedule: boolean;
    }
  >(
    `SELECT r.*, COALESCE(r.passenger_name, u.name) AS passenger_name, u.clerk_id AS passenger_clerk_id,
            dp.display_name AS driver_name, dp.vehicle_make, dp.vehicle_model, dp.vehicle_plate,
            o.display_name AS review_resolver, po.display_name AS pin_waiver,
            EXISTS (SELECT 1 FROM mobility.scheduled_rides s WHERE s.ride_id = r.id) AS from_schedule
       FROM mobility.rides r
       JOIN mobility.users u ON u.id = r.user_id
       LEFT JOIN mobility.driver_profiles dp ON dp.id = r.driver_profile_id
       LEFT JOIN mobility.operators o ON o.id = r.review_resolved_by
       LEFT JOIN mobility.operators po ON po.id = r.pin_waived_by
      WHERE r.id = $1`,
    [rideId],
  );
  const r = rows[0];
  if (!r) throw notFound("Ride");

  const [
    events,
    offers,
    ledger,
    notifications,
    refunds,
    support,
    auditRows,
    ratings,
    earning,
    entries,
    tips,
    reconciliation,
  ] = await Promise.all([
    deps.db.query<{
      from_status: string;
      to_status: string;
      actor: string;
      reason: string | null;
      created_at: Date;
    }>(
      "SELECT from_status, to_status, actor, reason, created_at FROM mobility.ride_events WHERE ride_id = $1 ORDER BY id",
      [rideId],
    ),
    deps.db.query<{
      driver_name: string;
      status: string;
      distance_meters: number;
      created_at: Date;
      expires_at: Date;
      responded_at: Date | null;
    }>(
      `SELECT dp.display_name AS driver_name, o.status, o.distance_meters,
                o.created_at, o.expires_at, o.responded_at
           FROM mobility.ride_offers o
           JOIN mobility.driver_profiles dp ON dp.id = o.driver_profile_id
          WHERE o.ride_id = $1 ORDER BY o.created_at`,
      [rideId],
    ),
    deps.db.query<{
      kind: string;
      amount_cents: number | null;
      actor: string;
      detail: string | null;
      created_at: Date;
    }>(
      "SELECT kind, amount_cents, actor, detail, created_at FROM mobility.payment_events WHERE ride_id = $1 ORDER BY id",
      [rideId],
    ),
    deps.db.query<{
      kind: string;
      user_id: string;
      status: string;
      attempts: number;
      last_error: string | null;
      created_at: Date;
      sent_at: Date | null;
    }>(
      "SELECT kind, user_id, status, attempts, last_error, created_at, sent_at FROM mobility.notifications WHERE ride_id = $1 ORDER BY id",
      [rideId],
    ),
    deps.db.query<{
      id: string;
      amount_cents: number;
      status: string;
      reason: string;
      operator: string;
      operator_id: string | null;
      operator_name: string | null;
      source: "operator" | "stripe";
      stripe_refund_id: string | null;
      last_error: string | null;
      support_request_id: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT f.*, o.display_name AS operator_name FROM mobility.refunds f
           LEFT JOIN mobility.operators o ON o.id = f.operator_id
          WHERE f.ride_id = $1 ORDER BY f.created_at`,
      [rideId],
    ),
    deps.db.query<{
      id: string;
      status: string;
      category: string;
      created_at: Date;
    }>(
      "SELECT id, status, category, created_at FROM mobility.support_requests WHERE ride_id = $1 ORDER BY created_at",
      [rideId],
    ),
    deps.db.query<{
      action: string;
      actor: string;
      result: string;
      reason: string | null;
      created_at: Date;
    }>(
      `SELECT action, actor, result, reason, created_at FROM mobility.audit_log
          WHERE target_type = 'ride' AND target_id = $1 AND action <> 'ride_view'
          ORDER BY id DESC LIMIT 50`,
      [rideId],
    ),
    deps.db.query<FeedbackRow>(
      `${FEEDBACK_SQL} WHERE g.ride_id = $1 ORDER BY g.created_at`,
      [rideId],
    ),
    deps.db.query<{
      driver_name: string;
      fare_cents: number;
      commission_rate_bps: number;
      commission_cents: number;
      driver_share_cents: number;
      commission_policy_version: string;
      earned_at: Date;
    }>(
      `SELECT re.*, dp.display_name AS driver_name FROM mobility.ride_earnings re
         JOIN mobility.driver_profiles dp ON dp.id = re.driver_profile_id
        WHERE re.ride_id = $1`,
      [rideId],
    ),
    deps.db.query<EntryRow>(
      "SELECT * FROM mobility.earning_entries WHERE ride_id = $1 ORDER BY id",
      [rideId],
    ),
    deps.db.query<{
      id: string;
      amount_cents: number;
      status: TipStatus;
      refunded_cents: number;
      stripe_payment_intent_id: string | null;
      last_error: string | null;
      created_at: Date;
      paid_at: Date | null;
    }>(
      `SELECT id, amount_cents, status, refunded_cents, stripe_payment_intent_id,
              last_error, created_at, paid_at
         FROM mobility.tips WHERE ride_id = $1
        ORDER BY (status = 'canceled'), created_at DESC LIMIT 1`,
      [rideId],
    ),
    reconcileRide(deps.db, rideId),
  ]);
  const tip = tips.rows[0] ?? null;
  const [tipRefundRows, disputeRows, fareDisputed] = await Promise.all([
    deps.db.query<TipRefundRow & { operator_name: string | null }>(
      `SELECT f.*, o.display_name AS operator_name FROM mobility.tip_refunds f
         LEFT JOIN mobility.operators o ON o.id = f.operator_id
        WHERE f.ride_id = $1 ORDER BY f.created_at`,
      [rideId],
    ),
    deps.db.query<DisputeRow>(
      "SELECT * FROM mobility.disputes WHERE ride_id = $1 ORDER BY created_at",
      [rideId],
    ),
    fareHasOpenDispute(deps.db, rideId),
  ]);
  const tipRefundable = tip
    ? tipRefundableSummary(
        tip,
        await tipInFlightCents(deps.db, tip.id),
        await tipHasOpenDispute(deps.db, tip.id),
      )
    : null;

  const body: AdminRideDetail = {
    ride: {
      id: r.id,
      status: r.status,
      paymentStatus: r.payment_status,
      fareCents: r.fare_cents,
      capturedCents: r.captured_cents,
      refundedCents: r.refunded_cents,
      currency: asCurrency(r.currency),
      pickupAddress: r.origin_address,
      destinationAddress: r.destination_address,
      paymentMethod: r.payment_method,
      collection:
        r.payment_method === "in_vehicle" && r.collection_status
          ? {
              status: r.collection_status,
              method: r.collection_method,
              recordedBy: r.collection_recorded_by,
              note: r.collection_note,
              collectedAt: iso(r.collected_at),
              canRecord:
                r.collection_status === "pending" ||
                r.collection_status === "unpaid",
            }
          : null,
      stopAddresses: r.stops.map((stop) => stop.address),
      stopsCompleted: r.stops_completed,
      categoryName: r.vehicle_category_name,
      passengerCount: r.passenger_count,
      fromScheduledRequest: r.from_schedule,
      createdAt: iso(r.created_at)!,
      requestedAt: iso(r.requested_at),
      completedAt: iso(r.completed_at),
      endedAt: iso(r.completed_at ?? r.interrupted_at ?? r.cancelled_at),
      cancelledBy: r.cancelled_by,
      cancelReason: r.cancel_reason,
      rematchCount: r.rematch_count,
      stripePaymentIntentId: r.stripe_payment_intent_id,
      isLegacyDemo: r.status === "legacy",
    },
    passenger: {
      name: r.passenger_name,
      account: maskAccount(r.passenger_clerk_id),
    },
    driver:
      r.driver_profile_id && r.driver_name
        ? {
            name: r.driver_name,
            vehicle: `${r.vehicle_make} ${r.vehicle_model}`,
            plate: r.vehicle_plate ?? "",
          }
        : null,
    settlement: {
      state: settlementState(r),
      attempts: r.settlement_attempts,
      lastError: r.settlement_error,
      nextAttemptAt: iso(r.next_settlement_at),
      settledAt: iso(r.settled_at),
      authorizationExpiresAt: iso(r.authorization_expires_at),
    },
    review: {
      open: r.needs_review && !r.review_resolved_at,
      reason: r.review_reason,
      resolvedAt: iso(r.review_resolved_at),
      resolvedBy: r.review_resolver,
      note: r.review_note,
    },
    pin: {
      required: pinRequired(r) && r.pin_verified_at === null,
      verifiedAt: iso(r.pin_verified_at),
      waivedAt: iso(r.pin_waived_at),
      waivedBy: r.pin_waiver,
      failedAttempts: r.pin_failed_attempts,
      lockouts: r.pin_lockouts,
      blocked: pinRequired(r) && pinBlocked(r),
      canWaive: r.status === "arrived" && pinRequired(r),
    },
    events: events.rows.map((e) => ({
      fromStatus: e.from_status,
      toStatus: e.to_status,
      actor: e.actor,
      reason: e.reason,
      createdAt: iso(e.created_at)!,
    })),
    offers: offers.rows.map((o) => ({
      driverName: o.driver_name,
      status: o.status,
      distanceMeters: o.distance_meters,
      createdAt: iso(o.created_at)!,
      expiresAt: iso(o.expires_at)!,
      respondedAt: iso(o.responded_at),
    })),
    ledger: ledger.rows.map((l) => ({
      kind: l.kind,
      amountCents: l.amount_cents,
      actor: l.actor,
      detail: l.detail,
      createdAt: iso(l.created_at)!,
    })),
    notifications: notifications.rows.map((n) => ({
      kind: n.kind,
      recipient: n.user_id === r.user_id ? "passenger" : "driver",
      status: n.status,
      attempts: n.attempts,
      lastError: n.last_error,
      createdAt: iso(n.created_at)!,
      sentAt: iso(n.sent_at),
    })),
    refunds: refunds.rows.map((f) => ({
      id: f.id,
      amountCents: f.amount_cents,
      status: f.status,
      reason: f.reason,
      operatorName:
        f.source === "stripe"
          ? "Stripe (outside the app)"
          : (f.operator_name ?? f.operator),
      verifiedOperator: f.operator_id !== null,
      source: f.source,
      stripeRefundId: f.stripe_refund_id,
      lastError: f.last_error,
      supportRequestId: f.support_request_id,
      createdAt: iso(f.created_at)!,
      updatedAt: iso(f.updated_at)!,
    })),
    refundable: refundableSummary(
      r,
      await inFlightCents(deps.db, rideId),
      fareDisputed,
    ),
    support: support.rows.map((s) => ({
      id: s.id,
      status: s.status as AdminSupportItem["status"],
      category: s.category,
      createdAt: iso(s.created_at)!,
    })),
    ratings: ratings.rows.map(feedbackItem),
    earnings: {
      record: earning.rows[0]
        ? {
            driverName: earning.rows[0].driver_name,
            fareCents: earning.rows[0].fare_cents,
            commissionRateBps: earning.rows[0].commission_rate_bps,
            commissionCents: earning.rows[0].commission_cents,
            driverShareCents: earning.rows[0].driver_share_cents,
            policyVersion: earning.rows[0].commission_policy_version,
            earnedAt: iso(earning.rows[0].earned_at)!,
          }
        : null,
      entries: entries.rows.map(entryView),
      tip: tips.rows[0]
        ? {
            id: tips.rows[0].id,
            amountCents: tips.rows[0].amount_cents,
            status: tips.rows[0].status,
            refundedCents: tips.rows[0].refunded_cents,
            stripePaymentIntentId: tips.rows[0].stripe_payment_intent_id,
            lastError: tips.rows[0].last_error,
            createdAt: iso(tips.rows[0].created_at)!,
            paidAt: iso(tips.rows[0].paid_at),
          }
        : null,
      tipRefunds: tipRefundRows.rows.map(tipRefundView),
      tipRefundable,
      disputes: disputeRows.rows.map(disputeView),
      reconciliation,
    },
    audit: auditRows.rows.map((a) => ({
      action: a.action,
      actor: a.actor,
      result: a.result,
      reason: a.reason,
      createdAt: iso(a.created_at)!,
    })),
  };
  await audit(deps.db, {
    operator,
    action: "ride_view",
    targetType: "ride",
    targetId: rideId,
    result: "succeeded",
  });
  return Response.json({ data: body });
}

export async function createRefund(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const rideId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "refund", {
    type: "ride",
    id: rideId,
    action: "refund_create",
  });
  const input = await readJson(request, adminRefundSchema);
  if (stripeMode() !== "test") {
    await audit(deps.db, {
      operator,
      action: "refund_create",
      targetType: "ride",
      targetId: rideId,
      reason: input.reason,
      result: "denied",
      detail: { error: "live_refunds_disabled" },
    });
    throw new ApiError(
      503,
      "LIVE_REFUNDS_DISABLED",
      "Refunds from the console are limited to Stripe test mode in this version.",
    );
  }
  try {
    const result = await createOperatorRefund(deps, {
      rideId,
      ...input,
      operator,
    });
    await audit(deps.db, {
      operator,
      action: "refund_create",
      targetType: "ride",
      targetId: rideId,
      reason: input.reason,
      result:
        result.refund.status === "succeeded"
          ? "succeeded"
          : result.refund.status === "failed" ||
              result.refund.status === "canceled"
            ? "failed"
            : "pending",
      detail: {
        refundId: result.refund.id,
        amountCents: result.refund.amount_cents,
        stripeStatus: result.refund.status,
        outcome: result.outcome,
        supportRequestId: input.supportRequestId ?? null,
      },
    });
    return Response.json(
      {
        data: {
          refundId: result.refund.id,
          status: result.refund.status,
          amountCents: result.refund.amount_cents,
          duplicate: !result.created,
          stripeReachable: result.outcome !== "unknown",
        },
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    await audit(deps.db, {
      operator,
      action: "refund_create",
      targetType: "ride",
      targetId: rideId,
      reason: input.reason,
      result: "failed",
      detail: {
        amountCents: input.amountCents,
        error: error instanceof ApiError ? error.code : "internal_error",
      },
    });
    if (
      (error as { code?: string })?.code === "23505" &&
      (error as { constraint?: string })?.constraint ===
        "refunds_one_in_flight_per_ride"
    ) {
      throw new ApiError(
        409,
        "REFUND_IN_PROGRESS",
        "Another refund for this ride is still in progress.",
      );
    }
    throw error;
  }
}

export async function syncRefund(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const refundId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "refund", {
    type: "refund",
    id: refundId,
    action: "refund_sync",
  });
  const { rows } = await deps.db.query<{
    stripe_refund_id: string | null;
    ride_id: string;
  }>("SELECT stripe_refund_id, ride_id FROM mobility.refunds WHERE id = $1", [
    refundId,
  ]);
  if (!rows[0]) throw notFound("Refund");
  if (rows[0].stripe_refund_id) {
    await applyRefundSnapshot(
      deps.db,
      await deps.payments.retrieveRefund(rows[0].stripe_refund_id),
      deps.now(),
    );
  }
  const { rows: after } = await deps.db.query<{ status: string }>(
    "SELECT status FROM mobility.refunds WHERE id = $1",
    [refundId],
  );
  await audit(deps.db, {
    operator,
    action: "refund_sync",
    targetType: "ride",
    targetId: rows[0].ride_id,
    result: "succeeded",
    detail: { refundId, stripeStatus: after[0].status },
  });
  return Response.json({ data: { refundId, status: after[0].status } });
}

interface SupportRow {
  id: string;
  ride_id: string | null;
  requester_role: "passenger" | "driver";
  user_id: string;
  category: string;
  message: string;
  status: AdminSupportItem["status"];
  version: number;
  assigned_operator_id: string | null;
  assigned_name: string | null;
  resolved_by_name: string | null;
  resolution_message: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
  passenger_name: string | null;
  passenger_clerk_id: string;
}

const SUPPORT_SQL = `
  SELECT s.*, ao.display_name AS assigned_name, ro.display_name AS resolved_by_name,
         COALESCE(sdp.display_name, u.name) AS passenger_name,
         u.clerk_id AS passenger_clerk_id
    FROM mobility.support_requests s
    JOIN mobility.users u ON u.id = s.user_id
    LEFT JOIN mobility.driver_profiles sdp ON sdp.id = s.driver_profile_id
    LEFT JOIN mobility.operators ao ON ao.id = s.assigned_operator_id
    LEFT JOIN mobility.operators ro ON ro.id = s.resolved_by`;

const supportItem = (
  s: SupportRow,
  operator: OperatorRow,
): AdminSupportItem => ({
  id: s.id,
  rideId: s.ride_id,
  role: s.requester_role,
  category: s.category,
  status: s.status,
  version: s.version,
  assignedTo: s.assigned_name,
  assignedToMe: s.assigned_operator_id === operator.id,
  preview: s.message.slice(0, 120),
  createdAt: iso(s.created_at)!,
  updatedAt: iso(s.updated_at)!,
  resolvedAt: iso(s.resolved_at),
});

export async function listSupport(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const operator = await requireOperator(request, deps, "view");
  const q = parseInput(adminSupportQuerySchema, query(request));
  const cursor = decodeCursor(q.cursor);
  const { rows } = await deps.db.query<SupportRow>(
    `${SUPPORT_SQL}
      WHERE ($1::text IS NULL OR s.status = $1::text)
        AND ($2::text = 'any'
             OR ($2::text = 'me' AND s.assigned_operator_id = $3::uuid)
             OR ($2::text = 'unassigned' AND s.assigned_operator_id IS NULL))
        AND ($4::uuid IS NULL OR s.ride_id = $4::uuid)
        AND ($5::timestamptz IS NULL OR s.created_at >= $5::timestamptz)
        AND ($6::timestamptz IS NULL OR s.created_at < $6::timestamptz)
        AND ($7::timestamptz IS NULL OR (s.created_at, s.id) < ($7::timestamptz, $8::uuid))
        AND ($10::text IS NULL OR s.requester_role = $10::text)
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $9`,
    [
      q.status ?? null,
      q.assigned,
      operator.id,
      q.rideId ?? null,
      q.from ?? null,
      q.to ?? null,
      cursor?.[0] ?? null,
      cursor?.[1] ?? null,
      q.limit + 1,
      q.role ?? null,
    ],
  );
  const result = page(rows, q.limit, (s) => [s.created_at, s.id]);
  const body: Page<AdminSupportItem> = {
    nextCursor: result.nextCursor,
    items: result.items.map((s) => supportItem(s, operator)),
  };
  return Response.json({ data: body });
}

async function loadSupport(deps: Deps, id: string) {
  const { rows } = await deps.db.query<SupportRow>(
    `${SUPPORT_SQL} WHERE s.id = $1`,
    [id],
  );
  if (!rows[0]) throw notFound("Support request");
  return rows[0];
}

async function supportDetailBody(
  deps: Deps,
  id: string,
  operator: OperatorRow,
): Promise<AdminSupportDetail> {
  const s = await loadSupport(deps, id);
  const [notes, history] = await Promise.all([
    deps.db.query<{ author: string; note: string; created_at: Date }>(
      `SELECT o.display_name AS author, n.note, n.created_at
         FROM mobility.support_notes n JOIN mobility.operators o ON o.id = n.operator_id
        WHERE n.support_request_id = $1 ORDER BY n.id`,
      [id],
    ),
    deps.db.query<{
      action: string;
      operator: string | null;
      from_status: string | null;
      to_status: string | null;
      created_at: Date;
    }>(
      `SELECT e.action, o.display_name AS operator, e.from_status, e.to_status, e.created_at
         FROM mobility.support_events e LEFT JOIN mobility.operators o ON o.id = e.operator_id
        WHERE e.support_request_id = $1 ORDER BY e.id`,
      [id],
    ),
  ]);
  const files = await attachmentsOf(deps.db, id);
  return {
    ...supportItem(s, operator),
    message: s.message,
    passenger: {
      name: s.passenger_name,
      account: maskAccount(s.passenger_clerk_id),
    },
    attachments: files.all,
    resolutionMessage: s.resolution_message,
    resolvedBy: s.resolved_by_name,
    notes: notes.rows.map((n) => ({
      author: n.author,
      note: n.note,
      createdAt: iso(n.created_at)!,
    })),
    history: history.rows.map((h) => ({
      action: h.action,
      operator: h.operator,
      fromStatus: h.from_status,
      toStatus: h.to_status,
      createdAt: iso(h.created_at)!,
    })),
  };
}

export async function supportDetail(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const id = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "view", {
    type: "support_request",
    id,
    action: "support_view",
  });
  return Response.json({ data: await supportDetailBody(deps, id, operator) });
}

async function supportChange(
  deps: Deps,
  operator: OperatorRow,
  id: string,
  action: "assigned" | "resolved" | "reopened",
  sql: string,
  values: unknown[],
  reason: string | null,
) {
  const before = await loadSupport(deps, id);
  const { rows } = await deps.db.query<{ status: string }>(sql, values);
  if (!rows[0]) {
    const current = await loadSupport(deps, id);
    const code =
      action === "resolved" && current.status === "resolved"
        ? "ALREADY_RESOLVED"
        : action === "resolved" && current.assigned_operator_id !== operator.id
          ? "NOT_ASSIGNED_TO_YOU"
          : action === "assigned" &&
              current.assigned_operator_id &&
              current.assigned_operator_id !== operator.id
            ? "ASSIGNED_TO_OTHER"
            : "VERSION_CONFLICT";
    await audit(deps.db, {
      operator,
      action: `support_${action === "assigned" ? "assign" : action === "resolved" ? "resolve" : "reopen"}`,
      targetType: "support_request",
      targetId: id,
      reason,
      result: "failed",
      detail: {
        error: code,
        currentStatus: current.status,
        currentVersion: current.version,
      },
    });
    throw new ApiError(
      409,
      code,
      code === "ALREADY_RESOLVED"
        ? "Another operator already resolved this request."
        : code === "NOT_ASSIGNED_TO_YOU"
          ? "Assign this request to yourself before resolving it."
          : code === "ASSIGNED_TO_OTHER"
            ? `This request is assigned to ${current.assigned_name}.`
            : "This request changed since you opened it. Reload and try again.",
    );
  }
  await deps.db.query(
    `INSERT INTO mobility.support_events (support_request_id, operator_id, action, from_status, to_status)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, operator.id, action, before.status, rows[0].status],
  );
  await audit(deps.db, {
    operator,
    action: `support_${action === "assigned" ? "assign" : action === "resolved" ? "resolve" : "reopen"}`,
    targetType: "support_request",
    targetId: id,
    reason,
    result: "succeeded",
    detail: { fromStatus: before.status, toStatus: rows[0].status },
  });
  if (before.status !== rows[0].status) {
    await notifySupport(
      deps.db,
      id,
      action === "assigned"
        ? "in_progress"
        : action === "resolved"
          ? "resolved"
          : "reopened",
      String(before.version + 1),
      deps.now(),
    );
    await deliverPending(deps).catch(() => undefined);
  }
  return Response.json({ data: await supportDetailBody(deps, id, operator) });
}

export async function assignSupport(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const id = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "support", {
    type: "support_request",
    id,
    action: "support_assign",
  });
  const { expectedVersion } = await readJson(request, supportVersionSchema);
  return supportChange(
    deps,
    operator,
    id,
    "assigned",
    `UPDATE mobility.support_requests
        SET assigned_operator_id = $2,
            status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
            version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $3 AND status <> 'resolved'
        AND (assigned_operator_id IS NULL OR assigned_operator_id = $2)
      RETURNING status`,
    [id, operator.id, expectedVersion],
    null,
  );
}

export async function resolveSupport(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const id = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "support", {
    type: "support_request",
    id,
    action: "support_resolve",
  });
  const { expectedVersion, resolutionMessage } = await readJson(
    request,
    supportResolveSchema,
  );
  return supportChange(
    deps,
    operator,
    id,
    "resolved",
    `UPDATE mobility.support_requests
        SET status = 'resolved', resolved_at = now(), resolved_by = $2,
            resolution_message = $4, version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $3 AND status <> 'resolved'
        AND assigned_operator_id = $2
      RETURNING status`,
    [id, operator.id, expectedVersion, resolutionMessage],
    resolutionMessage,
  );
}

export async function reopenSupport(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const id = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "support", {
    type: "support_request",
    id,
    action: "support_reopen",
  });
  const { expectedVersion, reason } = await readJson(
    request,
    supportReopenSchema,
  );
  return supportChange(
    deps,
    operator,
    id,
    "reopened",
    `UPDATE mobility.support_requests
        SET status = 'open', resolved_at = NULL, resolved_by = NULL,
            assigned_operator_id = NULL, version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $2 AND status = 'resolved'
      RETURNING status`,
    [id, expectedVersion],
    reason,
  );
}

export async function addSupportNote(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const id = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "support", {
    type: "support_request",
    id,
    action: "support_note",
  });
  const { note } = await readJson(request, supportNoteSchema);
  await loadSupport(deps, id);
  await deps.db.query(
    "INSERT INTO mobility.support_notes (support_request_id, operator_id, note) VALUES ($1, $2, $3)",
    [id, operator.id, note],
  );
  await deps.db.query(
    `INSERT INTO mobility.support_events (support_request_id, operator_id, action)
     VALUES ($1, $2, 'note_added')`,
    [id, operator.id],
  );
  await deps.db.query(
    "UPDATE mobility.support_requests SET updated_at = now() WHERE id = $1",
    [id],
  );
  await audit(deps.db, {
    operator,
    action: "support_note",
    targetType: "support_request",
    targetId: id,
    result: "succeeded",
    detail: { length: note.length },
  });
  return Response.json(
    { data: await supportDetailBody(deps, id, operator) },
    { status: 201 },
  );
}

export async function supportAttachmentAccess(
  request: Request,
  params: { id?: string; attachmentId?: string },
  deps: Deps,
) {
  const id = parseInput(rideIdSchema, params.id);
  const attachmentId = parseInput(rideIdSchema, params.attachmentId);
  const operator = await requireOperator(request, deps, "support", {
    type: "support_request",
    id,
    action: "support_attachment_access",
  });
  return Response.json({
    data: await attachmentAccessForOperator(deps, operator, id, attachmentId),
  });
}

interface FeedbackRow {
  id: string;
  ride_id: string;
  rater_role: "passenger" | "driver";
  stars: number;
  comment: string | null;
  moderation_status: AdminFeedbackItem["status"];
  moderation_note: string | null;
  moderated_at: Date | null;
  version: number;
  edit_count: number;
  created_at: Date;
  updated_at: Date;
  rater_name: string | null;
  rater_clerk_id: string;
  ratee_name: string | null;
  ratee_clerk_id: string;
  moderator_name: string | null;
}

const FEEDBACK_SQL = `
  SELECT g.*, ru.name AS rater_name, ru.clerk_id AS rater_clerk_id,
         eu.name AS ratee_name, eu.clerk_id AS ratee_clerk_id,
         o.display_name AS moderator_name
    FROM mobility.ratings g
    JOIN mobility.users ru ON ru.id = g.rater_user_id
    JOIN mobility.users eu ON eu.id = g.ratee_user_id
    LEFT JOIN mobility.operators o ON o.id = g.moderated_by`;

function feedbackItem(g: FeedbackRow): AdminFeedbackItem {
  return {
    id: g.id,
    rideId: g.ride_id,
    raterRole: g.rater_role,
    rater: { name: g.rater_name, account: maskAccount(g.rater_clerk_id) },
    ratee: { name: g.ratee_name, account: maskAccount(g.ratee_clerk_id) },
    stars: g.stars,
    comment: g.comment,
    status: g.moderation_status,
    version: g.version,
    editCount: g.edit_count,
    moderationNote: g.moderation_note,
    moderatedBy: g.moderator_name,
    moderatedAt: iso(g.moderated_at),
    createdAt: iso(g.created_at)!,
    updatedAt: iso(g.updated_at)!,
  };
}

export async function listFeedback(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  await requireOperator(request, deps, "view");
  const q = parseInput(adminFeedbackQuerySchema, query(request));
  const cursor = decodeCursor(q.cursor);
  const { rows } = await deps.db.query<FeedbackRow>(
    `${FEEDBACK_SQL}
      WHERE ($1::text = 'all' OR g.moderation_status = $1::text)
        AND ($2::uuid IS NULL OR g.ride_id = $2::uuid)
        AND ($3::timestamptz IS NULL OR g.created_at >= $3::timestamptz)
        AND ($4::timestamptz IS NULL OR g.created_at < $4::timestamptz)
        AND ($5::timestamptz IS NULL OR (g.created_at, g.id) < ($5::timestamptz, $6::uuid))
      ORDER BY g.created_at DESC, g.id DESC
      LIMIT $7`,
    [
      q.status,
      q.rideId ?? null,
      q.from ?? null,
      q.to ?? null,
      cursor?.[0] ?? null,
      cursor?.[1] ?? null,
      q.limit + 1,
    ],
  );
  const result = page(rows, q.limit, (g) => [g.created_at, g.id]);
  const body: Page<AdminFeedbackItem> = {
    nextCursor: result.nextCursor,
    items: result.items.map(feedbackItem),
  };
  return Response.json({ data: body });
}

const MODERATION = {
  reviewed: { from: ["pending"], to: "reviewed", action: "feedback_review" },
  remove: {
    from: ["none", "pending", "reviewed"],
    to: "removed",
    action: "feedback_remove",
  },
  restore: { from: ["removed"], to: "reviewed", action: "feedback_restore" },
} as const;

export async function moderateFeedback(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const id = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "support", {
    type: "rating",
    id,
    action: "feedback_moderate",
  });
  const input = await readJson(request, feedbackModerationSchema);
  const rule = MODERATION[input.action];
  const { rows } = await deps.db.query<{ ride_id: string; stars: number }>(
    `UPDATE mobility.ratings
        SET moderation_status = $2, moderated_by = $3, moderated_at = $4,
            moderation_note = $5, version = version + 1
      WHERE id = $1 AND version = $6 AND moderation_status = ANY($7::text[])
      RETURNING ride_id, stars`,
    [
      id,
      rule.to,
      operator.id,
      deps.now(),
      input.note,
      input.expectedVersion,
      rule.from,
    ],
  );
  if (!rows[0]) {
    const current = await deps.db.query<FeedbackRow>(
      `${FEEDBACK_SQL} WHERE g.id = $1`,
      [id],
    );
    if (!current.rows[0]) throw notFound("Rating");
    const code =
      current.rows[0].version !== input.expectedVersion
        ? "VERSION_CONFLICT"
        : "INVALID_MODERATION";
    await audit(deps.db, {
      operator,
      action: rule.action,
      targetType: "rating",
      targetId: id,
      reason: input.note,
      result: "failed",
      detail: { error: code, currentStatus: current.rows[0].moderation_status },
    });
    throw new ApiError(
      409,
      code,
      code === "VERSION_CONFLICT"
        ? "This feedback changed since you opened it. Reload and try again."
        : "This action doesn't apply to feedback in its current state.",
    );
  }
  await audit(deps.db, {
    operator,
    action: rule.action,
    targetType: "rating",
    targetId: id,
    reason: input.note,
    result: "succeeded",
    detail: { rideId: rows[0].ride_id, stars: rows[0].stars, status: rule.to },
  });
  const updated = await deps.db.query<FeedbackRow>(
    `${FEEDBACK_SQL} WHERE g.id = $1`,
    [id],
  );
  return Response.json({ data: feedbackItem(updated.rows[0]) });
}

function tipRefundView(
  f: TipRefundRow & { operator_name: string | null },
): AdminRefund {
  return {
    id: f.id,
    amountCents: f.amount_cents,
    status: f.status,
    reason: f.reason,
    operatorName:
      f.source === "stripe"
        ? "Stripe (outside the app)"
        : (f.operator_name ?? "unknown"),
    verifiedOperator: f.operator_id !== null,
    source: f.source,
    stripeRefundId: f.stripe_refund_id,
    lastError: f.last_error,
    supportRequestId: null,
    createdAt: iso(f.created_at)!,
    updatedAt: iso(f.updated_at)!,
  };
}

function disputeView(d: DisputeRow): AdminDispute {
  return {
    stripeDisputeId: d.stripe_dispute_id,
    subject: d.subject,
    status: d.status,
    reason: d.reason,
    amountCents: d.amount_cents,
    currency: d.currency,
    fundsWithdrawnCents: d.funds_withdrawn_cents,
    fundsReinstatedCents: d.funds_reinstated_cents,
    needsReview: d.needs_review,
    reviewNote: d.review_note,
    createdAt: iso(d.created_at)!,
    updatedAt: iso(d.updated_at)!,
    closedAt: iso(d.closed_at),
  };
}

export async function createTipRefundAction(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const tipId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "refund", {
    type: "tip",
    id: tipId,
    action: "tip_refund_create",
  });
  const input = await readJson(request, adminTipRefundSchema);
  const { rows: tips } = await deps.db.query<{ ride_id: string }>(
    "SELECT ride_id FROM mobility.tips WHERE id = $1",
    [tipId],
  );
  if (!tips[0]) throw notFound("Tip");
  const rideId = tips[0].ride_id;
  if (stripeMode() !== "test") {
    await audit(deps.db, {
      operator,
      action: "tip_refund_create",
      targetType: "ride",
      targetId: rideId,
      reason: input.reason,
      result: "denied",
      detail: { tipId, error: "live_refunds_disabled" },
    });
    throw new ApiError(
      503,
      "LIVE_REFUNDS_DISABLED",
      "Refunds from the console are limited to Stripe test mode in this version.",
    );
  }
  try {
    const result = await createTipRefund(deps, {
      tipId,
      amountCents: input.amountCents,
      reason: input.reason,
      expectedMaxRefundableCents: input.expectedMaxRefundableCents,
      idempotencyKey: input.idempotencyKey,
      operatorId: operator.id,
    });
    await audit(deps.db, {
      operator,
      action: "tip_refund_create",
      targetType: "ride",
      targetId: rideId,
      reason: input.reason,
      result:
        result.refund.status === "succeeded"
          ? "succeeded"
          : result.refund.status === "failed" ||
              result.refund.status === "canceled"
            ? "failed"
            : "pending",
      detail: {
        tipId,
        tipRefundId: result.refund.id,
        amountCents: result.refund.amount_cents,
        stripeStatus: result.refund.status,
        outcome: result.outcome,
      },
    });
    return Response.json(
      {
        data: {
          refundId: result.refund.id,
          status: result.refund.status,
          amountCents: result.refund.amount_cents,
          duplicate: !result.created,
          stripeReachable: result.outcome !== "unknown",
        },
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    await audit(deps.db, {
      operator,
      action: "tip_refund_create",
      targetType: "ride",
      targetId: rideId,
      reason: input.reason,
      result: "failed",
      detail: {
        tipId,
        amountCents: input.amountCents,
        error: error instanceof ApiError ? error.code : "internal_error",
      },
    });
    if (
      (error as { code?: string })?.code === "23505" &&
      (error as { constraint?: string })?.constraint ===
        "tip_refunds_one_in_flight"
    ) {
      throw new ApiError(
        409,
        "REFUND_IN_PROGRESS",
        "Another refund for this tip is still in progress.",
      );
    }
    throw error;
  }
}

export async function syncTipRefundAction(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const refundId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "refund", {
    type: "tip_refund",
    id: refundId,
    action: "tip_refund_sync",
  });
  const { rows } = await deps.db.query<TipRefundRow>(
    "SELECT * FROM mobility.tip_refunds WHERE id = $1",
    [refundId],
  );
  if (!rows[0]) throw notFound("Refund");
  if (rows[0].stripe_refund_id) {
    await applyTipRefundSnapshot(
      deps.db,
      await deps.payments.retrieveRefund(rows[0].stripe_refund_id),
      deps.now(),
    );
  }
  const { rows: after } = await deps.db.query<{ status: string }>(
    "SELECT status FROM mobility.tip_refunds WHERE id = $1",
    [refundId],
  );
  await audit(deps.db, {
    operator,
    action: "tip_refund_sync",
    targetType: "ride",
    targetId: rows[0].ride_id,
    result: "succeeded",
    detail: { tipRefundId: refundId, stripeStatus: after[0].status },
  });
  return Response.json({ data: { refundId, status: after[0].status } });
}

export async function syncRideFromStripe(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const rideId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "support", {
    type: "ride",
    id: rideId,
    action: "stripe_sync",
  });
  const { rows } = await deps.db.query<{
    fare_intent: string | null;
    tip_intent: string | null;
  }>(
    `SELECT r.stripe_payment_intent_id AS fare_intent,
            (SELECT t.stripe_payment_intent_id FROM mobility.tips t
              WHERE t.ride_id = r.id AND t.stripe_payment_intent_id IS NOT NULL
              ORDER BY (t.status = 'canceled'), t.created_at DESC LIMIT 1) AS tip_intent
       FROM mobility.rides r WHERE r.id = $1`,
    [rideId],
  );
  if (!rows[0]) throw notFound("Ride");
  const counts = { fareRefunds: 0, tipRefunds: 0, disputes: 0 };
  const { fare_intent: fare, tip_intent: tip } = rows[0];
  if (fare) {
    counts.fareRefunds = await syncRefundsForIntent(deps, fare);
    counts.disputes += await syncDisputesForIntent(deps, fare);
  }
  if (tip) {
    counts.tipRefunds = await syncTipRefundsForIntent(deps, tip);
    counts.disputes += await syncDisputesForIntent(deps, tip);
  }
  await audit(deps.db, {
    operator,
    action: "stripe_sync",
    targetType: "ride",
    targetId: rideId,
    result: "succeeded",
    detail: counts,
  });
  return Response.json({
    data: { ...counts, reconciliation: await reconcileRide(deps.db, rideId) },
  });
}
