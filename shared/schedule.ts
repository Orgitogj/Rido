import { z } from "zod";

import { placeSchema, type Place, type RideStatus } from "./contracts";

export const SCHEDULE_RULES = {
  minLeadMinutes: 30,
  maxDays: 7,
  confirmLeadMinutes: 20,
  confirmGraceMinutes: 10,
  maxUpcoming: 5,
} as const;

export const scheduleCreateSchema = z.strictObject({
  pickup: placeSchema,
  destination: placeSchema,
  stops: z.array(placeSchema).max(2).optional(),
  categoryId: z.uuid().optional(),
  passengerCount: z.number().int().min(1).max(8).optional(),
  localTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  fold: z.enum(["earlier", "later"]).optional(),
  clientRequestId: z.uuid(),
});

export type ScheduledState =
  | "scheduled"
  | "awaiting_confirmation"
  | "searching"
  | "fulfilled"
  | "no_driver"
  | "cancelled"
  | "expired";

export type ScheduleEndReason =
  | "cancelled_by_passenger"
  | "not_confirmed"
  | "missed_window"
  | "area_unavailable"
  | "category_unavailable"
  | "account_closed";

export interface ScheduledRideView {
  id: string;
  state: ScheduledState;
  pickup: Place;
  destination: Place;
  stops: Place[];
  category: { id: string; name: string } | null;
  passengerCount: number;
  timezone: string;
  localTime: string;
  pickupAt: string;
  confirmFrom: string;
  confirmBy: string;
  rideId: string | null;
  rideStatus: RideStatus | null;
  endReason: ScheduleEndReason | null;
  canCancel: boolean;
  canConfirm: boolean;
  createdAt: string;
  serverTime: string;
}

export interface ScheduledRideList {
  upcoming: ScheduledRideView[];
  past: ScheduledRideView[];
  limits: {
    minLeadMinutes: number;
    maxDays: number;
    confirmLeadMinutes: number;
    confirmGraceMinutes: number;
    maxUpcoming: number;
  };
}

export interface ScheduleAreaInfo {
  timezone: string;
  localNow: string;
  earliestLocal: string;
  latestLocal: string;
}
