import {
  checkConfig,
  configReady,
  environmentOf,
  stripeModeOf,
} from "../config";
import { type Deps } from "../http";
import { requireOperator } from "../operators";

import type { SystemStatus } from "../../shared/adminSystem";

export const SCHEMA_MARKER = "mobility.job_status";

export async function health() {
  return Response.json({ data: { status: "ok" } });
}

export async function readiness(
  _request: Request,
  _params: unknown,
  deps: Deps,
) {
  let database = false;
  let schema = false;
  try {
    const { rows } = await deps.db.query<{ present: boolean }>(
      "SELECT to_regclass($1) IS NOT NULL AS present",
      [SCHEMA_MARKER],
    );
    database = true;
    schema = rows[0].present;
  } catch {
    database = false;
  }
  const configuration = configReady();
  const ready = database && schema && configuration;
  return Response.json(
    {
      data: {
        status: ready ? "ready" : "not_ready",
        checks: { database, schema, configuration },
      },
    },
    { status: ready ? 200 : 503 },
  );
}

export async function systemStatus(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  await requireOperator(request, deps, "view", {
    type: "console",
    id: null,
    action: "system_status",
  });
  const now = deps.now();
  const one = async (sql: string, values: unknown[] = []) =>
    (await deps.db.query<{ n: number }>(sql, values)).rows[0].n;
  const { rows: jobs } = await deps.db.query<{
    name: string;
    last_started_at: Date | null;
    last_ok_at: Date | null;
    last_error: string | null;
    runs: string;
    failures: string;
  }>(
    `SELECT name, last_started_at, last_ok_at, last_error, runs, failures
       FROM mobility.job_status ORDER BY name`,
  );
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  const minute = new Date(now);
  minute.setUTCSeconds(0, 0);
  const { rows: usage } = await deps.db.query<{ api: string; units: number }>(
    "SELECT api, units FROM mobility.routing_usage WHERE minute = $1",
    [minute],
  );
  const body: SystemStatus = {
    environment: environmentOf(),
    stripeMode: stripeModeOf(),
    config: checkConfig().map(({ area, name, level, ok, note }) => ({
      area,
      name,
      level,
      ok,
      note,
    })),
    jobs: jobs.map((j) => ({
      name: j.name,
      lastStartedAt: iso(j.last_started_at),
      lastOkAt: iso(j.last_ok_at),
      lastError: j.last_error,
      runs: Number(j.runs),
      failures: Number(j.failures),
    })),
    queues: {
      notificationsPending: await one(
        "SELECT count(*)::int AS n FROM mobility.notifications WHERE status IN ('pending', 'sending')",
      ),
      notificationsFailed: await one(
        "SELECT count(*)::int AS n FROM mobility.notifications WHERE status = 'failed' AND created_at > $1",
        [new Date(now.getTime() - 24 * 3600 * 1000)],
      ),
      storageDeletionsDue: await one(
        "SELECT count(*)::int AS n FROM mobility.storage_deletions WHERE not_before <= $1",
        [now],
      ),
      storageDeletionsFailing: await one(
        "SELECT count(*)::int AS n FROM mobility.storage_deletions WHERE attempts > 0",
      ),
      accountDeletionsPending: await one(
        "SELECT count(*)::int AS n FROM mobility.account_deletions WHERE completed_at IS NULL",
      ),
      accountDeletionsFailing: await one(
        "SELECT count(*)::int AS n FROM mobility.account_deletions WHERE completed_at IS NULL AND attempts > 1",
      ),
      settlementsRetrying: await one(
        "SELECT count(*)::int AS n FROM mobility.rides WHERE settled_at IS NULL AND settlement_attempts > 0",
      ),
      ridesNeedingReview: await one(
        "SELECT count(*)::int AS n FROM mobility.rides WHERE needs_review",
      ),
      routesThisMinute: usage.find((u) => u.api === "routes")?.units ?? 0,
      matrixElementsThisMinute:
        usage.find((u) => u.api === "route_matrix")?.units ?? 0,
    },
  };
  return Response.json({ data: body });
}
