import { timingSafeEqual } from "node:crypto";

import { requireEnv, unauthenticated } from "../errors";
import { type Deps } from "../http";
import { sweep } from "../rides";

export async function runSweep(request: Request, _params: unknown, deps: Deps) {
  const secret = Buffer.from(`Bearer ${requireEnv("CRON_SECRET")}`);
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  if (given.length !== secret.length || !timingSafeEqual(given, secret)) {
    throw unauthenticated();
  }
  const processed = await sweep(deps, 100);
  return Response.json({ data: { processed } });
}
