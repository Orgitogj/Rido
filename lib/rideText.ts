import type {
  PaymentStatus,
  SettlementState,
  RideAction,
  RideStatus,
  RideView,
} from "@/shared/contracts";

export type BadgeTone = "success" | "neutral" | "active" | "warning";

export const STATUS_BADGE: Record<
  RideStatus,
  { label: string; tone: BadgeTone }
> = {
  awaiting_payment: { label: "Awaiting payment", tone: "warning" },
  requested: { label: "Finding driver", tone: "active" },
  offered: { label: "Finding driver", tone: "active" },
  accepted: { label: "Driver assigned", tone: "active" },
  arriving: { label: "Driver on the way", tone: "active" },
  arrived: { label: "Driver arrived", tone: "active" },
  in_progress: { label: "On trip", tone: "active" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  no_driver: { label: "No driver found", tone: "neutral" },
  interrupted: { label: "Ended early", tone: "warning" },
  legacy: { label: "Demo booking", tone: "neutral" },
};

export const ACTION_LABEL: Record<RideAction, string> = {
  arriving: "Start driving to pickup",
  arrived: "I've arrived at pickup",
  in_progress: "Start trip",
  completed: "Complete trip",
  cancel: "Cancel ride",
  interrupt: "End trip early",
};

export const isTerminal = (status: RideStatus) =>
  status === "completed" ||
  status === "cancelled" ||
  status === "no_driver" ||
  status === "interrupted" ||
  status === "legacy";

export function rideHeadline(ride: RideView): string {
  const driver = ride.driver?.name ?? "Your driver";
  if (ride.viewer === "driver") {
    switch (ride.status) {
      case "accepted":
        return "Ride accepted. Head to the pickup when ready.";
      case "arriving":
        return "Driving to pickup";
      case "arrived":
        return "Waiting for your passenger";
      case "in_progress":
        return "On trip to destination";
      case "completed":
        return "Trip completed";
      case "cancelled":
        return ride.cancelledBy === "driver"
          ? "You cancelled this ride"
          : "The passenger cancelled this ride";
      case "interrupted":
        return "You ended this trip early";
      default:
        return STATUS_BADGE[ride.status].label;
    }
  }
  switch (ride.status) {
    case "awaiting_payment":
      return "Confirming your payment…";
    case "requested":
    case "offered":
      return ride.rematchCount > 0
        ? "Your driver cancelled. Finding you another driver…"
        : "Finding you a driver…";
    case "accepted":
      return `${driver} accepted your ride`;
    case "arriving":
      return `${driver} is on the way`;
    case "arrived":
      return `${driver} has arrived at the pickup`;
    case "in_progress":
      return "On your way";
    case "completed":
      return "You've arrived";
    case "cancelled":
      return ride.cancelledBy === "driver"
        ? "Your driver cancelled this ride"
        : ride.cancelledBy === "system"
          ? "This request expired"
          : "You cancelled this ride";
    case "no_driver":
      return "No drivers were available";
    case "interrupted":
      return "Your driver ended the trip early";
    case "legacy":
      return "Demo booking (simulated driver)";
  }
}

export function paymentNote(
  status: PaymentStatus,
  rideStatus: RideStatus,
  settlement: SettlementState = "none",
): string {
  const ended =
    rideStatus === "cancelled" ||
    rideStatus === "no_driver" ||
    rideStatus === "interrupted";
  const delay =
    settlement === "retrying" || settlement === "needs_review"
      ? " Our payment provider is responding slowly; we'll keep retrying automatically."
      : "";
  switch (status) {
    case "authorized":
      if (rideStatus === "completed") return `Finalizing your charge…${delay}`;
      if (ended) {
        return `The hold on your card is being released. It is not a charge.${delay}`;
      }
      return "Your card has a hold for this fare. You're charged only when the trip is completed.";
    case "paid":
      return "Charged to your card. See the receipt for details.";
    case "cancelled":
      return "The hold on your card was released. You were not charged.";
    case "expired":
      return "The card authorization expired. You were not charged.";
    case "failed":
      return "The card was declined. No payment was taken.";
    case "requires_action":
      return "Your bank needs additional verification.";
    case "processing":
      return "Your bank is processing the payment.";
    case "pending":
      return "No payment has been taken.";
  }
}
