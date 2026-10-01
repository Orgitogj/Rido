import type { Database } from "./db";

export const JOBS = {
  sweepLeaseSeconds: 120,
} as const;

export async function claimJob(
  db: Database,
  name: string,
  now: Date,
  leaseSeconds: number,
): Promise<boolean> {
  const { rows } = await db.query(
    `INSERT INTO mobility.job_status (name, lease_until, last_started_at, runs)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (name) DO UPDATE
        SET lease_until = EXCLUDED.lease_until, last_started_at = EXCLUDED.last_started_at,
            runs = job_status.runs + 1
      WHERE job_status.lease_until IS NULL OR job_status.lease_until <= $3
     RETURNING name`,
    [name, new Date(now.getTime() + leaseSeconds * 1000), now],
  );
  return rows.length > 0;
}

export async function finishJob(
  db: Database,
  name: string,
  now: Date,
  error: string | null,
) {
  await db.query(
    `UPDATE mobility.job_status
        SET lease_until = NULL, last_finished_at = $2,
            last_ok_at = CASE WHEN $3::varchar IS NULL THEN $2 ELSE last_ok_at END,
            last_error = $3,
            failures = failures + CASE WHEN $3::varchar IS NULL THEN 0 ELSE 1 END
      WHERE name = $1`,
    [name, now, error ? error.slice(0, 200) : null],
  );
}

export async function recordStep(
  db: Database,
  name: string,
  now: Date,
  run: () => Promise<unknown>,
) {
  let error: string | null = null;
  try {
    await run();
  } catch (e) {
    error = e instanceof Error ? e.message : "failed";
  }
  await db
    .query(
      `INSERT INTO mobility.job_status (name, last_started_at, last_finished_at, last_ok_at, last_error, runs, failures)
       VALUES ($1, $2, $2, CASE WHEN $3::varchar IS NULL THEN $2::timestamptz END, $3, 1,
               CASE WHEN $3::varchar IS NULL THEN 0 ELSE 1 END)
       ON CONFLICT (name) DO UPDATE
          SET last_started_at = $2, last_finished_at = $2,
              last_ok_at = CASE WHEN $3::varchar IS NULL THEN $2 ELSE job_status.last_ok_at END,
              last_error = $3, runs = job_status.runs + 1,
              failures = job_status.failures + CASE WHEN $3::varchar IS NULL THEN 0 ELSE 1 END`,
      [name, now, error ? error.slice(0, 200) : null],
    )
    .catch(() => undefined);
  return error;
}
