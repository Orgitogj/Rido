import {
  type ActiveRideStatus,
  activeRideStatuses,
  DASHBOARD_RULES,
  type DashboardLive,
  type DashboardPeriod,
  type DashboardSection,
  type DashboardView,
} from "../shared/adminDashboard";
import { appCurrency } from "../shared/currency";

import { eligibleDriverSql } from "./eligibility";
import { ApiError } from "./errors";
import { MATCHING } from "./matching";
import { type OperatorRow, permissionsOf } from "./operators";

import type { SqlClient } from "./db";

const FINANCIAL_REASONS = [
  "settlement_failing",
  "payment_dispute",
  "refund_reversed",
  "refund_mismatch",
  "authorization_expired_before_capture",
  "authorization_expiring_during_trip",
];

const DAY_MS = 24 * 3600 * 1000;

export function dashboardRange(
  q: { from?: string; to?: string },
  now: Date,
): { from: Date; to: Date } {
  const to = q.to ? new Date(q.to) : now;
  const from = q.from
    ? new Date(q.from)
    : new Date(
        Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
      );
  if (from.getTime() >= to.getTime()) {
    throw new ApiError(
      400,
      "INVALID_RANGE",
      "The start of the range must be before its end.",
    );
  }
  if (to.getTime() - from.getTime() > DASHBOARD_RULES.maxRangeDays * DAY_MS) {
    throw new ApiError(
      400,
      "RANGE_TOO_LONG",
      `Choose a range of at most ${DASHBOARD_RULES.maxRangeDays} days.`,
    );
  }
  return { from, to };
}

const num = (value: unknown) => Number(value ?? 0);
const orNull = (value: unknown) =>
  value === null || value === undefined ? null : Math.round(Number(value));

async function live(
  db: SqlClient,
  operator: OperatorRow,
  now: Date,
): Promise<DashboardLive> {
  const can = permissionsOf(operator);
  const one = async <T>(sql: string, values: unknown[] = []) =>
    (await db.query<T>(sql, values)).rows[0];

  const { rows: statuses } = await db.query<{
    status: ActiveRideStatus;
    n: number;
  }>(
    `SELECT status, count(*)::int AS n FROM mobility.rides
      WHERE status = ANY($1::text[]) GROUP BY status`,
    [activeRideStatuses],
  );
  const activeByStatus = Object.fromEntries(
    activeRideStatuses.map((s) => [s, 0]),
  ) as Record<ActiveRideStatus, number>;
  for (const row of statuses) activeByStatus[row.status] = row.n;

  const searching = await one<{
    n: number;
    oldest: number | null;
    average: number | null;
  }>(
    `SELECT count(*)::int AS n,
            max(extract(epoch FROM ($1::timestamptz - requested_at))) AS oldest,
            avg(extract(epoch FROM ($1::timestamptz - requested_at))) AS average
       FROM mobility.rides WHERE status IN ('requested', 'offered')`,
    [now],
  );
  const drivers = await one<{ online: number; available: number }>(
    `SELECT count(*) FILTER (WHERE dp.online)::int AS online,
            count(*) FILTER (
              WHERE dp.online AND ${eligibleDriverSql("dp", "$1::timestamptz")}
                AND dp.last_seen_at >= $2 AND dp.location_updated_at >= $3
                AND EXISTS (SELECT 1 FROM mobility.driver_vehicle_categories c
                             WHERE c.driver_profile_id = dp.id)
                AND NOT EXISTS (SELECT 1 FROM mobility.rides r
                                 WHERE r.driver_profile_id = dp.id
                                   AND r.status IN ('accepted', 'arriving', 'arrived', 'in_progress'))
            )::int AS available
       FROM mobility.driver_profiles dp
      WHERE dp.status = 'approved' AND dp.deleted_at IS NULL`,
    [
      now,
      new Date(now.getTime() - MATCHING.driverFreshSeconds * 1000),
      new Date(now.getTime() - MATCHING.locationMaxAgeSeconds * 1000),
    ],
  );
  const settlement = await one<{
    captures: number;
    releases: number;
    retrying: number;
  }>(
    `SELECT count(*) FILTER (WHERE status = 'completed' AND payment_status = 'authorized')::int AS captures,
            count(*) FILTER (WHERE status IN ('cancelled', 'no_driver', 'interrupted')
                               AND payment_status NOT IN ('cancelled', 'paid', 'expired', 'pending', 'failed'))::int AS releases,
            count(*) FILTER (WHERE settlement_attempts > 0)::int AS retrying
       FROM mobility.rides
      WHERE settled_at IS NULL AND stripe_payment_intent_id IS NOT NULL
        AND status IN ('completed', 'cancelled', 'no_driver', 'interrupted')`,
  );
  const support = await one<{ open: number; awaiting: number }>(
    `SELECT count(*) FILTER (WHERE status <> 'resolved')::int AS open,
            count(*) FILTER (
              WHERE status = 'open'
                 OR (status = 'in_progress' AND last_user_message_at IS NOT NULL
                     AND (last_operator_message_at IS NULL
                          OR last_user_message_at > last_operator_message_at)))::int AS awaiting
       FROM mobility.support_requests WHERE status <> 'resolved'`,
  );
  const review = await one<{ open: number; financial: number }>(
    `SELECT count(*)::int AS open,
            count(*) FILTER (WHERE review_reason = ANY($1::text[]))::int AS financial
       FROM mobility.rides WHERE needs_review AND review_resolved_at IS NULL`,
    [FINANCIAL_REASONS],
  );
  const disputes = await one<{ n: number }>(
    "SELECT count(*)::int AS n FROM mobility.disputes WHERE closed_at IS NULL",
  );
  const safety = can.includes("support")
    ? await one<{ n: number }>(
        "SELECT count(*)::int AS n FROM mobility.safety_reports WHERE status IN ('open', 'in_review')",
      )
    : null;
  const applications = can.includes("verify")
    ? await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM mobility.driver_profiles dp
          WHERE dp.status = 'submitted'
             OR (dp.status IN ('approved', 'suspended') AND EXISTS (
                   SELECT 1 FROM mobility.driver_documents d
                    WHERE d.driver_profile_id = dp.id AND d.status = 'uploaded'))`,
      )
    : null;
  const collections = await one<{ unpaid: number; pending: number }>(
    `SELECT count(*) FILTER (WHERE collection_status = 'unpaid')::int AS unpaid,
            count(*) FILTER (WHERE collection_status = 'pending')::int AS pending
       FROM mobility.rides WHERE collection_status IN ('unpaid', 'pending')`,
  );
  const scheduled = await one<{ upcoming: number; awaiting: number }>(
    `SELECT count(*) FILTER (WHERE status = 'scheduled')::int AS upcoming,
            count(*) FILTER (WHERE status = 'awaiting_confirmation')::int AS awaiting
       FROM mobility.scheduled_rides
      WHERE status IN ('scheduled', 'awaiting_confirmation')`,
  );

  return {
    activeByStatus,
    searching: {
      count: searching.n,
      oldestSeconds: orNull(searching.oldest),
      averageSeconds: orNull(searching.average),
    },
    drivers: {
      approvedOnline: drivers.online,
      eligibleAvailable: drivers.available,
    },
    settlement: {
      capturesAwaiting: settlement.captures,
      releasesAwaiting: settlement.releases,
      retrying: settlement.retrying,
    },
    queues: {
      supportOpen: support.open,
      supportAwaitingReply: support.awaiting,
      safetyOpen: safety ? safety.n : null,
      driverApplications: applications ? applications.n : null,
      reviewOpen: review.open,
      financialIssues: review.financial,
      disputesOpen: disputes.n,
      unpaidRides: collections.unpaid,
      collectionsPending: collections.pending,
    },
    scheduled: {
      upcoming: scheduled.upcoming,
      awaitingConfirmation: scheduled.awaiting,
    },
  };
}

async function period(
  db: SqlClient,
  from: Date,
  to: Date,
): Promise<DashboardPeriod> {
  const range = [from, to];
  const one = async <T>(sql: string) => (await db.query<T>(sql, range)).rows[0];
  const requests = await one<{
    total: number;
    completed: number;
    by_passenger: number;
    by_driver: number;
    by_system: number;
    no_driver: number;
    interrupted: number;
    active: number;
    accepted: number;
    to_accept: number | null;
  }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'completed')::int AS completed,
            count(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'passenger')::int AS by_passenger,
            count(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'driver')::int AS by_driver,
            count(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'system')::int AS by_system,
            count(*) FILTER (WHERE status = 'no_driver')::int AS no_driver,
            count(*) FILTER (WHERE status = 'interrupted')::int AS interrupted,
            count(*) FILTER (WHERE status IN ('requested', 'offered', 'accepted',
                                              'arriving', 'arrived', 'in_progress'))::int AS active,
            count(*) FILTER (WHERE accepted_at IS NOT NULL)::int AS accepted,
            avg(extract(epoch FROM (accepted_at - requested_at)))
              FILTER (WHERE accepted_at IS NOT NULL) AS to_accept
       FROM mobility.rides
      WHERE requested_at >= $1 AND requested_at < $2`,
  );
  const fares = await one<{ cents: string | number }>(
    `SELECT COALESCE(sum(captured_cents), 0) AS cents FROM mobility.rides
      WHERE paid_at >= $1 AND paid_at < $2 AND status <> 'legacy'`,
  );
  const tips = await one<{ cents: string | number }>(
    `SELECT COALESCE(sum(amount_cents), 0) AS cents FROM mobility.tips
      WHERE paid_at >= $1 AND paid_at < $2`,
  );
  const refunds = await one<{ cents: string | number }>(
    `SELECT (SELECT COALESCE(sum(amount_cents), 0) FROM mobility.refunds
              WHERE status = 'succeeded' AND updated_at >= $1 AND updated_at < $2)
          + (SELECT COALESCE(sum(amount_cents), 0) FROM mobility.tip_refunds
              WHERE status = 'succeeded' AND updated_at >= $1 AND updated_at < $2) AS cents`,
  );
  const ledger = await one<{
    driver: string | number;
    commission: string | number;
  }>(
    `SELECT COALESCE(sum(driver_amount_cents), 0) AS driver,
            COALESCE(sum(commission_cents), 0) AS commission
       FROM mobility.earning_entries
      WHERE occurred_at >= $1 AND occurred_at < $2`,
  );
  const scheduled = await one<{ created: number; expired: number }>(
    `SELECT count(*) FILTER (WHERE created_at >= $1 AND created_at < $2)::int AS created,
            count(*) FILTER (WHERE status = 'expired' AND ended_at >= $1 AND ended_at < $2)::int AS expired
       FROM mobility.scheduled_rides
      WHERE (created_at >= $1 AND created_at < $2) OR (ended_at >= $1 AND ended_at < $2)`,
  );
  const collected = await one<{ pos: string | number; cash: string | number }>(
    `SELECT COALESCE(sum(captured_cents) FILTER (WHERE collection_method = 'pos'), 0) AS pos,
            COALESCE(sum(captured_cents) FILTER (WHERE collection_method = 'cash'), 0) AS cash
       FROM mobility.rides
      WHERE collected_at >= $1 AND collected_at < $2`,
  );
  const transfers = await one<{
    paid: string | number;
    received: string | number;
  }>(
    `SELECT COALESCE(sum(amount_cents) FILTER (WHERE direction = 'to_driver'), 0) AS paid,
            COALESCE(sum(amount_cents) FILTER (WHERE direction = 'from_driver'), 0) AS received
       FROM mobility.driver_settlements
      WHERE created_at >= $1 AND created_at < $2`,
  );
  const cancelled =
    requests.by_passenger + requests.by_driver + requests.by_system;
  const rate = (n: number) =>
    requests.total > 0 ? Math.round((n / requests.total) * 1000) / 1000 : null;
  return {
    requests: {
      total: requests.total,
      completed: requests.completed,
      cancelledByPassenger: requests.by_passenger,
      cancelledByDriver: requests.by_driver,
      cancelledBySystem: requests.by_system,
      noDriver: requests.no_driver,
      interrupted: requests.interrupted,
      stillActive: requests.active,
      cancellationRate: rate(cancelled),
      noDriverRate: rate(requests.no_driver),
    },
    search: {
      accepted: requests.accepted,
      averageSecondsToAccept: orNull(requests.to_accept),
    },
    money: {
      currency: appCurrency(),
      faresCapturedCents: num(fares.cents),
      tipsCapturedCents: num(tips.cents),
      refundedCents: num(refunds.cents),
      ledgerDriverEarningsCents: num(ledger.driver),
      ledgerCommissionCents: num(ledger.commission),
      collectedPosCents: num(collected.pos),
      collectedCashCents: num(collected.cash),
      transfersToDriversCents: num(transfers.paid),
      transfersFromDriversCents: num(transfers.received),
      payouts: { available: false, paidOutCents: 0 },
    },
    scheduled: { created: scheduled.created, expired: scheduled.expired },
  };
}

const cache = new Map<string, { at: number; view: DashboardView }>();

export function clearDashboardCache() {
  cache.clear();
}

const log = (event: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ event, ...fields }));

export async function dashboardView(
  db: SqlClient,
  operator: OperatorRow,
  range: { from: Date; to: Date; pinnedTo: boolean },
  now: Date,
): Promise<DashboardView> {
  const key = [
    range.from.toISOString(),
    range.pinnedTo ? range.to.toISOString() : "now",
    permissionsOf(operator).join(","),
  ].join("|");
  const hit = cache.get(key);
  if (
    hit &&
    now.getTime() >= hit.at &&
    now.getTime() - hit.at < DASHBOARD_RULES.cacheSeconds * 1000
  ) {
    return hit.view;
  }
  const unavailable: DashboardSection[] = [];
  const attempt = async <T>(
    section: DashboardSection,
    run: () => Promise<T>,
  ) => {
    try {
      return await run();
    } catch (e) {
      unavailable.push(section);
      log("dashboard_section_failed", {
        section,
        error: e instanceof Error ? e.name : "unknown",
      });
      return null;
    }
  };
  const view: DashboardView = {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    timezone: DASHBOARD_RULES.timezone,
    generatedAt: now.toISOString(),
    cacheSeconds: DASHBOARD_RULES.cacheSeconds,
    live: await attempt("live", () => live(db, operator, now)),
    period: await attempt("period", () =>
      period(
        db,
        range.from,
        range.pinnedTo ? range.to : new Date(range.to.getTime() + 1),
      ),
    ),
    unavailable,
  };
  if (!unavailable.length) {
    cache.set(key, { at: now.getTime(), view });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return view;
}
