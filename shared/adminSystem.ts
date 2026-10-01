export interface SystemStatus {
  environment: "development" | "production";
  stripeMode: "test" | "live" | "unconfigured";
  config: {
    area: string;
    name: string;
    level: "required" | "recommended" | "optional";
    ok: boolean;
    note: string;
  }[];
  jobs: {
    name: string;
    lastStartedAt: string | null;
    lastOkAt: string | null;
    lastError: string | null;
    runs: number;
    failures: number;
  }[];
  queues: {
    notificationsPending: number;
    notificationsFailed: number;
    storageDeletionsDue: number;
    storageDeletionsFailing: number;
    accountDeletionsPending: number;
    accountDeletionsFailing: number;
    settlementsRetrying: number;
    ridesNeedingReview: number;
    routesThisMinute: number;
    matrixElementsThisMinute: number;
  };
}
