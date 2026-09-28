import type {
  DriverEarningRide,
  EarningEntryKind,
  TipIneligibleReason,
  TipStatus,
} from "@/shared/contracts";

export type EarningsPeriod = "today" | "week" | "month" | "all";

export const PERIOD_LABEL: Record<EarningsPeriod, string> = {
  today: "Today",
  week: "Last 7 days",
  month: "Last 30 days",
  all: "All time",
};

export function periodRange(
  period: EarningsPeriod,
  now: Date,
): { from?: string; to?: string } {
  if (period === "all") return {};
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "week") start.setDate(start.getDate() - 6);
  if (period === "month") start.setDate(start.getDate() - 29);
  return { from: start.toISOString() };
}

export const ENTRY_LABEL: Record<EarningEntryKind, string> = {
  ride_earning: "Fare earned",
  tip: "Tip",
  fare_refund_adjustment: "Refund adjustment (fare)",
  tip_refund_adjustment: "Refund adjustment (tip)",
  dispute_withdrawal: "Payment disputed: funds withdrawn",
  dispute_reinstatement: "Dispute resolved: funds reinstated",
};

export const RIDE_STATE_LABEL: Record<DriverEarningRide["state"], string> = {
  confirmed: "Confirmed",
  pending: "Awaiting payment confirmation",
  not_charged: "Not charged",
};

export const TIP_STATUS_TEXT: Record<TipStatus, string> = {
  creating: "Starting payment…",
  pending: "Not paid yet",
  requires_action: "Waiting for your bank's verification",
  processing: "Processing",
  failed: "Payment declined",
  succeeded: "Paid",
  canceled: "Cancelled",
};

export const TIP_REASON_TEXT: Record<TipIneligibleReason, string | null> = {
  not_completed: null,
  simulated: null,
  no_driver: null,
  payment_pending: "You can add a tip once your fare payment is confirmed.",
  window_closed: "The time to add a tip for this trip has passed.",
  already_tipped: null,
};

export const formatRate = (bps: number | null) =>
  bps === null ? "—" : `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
