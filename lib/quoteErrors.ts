import { sections } from "@/lib/i18n/sections";
import { errorText, translate } from "@/lib/i18n/translate";

import type { Language } from "@/shared/account";

export interface QuoteProblem {
  code: string | null;
  title: string;
  message: string;
  retry: boolean;
  changeLocations: boolean;
}

type KnownCode = Exclude<
  keyof typeof sections.booking.en.confirm.problemTitle,
  "fallback"
>;

const PROBLEMS: Record<
  KnownCode,
  { retry: boolean; changeLocations: boolean }
> = {
  PICKUP_OUTSIDE_SERVICE_AREA: { retry: false, changeLocations: true },
  DESTINATION_OUTSIDE_SERVICE_AREA: { retry: false, changeLocations: true },
  NO_ROUTE: { retry: false, changeLocations: true },
  TRIP_TOO_SHORT: { retry: false, changeLocations: true },
  TRIP_TOO_LONG: { retry: false, changeLocations: true },
  ROUTING_UNAVAILABLE: { retry: true, changeLocations: false },
  ROUTING_BUSY: { retry: true, changeLocations: false },
  RATE_LIMITED: { retry: true, changeLocations: false },
  ROUTING_NOT_CONFIGURED: { retry: false, changeLocations: false },
  PRICING_NOT_CONFIGURED: { retry: false, changeLocations: false },
  NETWORK: { retry: true, changeLocations: false },
};

const isKnown = (code: string | null): code is KnownCode =>
  code !== null && code in PROBLEMS;

export function quoteProblem(
  code: string | null,
  message: string,
  language: Language = "en",
): QuoteProblem {
  const known = isKnown(code) ? code : null;
  return {
    code,
    title: translate(
      language,
      `booking.confirm.problemTitle.${known ?? "fallback"}`,
    ),
    message: language === "en" ? message : errorText(language, code ?? ""),
    retry: known ? PROBLEMS[known].retry : true,
    changeLocations: known ? PROBLEMS[known].changeLocations : false,
  };
}

export function coverageProblem(code: string | null) {
  return (
    code === "PICKUP_OUTSIDE_SERVICE_AREA" ||
    code === "DESTINATION_OUTSIDE_SERVICE_AREA"
  );
}

export function formatDistance(meters: number) {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export function priceHeldUntil(expiresAt: string, now = new Date()) {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return Math.max(0, Math.floor(ms / 60_000));
}

export function secondsUntil(expiresAt: string, nowMs: number) {
  const ms = new Date(expiresAt).getTime() - nowMs;
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
}
