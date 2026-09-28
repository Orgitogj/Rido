import { rideIdSchema, tipCreateSchema } from "../../shared/contracts";
import { type Deps, parseInput, readJson } from "../http";
import { cancelTip, refreshTip, startTip, tipState } from "../tips";

import { currentUser, ensureStripeCustomer } from "./rides";

export async function getTip(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(rideIdSchema, params.id);
  return Response.json({
    data: await tipState(deps.db, user.id, rideId, deps.now()),
  });
}

export async function createTip(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(rideIdSchema, params.id);
  const input = await readJson(request, tipCreateSchema);
  const checkout = await startTip(deps, user.id, rideId, input, () =>
    ensureStripeCustomer(deps, user),
  );
  return Response.json({ data: checkout });
}

export async function refreshTipPayment(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(rideIdSchema, params.id);
  await refreshTip(deps, user.id, rideId);
  return Response.json({
    data: await tipState(deps.db, user.id, rideId, deps.now()),
  });
}

export async function cancelTipPayment(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(rideIdSchema, params.id);
  await cancelTip(deps, user.id, rideId);
  return Response.json({
    data: await tipState(deps.db, user.id, rideId, deps.now()),
  });
}
