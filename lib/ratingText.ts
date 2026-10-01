import { translate, translateCount } from "@/lib/i18n/translate";

import type { Language } from "@/shared/account";
import type { RatingIneligibleReason, RatingSummary } from "@/shared/contracts";

export function formatRating(
  summary: RatingSummary | null,
  language: Language = "en",
): string {
  if (!summary || summary.count === 0)
    return translate(language, "rating.none");
  if (summary.average === null) {
    return translateCount(language, "rating.few", summary.count);
  }
  return translateCount(language, "rating.summary", summary.count, {
    average: summary.average.toFixed(1),
  });
}

export function ratingReasonText(
  reason: RatingIneligibleReason | null,
  language: Language = "en",
): string | null {
  if (reason === "payment_pending" || reason === "window_closed") {
    return translate(language, `rating.reason.${reason}`);
  }
  return null;
}

export function starLabel(stars: number, language: Language = "en") {
  const n = Math.min(5, Math.max(1, Math.round(stars))) as 1 | 2 | 3 | 4 | 5;
  return translate(language, `rating.label.s${n}`);
}
