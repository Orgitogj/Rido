import type {
  SafetyCategory,
  SafetyReportStatus,
  SharedTripStatus,
} from "@/shared/contracts";

export const SAFETY_CATEGORY_LABEL: Record<SafetyCategory, string> = {
  unsafe_driving: "Unsafe driving",
  harassment: "Harassment",
  vehicle_mismatch: "Vehicle doesn't match",
  accident: "Accident",
  other: "Something else",
};

export const SAFETY_STATUS_LABEL: Record<SafetyReportStatus, string> = {
  open: "Received",
  in_review: "Being reviewed",
  resolved: "Resolved",
  dismissed: "Closed",
};

export const SHARED_TRIP_TEXT: Record<SharedTripStatus, string> = {
  searching: "Looking for a driver",
  driver_on_the_way: "Driver on the way to pickup",
  driver_arrived: "Driver has arrived at pickup",
  in_progress: "On the way to the destination",
  completed: "Trip completed",
  ended: "Trip ended",
};

export const EMERGENCY_NOTICE =
  "This app does not contact emergency services. If you or someone else is in danger, call your local emergency number now.";

export function shareUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}
