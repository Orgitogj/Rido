import {
  type AdminBadges,
  inboxQuerySchema,
  inboxReadSchema,
  notificationPreferencesSchema,
  supportCreateSchema,
  supportListQuerySchema,
  supportMessageSchema,
  supportUserMessageSchema,
} from "../../shared/account";
import { rideIdSchema } from "../../shared/contracts";
import { type Deps, parseInput, readJson } from "../http";
import { getPreferences, listInbox, markRead, setPreferences } from "../inbox";
import { permissionsOf, requireOperator } from "../operators";
import { enforceRateLimit } from "../rateLimit";
import {
  createSupportRequest,
  listMySupport,
  mySupportConversation,
  operatorSupportMessage,
  supportMessagesForOperator,
  userSupportMessage,
} from "../support";
import { ensureUser } from "../users";

import { decodeCursor, encodeCursor } from "./admin";

const query = (request: Request) =>
  Object.fromEntries(new URL(request.url).searchParams);

const me = async (request: Request, deps: Deps) =>
  ensureUser(deps.db, await deps.authenticate(request));

export async function getInbox(request: Request, _params: unknown, deps: Deps) {
  const user = await me(request, deps);
  const q = parseInput(inboxQuerySchema, query(request));
  return Response.json({ data: await listInbox(deps.db, user.id, q) });
}

export async function readInbox(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await me(request, deps);
  const input = await readJson(request, inboxReadSchema);
  return Response.json({
    data: { unread: await markRead(deps.db, user.id, input, deps.now()) },
  });
}

export async function getNotificationPreferences(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await me(request, deps);
  return Response.json({ data: await getPreferences(deps.db, user.id) });
}

export async function putNotificationPreferences(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await me(request, deps);
  const input = await readJson(request, notificationPreferencesSchema);
  return Response.json({
    data: await setPreferences(deps.db, user.id, input, deps.now()),
  });
}

export async function listSupportRequests(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await me(request, deps);
  const q = parseInput(supportListQuerySchema, query(request));
  const { items, last } = await listMySupport(deps.db, user.id, {
    cursor: decodeCursor(q.cursor),
    limit: q.limit,
  });
  return Response.json({
    data: {
      items,
      nextCursor: last ? encodeCursor(last.created_at, last.id) : null,
    },
  });
}

export async function getSupportRequest(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await me(request, deps);
  const id = parseInput(rideIdSchema, params.id);
  return Response.json({
    data: await mySupportConversation(deps.db, user.id, id, deps.now()),
  });
}

export async function postSupportMessage(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await me(request, deps);
  const id = parseInput(rideIdSchema, params.id);
  const input = await readJson(request, supportUserMessageSchema);
  return Response.json(
    { data: await userSupportMessage(deps, user.id, id, input) },
    { status: 201 },
  );
}

export async function createSupport(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await me(request, deps);
  const input = await readJson(request, supportCreateSchema);
  await enforceRateLimit(deps.db, "supportRequests", user.id, deps.now());
  const created = await createSupportRequest(deps, user.id, input);
  return Response.json(
    {
      data: await mySupportConversation(
        deps.db,
        user.id,
        created.id,
        deps.now(),
      ),
    },
    { status: created.created ? 201 : 200 },
  );
}

export async function adminSupportMessages(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const id = parseInput(rideIdSchema, params.id);
  await requireOperator(request, deps, "view", {
    type: "support_request",
    id,
    action: "support_messages_view",
  });
  return Response.json({
    data: await supportMessagesForOperator(deps.db, id),
  });
}

export async function adminSupportReply(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const id = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "support", {
    type: "support_request",
    id,
    action: "support_message",
  });
  const input = await readJson(request, supportMessageSchema);
  await operatorSupportMessage(deps, operator, id, input);
  return Response.json(
    { data: await supportMessagesForOperator(deps.db, id) },
    { status: 201 },
  );
}

const FINANCIAL_REASONS = [
  "settlement_failing",
  "payment_dispute",
  "refund_reversed",
  "refund_mismatch",
  "authorization_expired",
  "authorization_expiring_during_trip",
];

export async function adminBadges(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const operator = await requireOperator(request, deps, "view", {
    type: "console",
    id: null,
    action: "badges",
  });
  const can = permissionsOf(operator);
  const count = async (sql: string, values: unknown[] = []) =>
    (await deps.db.query<{ n: number }>(sql, values)).rows[0].n;
  const body: AdminBadges = {
    review: await count(
      "SELECT count(*)::int AS n FROM mobility.rides WHERE needs_review",
    ),
    financial: await count(
      "SELECT count(*)::int AS n FROM mobility.rides WHERE needs_review AND review_reason = ANY($1::text[])",
      [FINANCIAL_REASONS],
    ),
    support: await count(
      `SELECT count(*)::int AS n FROM mobility.support_requests
        WHERE status = 'open'
           OR (status = 'in_progress' AND last_user_message_at IS NOT NULL
               AND (last_operator_message_at IS NULL OR last_user_message_at > last_operator_message_at))`,
    ),
    safety: can.includes("support")
      ? await count(
          "SELECT count(*)::int AS n FROM mobility.safety_reports WHERE status = 'open'",
        )
      : null,
    drivers: can.includes("verify")
      ? await count(
          `SELECT count(*)::int AS n FROM mobility.driver_profiles dp
            WHERE dp.status = 'submitted'
               OR (dp.status IN ('approved', 'suspended') AND EXISTS (
                     SELECT 1 FROM mobility.driver_documents d
                      WHERE d.driver_profile_id = dp.id AND d.status = 'uploaded'))`,
        )
      : null,
  };
  return Response.json({ data: body });
}
