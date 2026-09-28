import { watchQuerySchema, type WatchResponse } from "../../shared/contracts";
import { type Deps, parseInput } from "../http";
import { ASSIGNED_STATUSES, type RideRow } from "../lifecycle";
import { liveTrip } from "../live";
import { advanceRideById, rideView } from "../rides";

import { currentUser, resolveViewer } from "./rides";

export const WATCH = {
  checkEveryMs: 1000,
  advanceEveryMs: 5000,
} as const;

interface Probe {
  version: number;
  status: RideRow["status"];
  location_seq: string | null;
  chat_seq: number;
}

export async function watchRide(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const { rideId, viewer } = await resolveViewer(deps, user, params.id);
  const query = parseInput(
    watchQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams),
  );

  const deadline = deps.now().getTime() + query.wait * 1000;
  let lastAdvance = -Infinity;
  let rideChanged = false;
  let liveChanged = false;
  let chatChanged = false;

  for (;;) {
    const now = deps.now().getTime();
    if (now - lastAdvance >= WATCH.advanceEveryMs) {
      await advanceRideById(deps, rideId);
      lastAdvance = now;
    }
    const { rows } = await deps.db.query<Probe>(
      `SELECT r.version, r.status, dp.location_seq, COALESCE(c.last_seq, 0) AS chat_seq
         FROM mobility.rides r
         LEFT JOIN mobility.driver_profiles dp ON dp.id = r.driver_profile_id
         LEFT JOIN mobility.ride_chats c ON c.ride_id = r.id
        WHERE r.id = $1`,
      [rideId],
    );
    const probe = rows[0];
    rideChanged = probe.version !== query.version;
    liveChanged =
      ASSIGNED_STATUSES.includes(probe.status) &&
      Number(probe.location_seq ?? 0) > query.locationSeq;
    chatChanged =
      query.chatSeq !== undefined && Number(probe.chat_seq) > query.chatSeq;
    if (
      rideChanged ||
      liveChanged ||
      chatChanged ||
      deps.now().getTime() >= deadline
    )
      break;
    await deps.sleep(WATCH.checkEveryMs);
  }

  const now = deps.now();
  if (!rideChanged && !liveChanged && !chatChanged) {
    const body: WatchResponse = {
      changed: false,
      ride: null,
      live: null,
      serverTime: now.toISOString(),
    };
    return Response.json({ data: body });
  }

  const { rows } = await deps.db.query<RideRow>(
    "SELECT * FROM mobility.rides WHERE id = $1",
    [rideId],
  );
  const body: WatchResponse = {
    changed: true,
    ride:
      rideChanged || chatChanged
        ? await rideView(deps.db, rideId, viewer, now)
        : null,
    live: await liveTrip(deps, rows[0], query.routeVersion),
    serverTime: now.toISOString(),
  };
  return Response.json({ data: body });
}
