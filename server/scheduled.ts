import {
  type ScheduleAreaInfo,
  type ScheduledRideList,
  type ScheduledRideView,
  type ScheduledState,
  type ScheduleEndReason,
  SCHEDULE_RULES,
} from "../shared/schedule";
import { containsPoint } from "../shared/serviceArea";
import { formatInZone, resolveLocalTime } from "../shared/zonedTime";

import { type Database, type SqlClient, transaction } from "./db";
import { ApiError, notFound } from "./errors";
import { enqueueNotification } from "./notifications";
import { NOTIFY } from "./notificationText";
import { checkItinerary, createQuoteFor, type QuoteInput } from "./quoting";
import {
  activeAreasContaining,
  serviceAreaForTrip,
  type ServiceAreaRow,
} from "./serviceAreas";
import { categoryForRequest } from "./vehicleCategories";

import type { RoutingProvider } from "./routing";
import type { Place, RideStatus } from "../shared/contracts";

const MINUTE = 60_000;

export function scheduleLimits(
  env: Record<string, string | undefined> = process.env,
) {
  const bounded = (
    raw: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const value = Number(raw);
    return raw && Number.isInteger(value) && value >= min && value <= max
      ? value
      : fallback;
  };
  return {
    minLeadMinutes: bounded(
      env.SCHEDULED_RIDE_MIN_LEAD_MINUTES,
      SCHEDULE_RULES.minLeadMinutes,
      SCHEDULE_RULES.confirmLeadMinutes + 5,
      24 * 60,
    ),
    maxDays: bounded(
      env.SCHEDULED_RIDE_MAX_DAYS,
      SCHEDULE_RULES.maxDays,
      1,
      30,
    ),
    confirmLeadMinutes: SCHEDULE_RULES.confirmLeadMinutes,
    confirmGraceMinutes: SCHEDULE_RULES.confirmGraceMinutes,
    maxUpcoming: SCHEDULE_RULES.maxUpcoming,
  };
}

interface ScheduleRow {
  id: string;
  user_id: string;
  pickup_address: string;
  pickup_latitude: number;
  pickup_longitude: number;
  destination_address: string;
  destination_latitude: number;
  destination_longitude: number;
  stops: Place[];
  vehicle_category_id: string | null;
  category_name: string | null;
  passenger_count: number;
  service_area_id: string;
  timezone: string;
  local_time: string;
  pickup_at: Date;
  confirm_opens_at: Date;
  confirm_deadline: Date;
  status:
    | "scheduled"
    | "awaiting_confirmation"
    | "confirmed"
    | "cancelled"
    | "expired";
  end_reason: ScheduleEndReason | null;
  ride_id: string | null;
  ride_status: RideStatus | null;
  ride_requested_at: Date | null;
  created_at: Date;
}

const SELECT = `
  SELECT s.*, c.name AS category_name, r.status AS ride_status,
         r.requested_at AS ride_requested_at
    FROM mobility.scheduled_rides s
    LEFT JOIN mobility.vehicle_categories c ON c.id = s.vehicle_category_id
    LEFT JOIN mobility.rides r ON r.id = s.ride_id`;

const iso = (d: Date) => new Date(d).toISOString();

function stateOf(row: ScheduleRow): ScheduledState {
  if (row.status === "cancelled" || row.status === "expired") return row.status;
  if (row.status === "scheduled") return "scheduled";
  if (row.status === "awaiting_confirmation") return "awaiting_confirmation";
  switch (row.ride_status) {
    case "requested":
    case "offered":
      return "searching";
    case "no_driver":
      return "no_driver";
    case "cancelled":
      return "cancelled";
    case "awaiting_payment":
    case null:
      return "awaiting_confirmation";
    default:
      return "fulfilled";
  }
}

function view(row: ScheduleRow, now: Date): ScheduledRideView {
  const state = stateOf(row);
  const open =
    row.status === "scheduled" || row.status === "awaiting_confirmation";
  return {
    id: row.id,
    state,
    pickup: {
      address: row.pickup_address,
      latitude: row.pickup_latitude,
      longitude: row.pickup_longitude,
    },
    destination: {
      address: row.destination_address,
      latitude: row.destination_latitude,
      longitude: row.destination_longitude,
    },
    stops: row.stops,
    category: row.vehicle_category_id
      ? { id: row.vehicle_category_id, name: row.category_name ?? "" }
      : null,
    passengerCount: row.passenger_count,
    timezone: row.timezone,
    localTime: row.local_time,
    pickupAt: iso(row.pickup_at),
    confirmFrom: iso(row.confirm_opens_at),
    confirmBy: iso(row.confirm_deadline),
    rideId: row.ride_requested_at ? row.ride_id : null,
    rideStatus: row.ride_requested_at ? row.ride_status : null,
    endReason: row.end_reason,
    canCancel: open,
    canConfirm:
      row.status === "awaiting_confirmation" &&
      now.getTime() <= new Date(row.confirm_deadline).getTime(),
    createdAt: iso(row.created_at),
    serverTime: now.toISOString(),
  };
}

function windowFor(area: ServiceAreaRow, now: Date): ScheduleAreaInfo {
  const limits = scheduleLimits();
  const at = (ms: number) =>
    formatInZone(new Date(now.getTime() + ms), area.timezone) ?? "";
  return {
    timezone: area.timezone,
    localNow: at(0),
    earliestLocal: at(limits.minLeadMinutes * MINUTE),
    latestLocal: at(limits.maxDays * 24 * 60 * MINUTE),
  };
}

export async function scheduleWindow(
  deps: { db: Database; now: () => Date },
  pickup: { latitude: number; longitude: number },
): Promise<ScheduleAreaInfo> {
  const [area] = await activeAreasContaining(deps.db, pickup);
  if (!area) {
    throw new ApiError(
      422,
      "PICKUP_OUTSIDE_SERVICE_AREA",
      "Rides aren't available from this pickup location yet.",
    );
  }
  return windowFor(area, deps.now());
}

export async function createScheduledRide(
  deps: { db: Database; now: () => Date },
  userId: string,
  input: QuoteInput & {
    localTime: string;
    fold?: "earlier" | "later";
    clientRequestId: string;
  },
): Promise<{ view: ScheduledRideView; created: boolean }> {
  const now = deps.now();
  const limits = scheduleLimits();
  const { rows: existing } = await deps.db.query<{ id: string }>(
    "SELECT id FROM mobility.scheduled_rides WHERE user_id = $1 AND client_request_id = $2",
    [userId, input.clientRequestId],
  );
  if (existing[0]) {
    return {
      view: await getScheduledRide(deps.db, userId, existing[0].id, now),
      created: false,
    };
  }

  checkItinerary(input);
  const stops = input.stops ?? [];
  const passengerCount = input.passengerCount ?? 1;
  const area = await serviceAreaForTrip(
    deps.db,
    input.pickup,
    input.destination,
    stops,
  );
  const category = await categoryForRequest(
    deps.db,
    input.categoryId,
    passengerCount,
  );

  const resolved = resolveLocalTime(input.localTime, area.timezone);
  if (resolved.kind === "invalid") {
    throw new ApiError(400, "INVALID_INPUT", "That date and time isn't valid.");
  }
  if (resolved.kind === "nonexistent") {
    throw new ApiError(
      422,
      "SCHEDULE_TIME_SKIPPED",
      "That time doesn't exist on that day because the clocks go forward. Choose a different time.",
    );
  }
  if (resolved.kind === "ambiguous" && !input.fold) {
    throw new ApiError(
      422,
      "SCHEDULE_TIME_AMBIGUOUS",
      "That time happens twice on that day because the clocks go back. Choose the earlier or the later one.",
    );
  }
  const pickupAt =
    resolved.kind === "ok"
      ? resolved.instant
      : input.fold === "later"
        ? resolved.later
        : resolved.earlier;

  if (pickupAt.getTime() < now.getTime() + limits.minLeadMinutes * MINUTE) {
    throw new ApiError(
      422,
      "SCHEDULE_TOO_SOON",
      `Schedule at least ${limits.minLeadMinutes} minutes ahead, or request a ride now.`,
    );
  }
  if (pickupAt.getTime() > now.getTime() + limits.maxDays * 24 * 60 * MINUTE) {
    throw new ApiError(
      422,
      "SCHEDULE_TOO_FAR",
      `Rides can be scheduled up to ${limits.maxDays} days ahead.`,
    );
  }

  const id = await transaction(deps.db, async (tx) => {
    await tx.query("SELECT 1 FROM mobility.users WHERE id = $1 FOR UPDATE", [
      userId,
    ]);
    const { rows: again } = await tx.query<{ id: string }>(
      "SELECT id FROM mobility.scheduled_rides WHERE user_id = $1 AND client_request_id = $2",
      [userId, input.clientRequestId],
    );
    if (again[0]) return { id: again[0].id, created: false };
    const { rows: open } = await tx.query<{ n: number; clash: boolean }>(
      `SELECT count(*)::int AS n,
              bool_or(abs(extract(epoch FROM (pickup_at - $2::timestamptz))) < $3) AS clash
         FROM mobility.scheduled_rides
        WHERE user_id = $1 AND status IN ('scheduled', 'awaiting_confirmation')`,
      [
        userId,
        pickupAt,
        (limits.confirmLeadMinutes + limits.confirmGraceMinutes) * 60,
      ],
    );
    if (open[0].n >= limits.maxUpcoming) {
      throw new ApiError(
        409,
        "SCHEDULE_LIMIT",
        `You can have up to ${limits.maxUpcoming} scheduled requests. Cancel one to add another.`,
      );
    }
    if (open[0].clash) {
      throw new ApiError(
        409,
        "SCHEDULE_OVERLAP",
        "You already have a request scheduled around that time.",
      );
    }
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO mobility.scheduled_rides
         (user_id, client_request_id, pickup_address, pickup_latitude, pickup_longitude,
          destination_address, destination_latitude, destination_longitude, stops,
          vehicle_category_id, passenger_count, service_area_id, timezone, local_time,
          pickup_at, confirm_opens_at, confirm_deadline, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)
       RETURNING id`,
      [
        userId,
        input.clientRequestId,
        input.pickup.address,
        input.pickup.latitude,
        input.pickup.longitude,
        input.destination.address,
        input.destination.latitude,
        input.destination.longitude,
        JSON.stringify(stops),
        category.id,
        passengerCount,
        area.id,
        area.timezone,
        input.localTime,
        pickupAt,
        new Date(pickupAt.getTime() - limits.confirmLeadMinutes * MINUTE),
        new Date(pickupAt.getTime() + limits.confirmGraceMinutes * MINUTE),
        now,
      ],
    );
    return { id: rows[0].id, created: true };
  });
  return {
    view: await getScheduledRide(deps.db, userId, id.id, now),
    created: id.created,
  };
}

export async function getScheduledRide(
  db: SqlClient,
  userId: string,
  id: string,
  now: Date,
): Promise<ScheduledRideView> {
  const { rows } = await db.query<ScheduleRow>(
    `${SELECT} WHERE s.id = $1 AND s.user_id = $2`,
    [id, userId],
  );
  if (!rows[0]) throw notFound("Scheduled ride");
  return view(rows[0], now);
}

export async function listScheduledRides(
  db: SqlClient,
  userId: string,
  now: Date,
): Promise<ScheduledRideList> {
  const { rows } = await db.query<ScheduleRow>(
    `${SELECT} WHERE s.user_id = $1 ORDER BY s.pickup_at DESC, s.id DESC LIMIT 40`,
    [userId],
  );
  const views = rows.map((r) => view(r, now));
  const open = (v: ScheduledRideView) =>
    v.state === "scheduled" ||
    v.state === "awaiting_confirmation" ||
    v.state === "searching";
  return {
    upcoming: views.filter(open).reverse(),
    past: views.filter((v) => !open(v)),
    limits: scheduleLimits(),
  };
}

export async function cancelScheduledRide(
  deps: { db: Database; now: () => Date },
  userId: string,
  id: string,
): Promise<{ rideToCancel: string | null }> {
  const now = deps.now();
  return transaction(deps.db, async (tx) => {
    const { rows } = await tx.query<ScheduleRow>(
      `SELECT s.*, NULL AS category_name, r.status AS ride_status,
              r.requested_at AS ride_requested_at
         FROM mobility.scheduled_rides s
         LEFT JOIN mobility.rides r ON r.id = s.ride_id
        WHERE s.id = $1 AND s.user_id = $2 FOR UPDATE OF s`,
      [id, userId],
    );
    const row = rows[0];
    if (!row) throw notFound("Scheduled ride");
    if (row.status === "cancelled") return { rideToCancel: null };
    if (row.status !== "scheduled" && row.status !== "awaiting_confirmation") {
      throw new ApiError(
        409,
        "SCHEDULE_CLOSED",
        row.status === "confirmed"
          ? "This request is already being handled as a ride. Cancel it from the ride screen."
          : "This scheduled request has already ended.",
      );
    }
    await tx.query(
      `UPDATE mobility.scheduled_rides
          SET status = 'cancelled', end_reason = 'cancelled_by_passenger',
              ended_at = $2, updated_at = $2, version = version + 1
        WHERE id = $1`,
      [id, now],
    );
    return {
      rideToCancel:
        row.ride_id && row.ride_status === "awaiting_payment"
          ? row.ride_id
          : null,
    };
  });
}

async function expire(
  tx: SqlClient,
  row: Pick<ScheduleRow, "id" | "user_id">,
  reason: ScheduleEndReason,
  now: Date,
) {
  const { rows } = await tx.query(
    `UPDATE mobility.scheduled_rides
        SET status = 'expired', end_reason = $2, ended_at = $3, updated_at = $3,
            version = version + 1
      WHERE id = $1 AND status IN ('scheduled', 'awaiting_confirmation')
      RETURNING id`,
    [row.id, reason, now],
  );
  if (!rows.length) return;
  await enqueueNotification(
    tx,
    {
      userId: row.user_id,
      rideId: null,
      kind: "scheduled_expired",
      dedupeKey: `scheduled:${row.id}:expired`,
      ...NOTIFY.scheduledExpired(reason),
      target: `/scheduled/${row.id}`,
    },
    now,
  );
}

export async function quoteScheduledRide(
  deps: { db: Database; routing: RoutingProvider | null; now: () => Date },
  userId: string,
  id: string,
) {
  const now = deps.now();
  const { rows } = await deps.db.query<ScheduleRow>(
    `${SELECT} WHERE s.id = $1 AND s.user_id = $2`,
    [id, userId],
  );
  const row = rows[0];
  if (!row) throw notFound("Scheduled ride");
  if (row.status === "scheduled") {
    throw new ApiError(
      409,
      "SCHEDULE_NOT_OPEN",
      "It's too early to confirm this request. We'll notify you when it's time.",
    );
  }
  if (
    row.status !== "awaiting_confirmation" ||
    now.getTime() > new Date(row.confirm_deadline).getTime()
  ) {
    if (row.status === "awaiting_confirmation") {
      await transaction(deps.db, (tx) => expire(tx, row, "not_confirmed", now));
    }
    throw new ApiError(
      409,
      "SCHEDULE_CLOSED",
      "This scheduled request can no longer be confirmed.",
    );
  }
  return createQuoteFor(
    deps,
    userId,
    {
      pickup: {
        address: row.pickup_address,
        latitude: row.pickup_latitude,
        longitude: row.pickup_longitude,
      },
      destination: {
        address: row.destination_address,
        latitude: row.destination_latitude,
        longitude: row.destination_longitude,
      },
      stops: row.stops,
      categoryId: row.vehicle_category_id ?? undefined,
      passengerCount: row.passenger_count,
    },
    { scheduledRideId: row.id },
  );
}

export async function scheduleOpenForBooking(
  db: SqlClient,
  quoteId: string,
  now: Date,
): Promise<boolean> {
  const { rows } = await db.query<{ open: boolean }>(
    `SELECT (s.status = 'awaiting_confirmation' AND s.confirm_deadline >= $2) AS open
       FROM mobility.quotes q
       JOIN mobility.scheduled_rides s ON s.id = q.scheduled_ride_id
      WHERE q.id = $1`,
    [quoteId, now],
  );
  return rows.length === 0 || rows[0].open;
}

export async function linkScheduledBooking(
  db: SqlClient,
  quoteId: string,
  rideId: string,
  now: Date,
) {
  await db.query(
    `UPDATE mobility.scheduled_rides s
        SET ride_id = $2, updated_at = $3
       FROM mobility.quotes q
      WHERE q.id = $1 AND s.id = q.scheduled_ride_id
        AND s.status = 'awaiting_confirmation'
        AND s.ride_id IS DISTINCT FROM $2`,
    [quoteId, rideId, now],
  );
}

export async function confirmScheduledRide(
  tx: SqlClient,
  rideId: string,
  now: Date,
) {
  await tx.query(
    `UPDATE mobility.scheduled_rides
        SET status = 'confirmed', updated_at = $2, version = version + 1
      WHERE ride_id = $1 AND status = 'awaiting_confirmation'`,
    [rideId, now],
  );
}

export async function dispatchScheduledRides(
  deps: { db: Database; now: () => Date },
  limit = 50,
): Promise<{ opened: number; expired: number }> {
  const now = deps.now();
  let opened = 0;
  let expired = 0;
  for (let i = 0; i < limit; i++) {
    const outcome = await transaction(deps.db, async (tx) => {
      const { rows } = await tx.query<
        ScheduleRow & {
          user_deleted: boolean;
          area_status: string;
          area_boundary: [number, number][];
          category_status: string | null;
        }
      >(
        `SELECT s.*, NULL AS category_name, r.status AS ride_status,
                r.requested_at AS ride_requested_at,
                u.deleted_at IS NOT NULL AS user_deleted,
                a.status AS area_status, a.boundary AS area_boundary,
                c.status AS category_status
           FROM mobility.scheduled_rides s
           JOIN mobility.users u ON u.id = s.user_id
           JOIN mobility.service_areas a ON a.id = s.service_area_id
           LEFT JOIN mobility.vehicle_categories c ON c.id = s.vehicle_category_id
           LEFT JOIN mobility.rides r ON r.id = s.ride_id
          WHERE (s.status = 'scheduled' AND s.confirm_opens_at <= $1)
             OR (s.status = 'awaiting_confirmation' AND s.confirm_deadline < $1)
          ORDER BY s.pickup_at
          LIMIT 1
          FOR UPDATE OF s SKIP LOCKED`,
        [now],
      );
      const row = rows[0];
      if (!row) return "empty" as const;

      if (row.status === "awaiting_confirmation") {
        if (row.ride_id && row.ride_requested_at) {
          await confirmScheduledRide(tx, row.ride_id, now);
          return "confirmed" as const;
        }
        await expire(tx, row, "not_confirmed", now);
        return "expired" as const;
      }
      if (row.user_deleted) {
        await expire(tx, row, "account_closed", now);
        return "expired" as const;
      }
      if (now.getTime() > new Date(row.confirm_deadline).getTime()) {
        await expire(tx, row, "missed_window", now);
        return "expired" as const;
      }
      if (
        row.area_status !== "active" ||
        !containsPoint(row.area_boundary, {
          latitude: row.pickup_latitude,
          longitude: row.pickup_longitude,
        })
      ) {
        await expire(tx, row, "area_unavailable", now);
        return "expired" as const;
      }
      if (row.category_status !== null && row.category_status !== "active") {
        await expire(tx, row, "category_unavailable", now);
        return "expired" as const;
      }
      await tx.query(
        `UPDATE mobility.scheduled_rides
            SET status = 'awaiting_confirmation', notified_at = $2, updated_at = $2,
                version = version + 1
          WHERE id = $1`,
        [row.id, now],
      );
      await enqueueNotification(
        tx,
        {
          userId: row.user_id,
          rideId: null,
          kind: "scheduled_confirm",
          dedupeKey: `scheduled:${row.id}:confirm`,
          ...NOTIFY.scheduledConfirm(row.local_time.slice(11)),
          target: `/scheduled/${row.id}`,
        },
        now,
      );
      return "opened" as const;
    });
    if (outcome === "empty") break;
    if (outcome === "opened") opened++;
    if (outcome === "expired") expired++;
  }
  return { opened, expired };
}
