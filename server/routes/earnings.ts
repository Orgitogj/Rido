import {
  type DriverEarningRide,
  type EarningsSummary,
  earningsQuerySchema,
  type Page,
  rideIdSchema,
} from "../../shared/contracts";
import { appCurrency, asCurrency } from "../../shared/currency";
import { driverBalance, listSettlements } from "../collection";
import { entryView, type EntryRow } from "../earnings";
import { policyAt } from "../earningsPolicy";
import { ApiError, notFound } from "../errors";
import { type Deps, parseInput } from "../http";

import { decodeCursor, encodeCursor } from "./admin";
import { currentUser } from "./rides";

import type { AppUser } from "../users";

const query = (request: Request) =>
  Object.fromEntries(new URL(request.url).searchParams);

async function driverProfileId(deps: Deps, user: AppUser) {
  const { rows } = await deps.db.query<{ id: string }>(
    "SELECT id FROM mobility.driver_profiles WHERE user_id = $1",
    [user.id],
  );
  if (!rows[0]) {
    throw new ApiError(403, "NOT_A_DRIVER", "This account is not a driver.");
  }
  return rows[0].id;
}

const ADJUSTMENTS = ["fare_refund_adjustment", "tip_refund_adjustment"];
const DISPUTES = ["dispute_withdrawal", "dispute_reinstatement"];

export async function earningsSummary(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const profileId = await driverProfileId(deps, user);
  const q = parseInput(earningsQuerySchema, query(request));
  const { rows } = await deps.db.query<{
    rides: number;
    fare: number;
    commission: number;
    share: number;
    tips: number;
    adjustments: number;
    disputes: number;
    net: number;
  }>(
    `SELECT count(*) FILTER (WHERE kind = 'ride_earning')::int AS rides,
            COALESCE(sum(gross_cents) FILTER (WHERE kind = 'ride_earning'), 0)::int AS fare,
            COALESCE(sum(commission_cents) FILTER (WHERE kind = 'ride_earning'), 0)::int AS commission,
            COALESCE(sum(driver_amount_cents) FILTER (WHERE kind = 'ride_earning'), 0)::int AS share,
            COALESCE(sum(driver_amount_cents) FILTER (WHERE kind = 'tip'), 0)::int AS tips,
            COALESCE(sum(driver_amount_cents) FILTER (WHERE kind = ANY($4::text[])), 0)::int AS adjustments,
            COALESCE(sum(driver_amount_cents) FILTER (WHERE kind = ANY($5::text[])), 0)::int AS disputes,
            COALESCE(sum(driver_amount_cents), 0)::int AS net
       FROM mobility.earning_entries
      WHERE driver_profile_id = $1
        AND ($2::timestamptz IS NULL OR occurred_at >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR occurred_at < $3::timestamptz)`,
    [profileId, q.from ?? null, q.to ?? null, ADJUSTMENTS, DISPUTES],
  );
  const { rows: pending } = await deps.db.query<{
    rides: number;
    fare: number;
    tips: number;
    tips_cents: number;
    open_disputes: number;
  }>(
    `SELECT (SELECT count(*)::int FROM mobility.rides r
              WHERE r.driver_profile_id = $1 AND r.status = 'completed'
                AND r.payment_status IN ('authorized', 'processing')
                AND ($2::timestamptz IS NULL OR r.completed_at >= $2::timestamptz)
                AND ($3::timestamptz IS NULL OR r.completed_at < $3::timestamptz)) AS rides,
            (SELECT COALESCE(sum(r.fare_cents), 0)::int FROM mobility.rides r
              WHERE r.driver_profile_id = $1 AND r.status = 'completed'
                AND r.payment_status IN ('authorized', 'processing')
                AND ($2::timestamptz IS NULL OR r.completed_at >= $2::timestamptz)
                AND ($3::timestamptz IS NULL OR r.completed_at < $3::timestamptz)) AS fare,
            (SELECT count(*)::int FROM mobility.tips t
              WHERE t.driver_profile_id = $1 AND t.status = 'processing') AS tips,
            (SELECT COALESCE(sum(t.amount_cents), 0)::int FROM mobility.tips t
              WHERE t.driver_profile_id = $1 AND t.status = 'processing') AS tips_cents,
            (SELECT count(*)::int FROM mobility.disputes d
               JOIN mobility.rides r ON r.id = d.ride_id
              WHERE r.driver_profile_id = $1 AND d.closed_at IS NULL
                AND d.subject IN ('fare', 'tip')) AS open_disputes`,
    [profileId, q.from ?? null, q.to ?? null],
  );
  const s = rows[0];
  const policy = policyAt(deps.now());
  const body: EarningsSummary = {
    from: q.from ?? null,
    to: q.to ?? null,
    currency: appCurrency(),
    confirmed: {
      rides: s.rides,
      fareCents: s.fare,
      commissionCents: s.commission,
      driverShareCents: s.share,
      tipsCents: s.tips,
      adjustmentsCents: s.adjustments,
      disputesCents: s.disputes,
      netCents: s.net,
    },
    disputes: { open: pending[0].open_disputes },
    pending: {
      rides: pending[0].rides,
      fareCents: pending[0].fare,
      tips: pending[0].tips,
      tipsCents: pending[0].tips_cents,
    },
    policy: {
      version: policy.version,
      fareCommissionBps: policy.fareCommissionBps,
      tipCommissionBps: policy.tipCommissionBps,
      label: policy.label,
    },
    balance: await driverBalance(deps.db, profileId, appCurrency()),
    settlements: (await listSettlements(deps.db, profileId, 20)).map((s) => ({
      ...s,
      operator: null,
      note: null,
    })),
    payouts: {
      available: false,
      message:
        "There are no automatic payouts. Transfers recorded by the operator are listed under your balance.",
    },
  };
  return Response.json({ data: body });
}

interface EarningRideRow {
  id: string;
  completed_at: Date | null;
  origin_address: string;
  destination_address: string;
  payment_status: string;
  currency: string;
  fare_cents: number;
  e_fare: number | null;
  commission_rate_bps: number | null;
  commission_cents: number | null;
  driver_share_cents: number | null;
  commission_policy_version: string | null;
  tip_amount: number | null;
  tip_status: string | null;
  tip_refunded: number | null;
  dispute_open: boolean;
  entries: EntryRow[];
}

const RIDE_SQL = `
  SELECT r.id, r.completed_at, r.origin_address, r.destination_address,
         r.payment_status, r.fare_cents, r.currency,
         re.fare_cents AS e_fare, re.commission_rate_bps, re.commission_cents,
         re.driver_share_cents, re.commission_policy_version,
         t.amount_cents AS tip_amount, t.status AS tip_status,
         t.refunded_cents AS tip_refunded,
         EXISTS (SELECT 1 FROM mobility.disputes d
                  WHERE d.ride_id = r.id AND d.closed_at IS NULL
                    AND d.subject IN ('fare', 'tip')) AS dispute_open,
         COALESCE((SELECT json_agg(json_build_object(
                     'kind', e.kind, 'gross_cents', e.gross_cents,
                     'commission_cents', e.commission_cents,
                     'driver_amount_cents', e.driver_amount_cents,
                     'policy_version', e.policy_version,
                     'occurred_at', e.occurred_at) ORDER BY e.id)
                     FROM mobility.earning_entries e
                    WHERE e.ride_id = r.id AND e.driver_profile_id = $1), '[]'::json) AS entries
    FROM mobility.rides r
    LEFT JOIN mobility.ride_earnings re ON re.ride_id = r.id AND re.driver_profile_id = $1
    LEFT JOIN mobility.tips t ON t.ride_id = r.id AND t.status IN ('succeeded', 'processing')
   WHERE r.driver_profile_id = $1 AND r.status = 'completed'`;

function toRide(r: EarningRideRow): DriverEarningRide {
  const entries = r.entries.map(entryView);
  const sum = (kinds: string[]) =>
    entries
      .filter((e) => kinds.includes(e.kind))
      .reduce((total, e) => total + e.driverAmountCents, 0);
  return {
    rideId: r.id,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    pickupAddress: r.origin_address,
    destinationAddress: r.destination_address,
    state:
      r.e_fare !== null
        ? "confirmed"
        : r.payment_status === "authorized" || r.payment_status === "processing"
          ? "pending"
          : "not_charged",
    currency: asCurrency(r.currency),
    fareCents: r.e_fare ?? r.fare_cents,
    commissionRateBps: r.commission_rate_bps,
    commissionCents: r.commission_cents,
    driverShareCents: r.driver_share_cents,
    policyVersion: r.commission_policy_version,
    tip:
      r.tip_amount !== null
        ? {
            amountCents: r.tip_amount,
            status: r.tip_status === "succeeded" ? "paid" : "processing",
            refundedCents: r.tip_refunded ?? 0,
          }
        : null,
    adjustmentsCents: sum(ADJUSTMENTS),
    disputesCents: sum(DISPUTES),
    disputeOpen: r.dispute_open,
    netCents: entries.reduce((total, e) => total + e.driverAmountCents, 0),
    entries,
  };
}

export async function listEarnings(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const profileId = await driverProfileId(deps, user);
  const q = parseInput(earningsQuerySchema, query(request));
  const cursor = decodeCursor(q.cursor);
  const { rows } = await deps.db.query<EarningRideRow>(
    `${RIDE_SQL}
        AND ($2::timestamptz IS NULL OR r.completed_at >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR r.completed_at < $3::timestamptz)
        AND ($4::timestamptz IS NULL OR (r.completed_at, r.id) < ($4::timestamptz, $5::uuid))
      ORDER BY r.completed_at DESC, r.id DESC
      LIMIT $6`,
    [
      profileId,
      q.from ?? null,
      q.to ?? null,
      cursor?.[0] ?? null,
      cursor?.[1] ?? null,
      q.limit + 1,
    ],
  );
  const more = rows.length > q.limit;
  const items = more ? rows.slice(0, q.limit) : rows;
  const last = items[items.length - 1];
  const body: Page<DriverEarningRide> = {
    items: items.map(toRide),
    nextCursor:
      more && last?.completed_at
        ? encodeCursor(last.completed_at, last.id)
        : null,
  };
  return Response.json({ data: body });
}

export async function rideEarnings(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const profileId = await driverProfileId(deps, user);
  const rideId = parseInput(rideIdSchema, params.id);
  const { rows } = await deps.db.query<EarningRideRow>(
    `${RIDE_SQL} AND r.id = $2`,
    [profileId, rideId],
  );
  if (!rows[0]) throw notFound("Ride");
  return Response.json({ data: toRide(rows[0]) });
}
