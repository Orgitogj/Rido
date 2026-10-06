import { formatCents } from "../shared/contracts";

import { ApiError } from "./errors";
import { PRE_PICKUP_STATUSES, type RideRow, transitionRide } from "./lifecycle";
import { offerToNextDriver } from "./matching";

import type { SqlClient } from "./db";
import type { CancellationPreview } from "../shared/contracts";

export const REMATCH = {
  maxRematches: 2,
  searchSeconds: 120,
} as const;

function inVehiclePreview(
  ride: RideRow,
  viewer: "passenger" | "driver",
): CancellationPreview | null {
  if (viewer === "passenger") {
    if (ride.status === "awaiting_payment") {
      return {
        action: "cancel",
        variant: "passenger_unpaid",
        title: "Cancel this request?",
        consequence:
          "No driver has been requested yet. There is nothing to pay and no cancellation fee.",
        feeCents: 0,
      };
    }
    if (ride.status === "requested" || ride.status === "offered") {
      return {
        action: "cancel",
        variant: "passenger_searching",
        title: "Cancel ride request?",
        consequence:
          "We'll stop looking for a driver. There is nothing to pay and no cancellation fee.",
        feeCents: 0,
      };
    }
    if (PRE_PICKUP_STATUSES.includes(ride.status)) {
      return {
        action: "cancel",
        variant: "passenger_assigned",
        title: "Cancel ride?",
        consequence:
          "Your driver will be told. There is nothing to pay and no cancellation fee.",
        feeCents: 0,
      };
    }
    return null;
  }
  if (PRE_PICKUP_STATUSES.includes(ride.status)) {
    return {
      action: "cancel",
      variant:
        ride.rematch_count < REMATCH.maxRematches
          ? "driver_rematch"
          : "driver_final",
      title: "Cancel this ride?",
      consequence:
        ride.rematch_count < REMATCH.maxRematches
          ? "We'll look for another driver for this passenger. You won't be offered this ride again."
          : "This passenger has already been re-matched the maximum number of times, so their request will end.",
      feeCents: 0,
    };
  }
  if (ride.status === "in_progress") {
    return {
      action: "interrupt",
      variant: "driver_interrupt",
      title: "End trip early?",
      consequence:
        "Only do this if the trip can't continue, for example for safety or a vehicle problem. The trip ends as interrupted: the passenger pays nothing, and the trip is flagged for review.",
      feeCents: 0,
    };
  }
  return null;
}

export function cancellationPreview(
  ride: RideRow,
  viewer: "passenger" | "driver",
): CancellationPreview | null {
  const hold = formatCents(ride.fare_cents);
  if (ride.payment_method === "in_vehicle") {
    return inVehiclePreview(ride, viewer);
  }
  if (viewer === "passenger") {
    if (ride.status === "awaiting_payment") {
      return {
        action: "cancel",
        variant: "passenger_unpaid",
        title: "Cancel this request?",
        consequence:
          "No driver has been requested yet. If a hold was placed on your card, it will be released. There is no cancellation fee.",
        feeCents: 0,
      };
    }
    if (ride.status === "requested" || ride.status === "offered") {
      return {
        action: "cancel",
        variant: "passenger_searching",
        title: "Cancel ride request?",
        consequence: `We'll stop looking for a driver and release the ${hold} hold on your card. There is no cancellation fee.`,
        feeCents: 0,
      };
    }
    if (PRE_PICKUP_STATUSES.includes(ride.status)) {
      return {
        action: "cancel",
        variant: "passenger_assigned",
        title: "Cancel ride?",
        consequence: `Your driver will be told. We'll release the ${hold} hold on your card. There is no cancellation fee.`,
        feeCents: 0,
      };
    }
    return null;
  }
  if (PRE_PICKUP_STATUSES.includes(ride.status)) {
    return {
      action: "cancel",
      variant:
        ride.rematch_count < REMATCH.maxRematches
          ? "driver_rematch"
          : "driver_final",
      title: "Cancel this ride?",
      consequence:
        ride.rematch_count < REMATCH.maxRematches
          ? "We'll look for another driver for this passenger. You won't be offered this ride again."
          : "This passenger has already been re-matched the maximum number of times, so their request will end and the hold on their card will be released.",
      feeCents: 0,
    };
  }
  if (ride.status === "in_progress") {
    return {
      action: "interrupt",
      variant: "driver_interrupt",
      title: "End trip early?",
      consequence:
        "Only do this if the trip can't continue, for example for safety or a vehicle problem. The trip ends as interrupted: the passenger is not charged, their hold is released, and the trip is flagged for review.",
      feeCents: 0,
    };
  }
  return null;
}

export async function passengerCancel(
  tx: SqlClient,
  ride: RideRow,
  userId: string,
  now: Date,
  reason?: string,
): Promise<RideRow> {
  if (ride.status === "cancelled" || ride.status === "no_driver") return ride;
  if (ride.status === "offered") {
    await tx.query(
      `UPDATE mobility.ride_offers SET status = 'cancelled', responded_at = $2
        WHERE ride_id = $1 AND status = 'pending'`,
      [ride.id, now],
    );
  }
  return transitionRide(tx, ride, "cancelled", {
    actor: "passenger",
    actorUserId: userId,
    now,
    reason: reason ?? "passenger_cancelled",
  });
}

export async function driverCancel(
  tx: SqlClient,
  ride: RideRow,
  userId: string,
  now: Date,
  reason?: string,
): Promise<RideRow> {
  if (!PRE_PICKUP_STATUSES.includes(ride.status)) {
    throw new ApiError(
      409,
      "INVALID_TRANSITION",
      ride.status === "in_progress"
        ? "The trip has started. End it early instead of cancelling."
        : "This ride can no longer be cancelled.",
    );
  }
  return releaseDriver(tx, ride, now, {
    actor: "driver",
    userId,
    reason: reason ?? "driver_cancelled",
    limitReason: "driver_cancelled_rematch_limit",
  });
}

export async function removeDriverForRematch(
  tx: SqlClient,
  ride: RideRow,
  now: Date,
  reason: string,
): Promise<RideRow> {
  if (!PRE_PICKUP_STATUSES.includes(ride.status)) return ride;
  return releaseDriver(tx, ride, now, {
    actor: "system",
    userId: null,
    reason,
    limitReason: `${reason}_rematch_limit`.slice(0, 40),
  });
}

async function releaseDriver(
  tx: SqlClient,
  ride: RideRow,
  now: Date,
  opts: {
    actor: "driver" | "system";
    userId: string | null;
    reason: string;
    limitReason: string;
  },
): Promise<RideRow> {
  await tx.query(
    `UPDATE mobility.ride_offers SET status = 'withdrawn', responded_at = $3
      WHERE ride_id = $1 AND driver_profile_id = $2 AND status = 'accepted'`,
    [ride.id, ride.driver_profile_id, now],
  );
  await tx.query("DELETE FROM mobility.ride_routes WHERE ride_id = $1", [
    ride.id,
  ]);

  if (ride.rematch_count >= REMATCH.maxRematches) {
    return transitionRide(tx, ride, "cancelled", {
      actor: opts.actor,
      actorUserId: opts.userId,
      now,
      reason: opts.limitReason,
    });
  }
  const searching = await transitionRide(tx, ride, "requested", {
    actor: opts.actor,
    actorUserId: opts.userId,
    now,
    reason: opts.reason,
    set: {
      driver_profile_id: null,
      rematch_count: ride.rematch_count + 1,
      requested_at: ride.requested_at,
      search_deadline: new Date(now.getTime() + REMATCH.searchSeconds * 1000),
      accepted_at: null,
      arriving_at: null,
      arrived_at: null,
    },
  });
  return offerToNextDriver(tx, searching, now);
}

export async function interruptTrip(
  tx: SqlClient,
  ride: RideRow,
  userId: string,
  now: Date,
  reason: string,
): Promise<RideRow> {
  if (ride.status === "interrupted") return ride;
  return transitionRide(tx, ride, "interrupted", {
    actor: "driver",
    actorUserId: userId,
    now,
    reason: `interrupted_${reason}`.slice(0, 40),
    set: { needs_review: true, review_reason: "interrupted_trip" },
  });
}
