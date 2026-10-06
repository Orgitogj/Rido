import { ApiError } from "./errors";
import { enqueueForTransition } from "./notifications";

import type { SqlClient } from "./db";
import type {
  PaymentStatus,
  RideAction,
  RideStatus,
} from "../shared/contracts";

export type Actor = "passenger" | "driver" | "system";

export const TRANSITIONS: Partial<
  Record<RideStatus, Partial<Record<RideStatus, Actor[]>>>
> = {
  awaiting_payment: {
    requested: ["system"],
    cancelled: ["passenger", "system"],
  },
  requested: {
    offered: ["system"],
    no_driver: ["system"],
    cancelled: ["passenger", "system"],
  },
  offered: {
    accepted: ["driver"],
    requested: ["system"],
    no_driver: ["system"],
    cancelled: ["passenger", "system"],
  },
  accepted: {
    arriving: ["driver"],
    requested: ["driver", "system"],
    cancelled: ["passenger", "driver", "system"],
  },
  arriving: {
    arrived: ["driver"],
    requested: ["driver", "system"],
    cancelled: ["passenger", "driver", "system"],
  },
  arrived: {
    in_progress: ["driver"],
    requested: ["driver", "system"],
    cancelled: ["passenger", "driver", "system"],
  },
  in_progress: { completed: ["driver"], interrupted: ["driver"] },
};

export const SEARCHING_STATUSES: RideStatus[] = ["requested", "offered"];
export const ASSIGNED_STATUSES: RideStatus[] = [
  "accepted",
  "arriving",
  "arrived",
  "in_progress",
];
export const ACTIVE_STATUSES: RideStatus[] = [
  ...SEARCHING_STATUSES,
  ...ASSIGNED_STATUSES,
];
export const PRE_PICKUP_STATUSES: RideStatus[] = [
  "accepted",
  "arriving",
  "arrived",
];
export const TERMINAL_STATUSES: RideStatus[] = [
  "completed",
  "cancelled",
  "no_driver",
  "interrupted",
  "legacy",
];
export const UNCHARGED_END_STATUSES: RideStatus[] = [
  "cancelled",
  "no_driver",
  "interrupted",
];

export function canTransition(
  from: RideStatus,
  to: RideStatus,
  actor: Actor,
): boolean {
  return TRANSITIONS[from]?.[to]?.includes(actor) ?? false;
}

export function allowedActions(
  status: RideStatus,
  viewer: "passenger" | "driver",
): RideAction[] {
  const actions = new Set<RideAction>();
  for (const [to, actors] of Object.entries(TRANSITIONS[status] ?? {})) {
    if (!actors?.includes(viewer)) continue;
    if (to === "cancelled") actions.add("cancel");
    else if (to === "interrupted") actions.add("interrupt");
    else if (viewer === "driver" && to === "requested") actions.add("cancel");
    else if (
      viewer === "driver" &&
      (to === "arriving" ||
        to === "arrived" ||
        to === "in_progress" ||
        to === "completed")
    ) {
      actions.add(to);
    }
  }
  const order: RideAction[] = [
    "arriving",
    "arrived",
    "in_progress",
    "completed",
    "cancel",
    "interrupt",
  ];
  return order.filter((a) => actions.has(a));
}

export interface RideRow {
  id: string;
  quote_id: string;
  user_id: string;
  driver_profile_id: string | null;
  demo_driver_id: number | null;
  status: RideStatus;
  payment_status: PaymentStatus;
  stripe_payment_intent_id: string | null;
  fare_cents: number;
  currency: string;
  origin_address: string;
  origin_latitude: number;
  origin_longitude: number;
  destination_address: string;
  destination_latitude: number;
  destination_longitude: number;
  distance_meters: number | null;
  duration_seconds: number;
  version: number;
  created_at: Date;
  authorized_at: Date | null;
  requested_at: Date | null;
  search_deadline: Date | null;
  accepted_at: Date | null;
  arriving_at: Date | null;
  arrived_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by: Actor | null;
  cancel_reason: string | null;
  paid_at: Date | null;
  rematch_count: number;
  interrupted_at: Date | null;
  captured_cents: number | null;
  refunded_cents: number;
  authorization_expires_at: Date | null;
  settled_at: Date | null;
  settlement_attempts: number;
  settlement_error: string | null;
  next_settlement_at: Date | null;
  needs_review: boolean;
  ranking_computed_at: Date | null;
  review_reason: string | null;
  updated_at: Date;
  review_resolved_at: Date | null;
  review_resolved_by: string | null;
  review_note: string | null;
  payment_method: "card_online" | "in_vehicle";
  collection_status: "pending" | "collected" | "unpaid" | "waived" | null;
  collection_method: "pos" | "cash" | null;
  collected_at: Date | null;
  collection_recorded_by: "driver" | "operator" | null;
  collection_note: string | null;
}

export async function lockRide(tx: SqlClient, rideId: string) {
  const { rows } = await tx.query<RideRow>(
    "SELECT * FROM mobility.rides WHERE id = $1 FOR UPDATE",
    [rideId],
  );
  return rows[0] ?? null;
}

const TIMESTAMP_FOR: Partial<Record<RideStatus, string>> = {
  requested: "requested_at",
  accepted: "accepted_at",
  arriving: "arriving_at",
  arrived: "arrived_at",
  in_progress: "started_at",
  completed: "completed_at",
  cancelled: "cancelled_at",
  no_driver: "cancelled_at",
  interrupted: "interrupted_at",
};

export async function transitionRide(
  tx: SqlClient,
  ride: RideRow,
  to: RideStatus,
  opts: {
    actor: Actor;
    actorUserId?: string | null;
    now: Date;
    reason?: string | null;
    set?: Record<string, unknown>;
  },
): Promise<RideRow> {
  if (!canTransition(ride.status, to, opts.actor)) {
    throw new ApiError(
      409,
      "INVALID_TRANSITION",
      `This ride can't move from ${ride.status} to ${to}.`,
    );
  }

  const set: Record<string, unknown> = { ...opts.set };
  if (to === "completed" && ride.payment_method === "in_vehicle") {
    set.collection_status = "pending";
  }
  const stamp = TIMESTAMP_FOR[to];
  if (stamp && !(stamp in set)) set[stamp] = opts.now;
  if (to === "cancelled" || to === "no_driver" || to === "interrupted") {
    set.cancelled_by = opts.actor;
    set.cancel_reason =
      opts.reason ?? (to === "no_driver" ? "no_driver" : null);
  }

  const columns = Object.keys(set);
  const assignments = columns.map((c, i) => `${c} = $${i + 3}`);
  const { rows } = await tx.query<RideRow>(
    `UPDATE mobility.rides
        SET status = $2, version = version + 1, updated_at = now()
            ${assignments.length ? ", " + assignments.join(", ") : ""}
      WHERE id = $1
      RETURNING *`,
    [ride.id, to, ...columns.map((c) => set[c])],
  );
  await tx.query(
    `INSERT INTO mobility.ride_events
       (ride_id, from_status, to_status, actor, actor_user_id, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      ride.id,
      ride.status,
      to,
      opts.actor,
      opts.actorUserId ?? null,
      opts.reason ?? null,
      opts.now,
    ],
  );
  await enqueueForTransition(tx, ride, rows[0], opts.actor, opts.now);
  return rows[0];
}
