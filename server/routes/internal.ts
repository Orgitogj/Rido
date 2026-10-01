import { timingSafeEqual } from "node:crypto";

import { requireEnv, unauthenticated } from "../errors";
import { type Deps } from "../http";
import { claimJob, finishJob, JOBS } from "../jobs";
import { sweep } from "../rides";

export async function runSweep(request: Request, _params: unknown, deps: Deps) {
  const secret = Buffer.from(`Bearer ${requireEnv("CRON_SECRET")}`);
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  if (given.length !== secret.length || !timingSafeEqual(given, secret)) {
    throw unauthenticated();
  }
  const started = deps.now();
  if (!(await claimJob(deps.db, "sweep", started, JOBS.sweepLeaseSeconds))) {
    return Response.json({
      data: { processed: 0, skipped: "already_running" },
    });
  }
  try {
    const processed = await sweep(deps, 100);
    await finishJob(deps.db, "sweep", deps.now(), null);
    return Response.json({ data: { processed } });
  } catch (e) {
    await finishJob(
      deps.db,
      "sweep",
      deps.now(),
      e instanceof Error ? e.message : "failed",
    );
    throw e;
  }
}
