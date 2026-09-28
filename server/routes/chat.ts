import {
  chatQuerySchema,
  chatReadSchema,
  chatSendSchema,
  rideIdSchema,
} from "../../shared/contracts";
import {
  chatAccess,
  chatView,
  listMessages,
  markRead,
  sendMessage,
} from "../chat";
import { type Deps, parseInput, readJson } from "../http";

import { currentUser } from "./rides";

export async function getChat(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(rideIdSchema, params.id);
  const access = await chatAccess(deps.db, user.id, rideId);
  return Response.json({ data: await chatView(deps.db, access, deps.now()) });
}

export async function listChatMessages(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(rideIdSchema, params.id);
  const query = parseInput(
    chatQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const access = await chatAccess(deps.db, user.id, rideId);
  return Response.json({
    data: await listMessages(deps.db, access, query, deps.now()),
  });
}

export async function sendChatMessage(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(rideIdSchema, params.id);
  const input = await readJson(request, chatSendSchema);
  const result = await sendMessage(deps, user.id, rideId, input);
  return Response.json(
    { data: result },
    { status: result.duplicate ? 200 : 201 },
  );
}

export async function markChatRead(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(rideIdSchema, params.id);
  const { seq } = await readJson(request, chatReadSchema);
  const access = await chatAccess(deps.db, user.id, rideId);
  await markRead(deps.db, access, seq);
  const fresh = await chatAccess(deps.db, user.id, rideId);
  return Response.json({ data: await chatView(deps.db, fresh, deps.now()) });
}
