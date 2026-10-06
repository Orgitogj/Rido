import { z } from "zod";

import type { Currency } from "./currency";

export const DASHBOARD_RULES = {
  maxRangeDays: 92,
  cacheSeconds: 15,
  timezone: "UTC",
} as const;

const isoDate = z.iso.datetime({ offset: true });

export const dashboardQuerySchema = z.strictObject({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const activeRideStatuses = [
  "awaiting_payment",
  "requested",
  "offered",
  "accepted",
  "arriving",
  "arrived",
  "in_progress",
] as const;
export type ActiveRideStatus = (typeof activeRideStatuses)[number];

export interface DashboardLive {
  activeByStatus: Record<ActiveRideStatus, number>;
  searching: {
    count: number;
    oldestSeconds: number | null;
    averageSeconds: number | null;
  };
  drivers: { approvedOnline: number; eligibleAvailable: number };
  settlement: {
    capturesAwaiting: number;
    releasesAwaiting: number;
    retrying: number;
  };
  queues: {
    supportOpen: number;
    supportAwaitingReply: number;
    safetyOpen: number | null;
    driverApplications: number | null;
    reviewOpen: number;
    financialIssues: number;
    disputesOpen: number;
  };
  scheduled: { upcoming: number; awaitingConfirmation: number };
}

export interface DashboardPeriod {
  requests: {
    total: number;
    completed: number;
    cancelledByPassenger: number;
    cancelledByDriver: number;
    cancelledBySystem: number;
    noDriver: number;
    interrupted: number;
    stillActive: number;
    cancellationRate: number | null;
    noDriverRate: number | null;
  };
  search: { accepted: number; averageSecondsToAccept: number | null };
  money: {
    currency: Currency;
    faresCapturedCents: number;
    tipsCapturedCents: number;
    refundedCents: number;
    ledgerDriverEarningsCents: number;
    ledgerCommissionCents: number;
    payouts: { available: false; paidOutCents: 0 };
  };
  scheduled: { created: number; expired: number };
}

export type DashboardSection = "live" | "period";

export interface DashboardView {
  from: string;
  to: string;
  timezone: "UTC";
  generatedAt: string;
  cacheSeconds: number;
  live: DashboardLive | null;
  period: DashboardPeriod | null;
  unavailable: DashboardSection[];
}
