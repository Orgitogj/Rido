import { locationUpdateSchema } from "../../shared/contracts";
import { type Deps, readJson } from "../http";
import { recordDriverLocation } from "../location";

import { currentUser, requireApprovedDriver } from "./driver";

export async function updateDriverLocation(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const profile = await requireApprovedDriver(deps, user);
  const input = await readJson(request, locationUpdateSchema);
  const result = await recordDriverLocation(
    deps.db,
    profile.id,
    input,
    deps.now(),
  );
  return Response.json({ data: result });
}
