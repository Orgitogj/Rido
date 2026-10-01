import { sections } from "@/lib/i18n/sections";

import type {
  SafetyCategory,
  SafetyReportStatus,
  SharedTripStatus,
} from "@/shared/contracts";

export const SAFETY_CATEGORY_LABEL: Record<SafetyCategory, string> =
  sections.safety.en.category;

export const SAFETY_STATUS_LABEL: Record<SafetyReportStatus, string> =
  sections.safety.en.status;

export const SHARED_TRIP_TEXT: Record<SharedTripStatus, string> =
  sections.safety.en.shared.status;

export const EMERGENCY_NOTICE = sections.safety.en.emergency;

export function shareUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}
