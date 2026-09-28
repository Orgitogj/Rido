import type { RatingIneligibleReason, RatingSummary } from "@/shared/contracts";

export function formatRating(summary: RatingSummary | null): string {
  if (!summary || summary.count === 0) return "New · no ratings yet";
  if (summary.average === null) {
    return `New · ${summary.count} rating${summary.count === 1 ? "" : "s"}`;
  }
  return `${summary.average.toFixed(1)} ★ · ${summary.count} ratings`;
}

export const RATING_REASON_TEXT: Record<RatingIneligibleReason, string | null> =
  {
    not_completed: null,
    simulated: null,
    no_counterpart: null,
    payment_pending: "You can rate this trip once the payment is confirmed.",
    window_closed: "The rating period for this trip has ended.",
  };

export const STAR_LABELS = ["Poor", "Fair", "Good", "Great", "Excellent"];
