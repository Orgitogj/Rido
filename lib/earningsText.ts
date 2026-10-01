import { sections } from "@/lib/i18n/sections";
import { translate } from "@/lib/i18n/translate";

import type { Language } from "@/shared/account";
import type { TipIneligibleReason, TipStatus } from "@/shared/contracts";

export type EarningsPeriod = "today" | "week" | "month" | "all";

export const EARNINGS_PERIODS: EarningsPeriod[] = [
  "today",
  "week",
  "month",
  "all",
];

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

export const TIP_STATUS_TEXT: Record<TipStatus, string> =
  sections.pay.en.tip.status;

export function tipReasonText(
  reason: TipIneligibleReason | null,
  language: Language = "en",
): string | null {
  if (reason === "payment_pending" || reason === "window_closed") {
    return translate(language, `pay.tip.reason.${reason}`);
  }
  return null;
}

export const formatRate = (bps: number | null) =>
  bps === null ? "—" : `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
