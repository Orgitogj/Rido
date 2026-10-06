import { coordinatesSchema, rideIdSchema } from "../../shared/contracts";
import { scheduleCreateSchema } from "../../shared/schedule";
import { passengerCancel } from "../cancellation";
import { type Deps, parseInput, readJson } from "../http";
import { enforceRateLimit } from "../rateLimit";
import { settlePayment, withLockedRide } from "../rides";
import {
  cancelScheduledRide,
  createScheduledRide,
  getScheduledRide,
  listScheduledRides,
  quoteScheduledRide,
  scheduleWindow,
} from "../scheduled";
import { ensureUser } from "../users";

const me = async (request: Request, deps: Deps) =>
  ensureUser(deps.db, await deps.authenticate(request));

export async function listSchedules(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await me(request, deps);
  return Response.json({
    data: await listScheduledRides(deps.db, user.id, deps.now()),
  });
}

export async function getScheduleWindow(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  await me(request, deps);
  const url = new URL(request.url);
  const pickup = parseInput(coordinatesSchema, {
    latitude: Number(url.searchParams.get("latitude")),
    longitude: Number(url.searchParams.get("longitude")),
  });
  return Response.json({ data: await scheduleWindow(deps, pickup) });
}

export async function createSchedule(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await me(request, deps);
  const input = await readJson(request, scheduleCreateSchema);
  await enforceRateLimit(deps.db, "scheduleWrites", user.id, deps.now());
  const { view, created } = await createScheduledRide(deps, user.id, input);
  return Response.json({ data: view }, { status: created ? 201 : 200 });
}

export async function getSchedule(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await me(request, deps);
  const id = parseInput(rideIdSchema, params.id);
  return Response.json({
    data: await getScheduledRide(deps.db, user.id, id, deps.now()),
  });
}

export async function cancelSchedule(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await me(request, deps);
  const id = parseInput(rideIdSchema, params.id);
  const { rideToCancel } = await cancelScheduledRide(deps, user.id, id);
  if (rideToCancel) {
    const ride = await withLockedRide(deps, rideToCancel, (tx, ride) =>
      ride.user_id === user.id && ride.status === "awaiting_payment"
        ? passengerCancel(tx, ride, user.id, deps.now(), "schedule_cancelled")
        : Promise.resolve(ride),
    );
    await settlePayment(deps, ride, { force: true });
  }
  return Response.json({
    data: await getScheduledRide(deps.db, user.id, id, deps.now()),
  });
}

export async function quoteSchedule(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await me(request, deps);
  const id = parseInput(rideIdSchema, params.id);
  const { body, created } = await quoteScheduledRide(deps, user.id, id);
  return Response.json({ data: body }, { status: created ? 201 : 200 });
}
