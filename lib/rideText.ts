import { type TKey, translate } from "@/lib/i18n/translate";

import type { Language } from "@/shared/account";
import type {
  CancellationPreview,
  PaymentStatus,
  RideAction,
  RideStatus,
  RideView,
  SettlementState,
} from "@/shared/contracts";

export type BadgeTone = "success" | "neutral" | "active" | "warning";

const TONES: Record<RideStatus, BadgeTone> = {
  awaiting_payment: "warning",
  requested: "active",
  offered: "active",
  accepted: "active",
  arriving: "active",
  arrived: "active",
  in_progress: "active",
  completed: "success",
  cancelled: "neutral",
  no_driver: "neutral",
  interrupted: "warning",
  legacy: "neutral",
};

export const statusTone = (status: RideStatus) => TONES[status];

export const statusLabel = (status: RideStatus, language: Language = "en") =>
  translate(language, `ride.status.${status}`);

export const actionLabel = (action: RideAction, language: Language = "en") =>
  translate(language, `ride.action.${action}`);

export const STATUS_BADGE = Object.fromEntries(
  (Object.keys(TONES) as RideStatus[]).map((status) => [
    status,
    { label: statusLabel(status), tone: TONES[status] },
  ]),
) as Record<RideStatus, { label: string; tone: BadgeTone }>;

export const ACTION_LABEL = Object.fromEntries(
  (
    [
      "arriving",
      "arrived",
      "in_progress",
      "completed",
      "cancel",
      "interrupt",
      "stop_reached",
    ] as RideAction[]
  ).map((action) => [action, actionLabel(action)]),
) as Record<RideAction, string>;

export const isTerminal = (status: RideStatus) =>
  status === "completed" ||
  status === "cancelled" ||
  status === "no_driver" ||
  status === "interrupted" ||
  status === "legacy";

export function rideHeadline(
  ride: RideView,
  language: Language = "en",
): string {
  const h = (key: string, params?: Record<string, string>) =>
    translate(language, `ride.headline.${key}` as TKey, params);
  const driver = ride.driver?.name ?? h("yourDriver");
  if (ride.viewer === "driver") {
    switch (ride.status) {
      case "accepted":
        return h("driverAccepted");
      case "arriving":
        return h("driverArriving");
      case "arrived":
        return h("driverArrived");
      case "in_progress":
        return ride.stopsCompleted < ride.stops.length
          ? h("driverToStop", { number: String(ride.stopsCompleted + 1) })
          : h("driverInProgress");
      case "completed":
        return h("driverCompleted");
      case "cancelled":
        return ride.cancelledBy === "driver"
          ? h("driverCancelledSelf")
          : h("driverCancelledOther");
      case "interrupted":
        return h("driverInterrupted");
      default:
        return statusLabel(ride.status, language);
    }
  }
  switch (ride.status) {
    case "awaiting_payment":
      return h("awaitingPayment");
    case "requested":
    case "offered":
      return ride.rematchCount > 0 ? h("rematching") : h("searching");
    case "accepted":
      return h("accepted", { driver });
    case "arriving":
      return h("arriving", { driver });
    case "arrived":
      return h("arrived", { driver });
    case "in_progress":
      return h("inProgress");
    case "completed":
      return h("completed");
    case "cancelled":
      return ride.cancelledBy === "driver"
        ? h("cancelledByDriver")
        : ride.cancelledBy === "system"
          ? h("cancelledBySystem")
          : h("cancelledBySelf");
    case "no_driver":
      return h("noDriver");
    case "interrupted":
      return h("interrupted");
    case "legacy":
      return h("legacy");
  }
}

export function paymentNote(
  status: PaymentStatus,
  rideStatus: RideStatus,
  settlement: SettlementState = "none",
  language: Language = "en",
): string {
  const p = (key: string) => translate(language, `ride.payment.${key}` as TKey);
  const ended =
    rideStatus === "cancelled" ||
    rideStatus === "no_driver" ||
    rideStatus === "interrupted";
  const delay =
    settlement === "retrying" || settlement === "needs_review"
      ? ` ${p("slow")}`
      : "";
  switch (status) {
    case "authorized":
      if (rideStatus === "completed") return `${p("finalizing")}${delay}`;
      if (ended) return `${p("releasing")}${delay}`;
      return p("hold");
    case "paid":
      return p("paid");
    case "cancelled":
      return p("released");
    case "expired":
      return p("expired");
    case "failed":
      return p("failed");
    case "requires_action":
      return p("requiresAction");
    case "processing":
      return p("processing");
    case "pending":
      return p("pending");
  }
}

export function cancellationText(
  preview: CancellationPreview,
  hold: string,
  language: Language = "en",
  inVehicle = false,
) {
  if (!preview.variant) {
    return { title: preview.title, body: preview.consequence };
  }
  return {
    title: translate(language, `ride.cancel.${preview.variant}_title`),
    body: inVehicle
      ? translate(language, `ride.cancel.${preview.variant}_body_vehicle`)
      : translate(language, `ride.cancel.${preview.variant}_body`, { hold }),
  };
}

export function vehiclePaymentNote(
  ride: Pick<RideView, "status" | "collection">,
  language: Language = "en",
): string {
  const p = (key: string) => translate(language, `ride.payment.${key}` as TKey);
  if (ride.collection) {
    if (ride.collection.status === "pending") return p("collectionPending");
    if (ride.collection.status === "unpaid") return p("unpaid");
    if (ride.collection.status === "waived") return p("waived");
    return ride.collection.method === "cash" ? p("paidCash") : p("paidPos");
  }
  if (
    ride.status === "cancelled" ||
    ride.status === "no_driver" ||
    ride.status === "interrupted"
  ) {
    return p("nothingDue");
  }
  return p("payInVehicle");
}
