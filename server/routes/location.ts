import { locationUpdateSchema } from "../../shared/contracts";
import { type Deps, readJson } from "../http";
import { ASSIGNED_STATUSES } from "../lifecycle";
import { recordDriverLocation } from "../location";

import {
  currentUser,
  requireApprovedDriver,
  requireDriverProfile,
} from "./driver";

export async function updateDriverLocation(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const profile = await requireDriverProfile(deps, user);
  const { rows: active } = await deps.db.query(
    `SELECT 1 FROM mobility.rides
      WHERE driver_profile_id = $1 AND status = ANY($2::text[])`,
    [profile.id, ASSIGNED_STATUSES],
  );
  if (active.length === 0) await requireApprovedDriver(deps, user);
  const input = await readJson(request, locationUpdateSchema);
  const result = await recordDriverLocation(
    deps.db,
    profile.id,
    input,
    deps.now(),
  );
  return Response.json({ data: result });
}
