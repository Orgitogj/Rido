import { ApiError } from "./errors";

import type { SqlClient } from "./db";

export const RATE_LIMITS = {
  placeWrites: { limit: 60, windowSeconds: 600 },
  profileWrites: { limit: 30, windowSeconds: 600 },
  uploadTickets: { limit: 30, windowSeconds: 600 },
  safetyReports: { limit: 10, windowSeconds: 3600 },
  supportRequests: { limit: 10, windowSeconds: 3600 },
  shareCreates: { limit: 20, windowSeconds: 3600 },
  shareViews: { limit: 120, windowSeconds: 60 },
  accountDeletion: { limit: 5, windowSeconds: 3600 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

const windowStart = (now: Date, seconds: number) =>
  new Date(Math.floor(now.getTime() / (seconds * 1000)) * seconds * 1000);

export async function allow(
  db: SqlClient,
  name: RateLimitName,
  subject: string,
  now: Date,
): Promise<boolean> {
  const rule = RATE_LIMITS[name];
  const { rows } = await db.query<{ count: number }>(
    `INSERT INTO mobility.rate_limits (key, window_start, count)
     VALUES ($1, $2, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [`${name}:${subject}`.slice(0, 120), windowStart(now, rule.windowSeconds)],
  );
  return rows[0].count <= rule.limit;
}

export async function enforceRateLimit(
  db: SqlClient,
  name: RateLimitName,
  subject: string,
  now: Date,
) {
  if (await allow(db, name, subject, now)) return;
  const rule = RATE_LIMITS[name];
  throw new ApiError(
    429,
    "RATE_LIMITED",
    "Too many requests. Please wait a moment and try again.",
    undefined,
    Math.max(
      1,
      Math.ceil(
        (windowStart(now, rule.windowSeconds).getTime() +
          rule.windowSeconds * 1000 -
          now.getTime()) /
          1000,
      ),
    ),
  );
}

export async function pruneRateLimits(db: SqlClient, now: Date) {
  await db.query("DELETE FROM mobility.rate_limits WHERE window_start < $1", [
    new Date(now.getTime() - 2 * 3600 * 1000),
  ]);
}
