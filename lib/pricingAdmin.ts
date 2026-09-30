import type { FarePolicyState } from "@/shared/adminPricing";

export function parseRate(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, "");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function centsToInput(cents: number) {
  return (cents / 100).toFixed(2);
}

export function parseEffectiveFrom(
  text: string,
  now = new Date(),
): string | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "now") return now.toISOString();
  const match = /^(\d{4})-(\d{2})-(\d{2})[ t](\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi
  ) {
    return null;
  }
  return date.toISOString();
}

export const POLICY_STATE_LABEL: Record<FarePolicyState, string> = {
  scheduled: "Scheduled",
  in_effect: "In effect",
  superseded: "Superseded",
  cancelled: "Cancelled",
};

export const DROPOFF_RULE_LABEL = {
  inside_area: "Destination must be inside the area",
  anywhere: "Destination can be anywhere reachable",
} as const;
