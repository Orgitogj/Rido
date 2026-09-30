import type { SqlClient } from "./db";

export type RoutingApi = "routes" | "route_matrix";

export const ROUTING_BUDGET = {
  routesPerMinute: 120,
  matrixElementsPerMinute: 300,
  retentionMinutes: 60,
} as const;

export function routingLimits(
  env: Record<string, string | undefined> = process.env,
) {
  const read = (name: string, fallback: number) => {
    const value = Number(env[name]);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  };
  return {
    routes: read(
      "ROUTES_MAX_REQUESTS_PER_MINUTE",
      ROUTING_BUDGET.routesPerMinute,
    ),
    route_matrix: read(
      "ROUTES_MAX_MATRIX_ELEMENTS_PER_MINUTE",
      ROUTING_BUDGET.matrixElementsPerMinute,
    ),
  } satisfies Record<RoutingApi, number>;
}

const minuteOf = (now: Date) => {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  return d;
};

export async function reserveRouting(
  db: SqlClient,
  api: RoutingApi,
  units: number,
  now: Date,
  limits = routingLimits(),
): Promise<boolean> {
  if (units <= 0) return true;
  const limit = limits[api];
  if (units > limit) return false;
  const { rows } = await db.query<{ units: number }>(
    `INSERT INTO mobility.routing_usage (api, minute, units)
     VALUES ($1, $2, $3)
     ON CONFLICT (api, minute) DO UPDATE
        SET units = routing_usage.units + EXCLUDED.units
      WHERE routing_usage.units + EXCLUDED.units <= $4
     RETURNING units`,
    [api, minuteOf(now), units, limit],
  );
  return rows.length > 0;
}

export async function pruneRoutingUsage(db: SqlClient, now: Date) {
  await db.query("DELETE FROM mobility.routing_usage WHERE minute < $1", [
    new Date(now.getTime() - ROUTING_BUDGET.retentionMinutes * 60_000),
  ]);
}
