import { ratingSubmitSchema, rideIdSchema } from "../../shared/contracts";
import { type Deps, parseInput, readJson } from "../http";
import { submitRating } from "../ratings";
import { rideView } from "../rides";

import { currentUser, resolveViewer } from "./rides";

export async function getRating(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const { rideId, viewer } = await resolveViewer(deps, user, params.id);
  const view = await rideView(deps.db, rideId, viewer, deps.now());
  return Response.json({
    data: { rating: view.rating, counterpartRating: view.counterpartRating },
  });
}

export async function rateRide(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(rideIdSchema, params.id);
  const input = await readJson(request, ratingSubmitSchema);
  const { state, created } = await submitRating(deps, user.id, rideId, input);
  return Response.json({ data: state }, { status: created ? 201 : 200 });
}
