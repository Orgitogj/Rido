import {
  type MySupportRequest,
  SUPPORT_RULES,
  type SupportConversation,
  type SupportMessageView,
  type SupportRole,
  type SupportStatus,
} from "../shared/account";

import { type Database, type SqlClient, transaction } from "./db";
import { ApiError, notFound } from "./errors";
import {
  deliverPending,
  enqueueNotification,
  type PushGateway,
} from "./notifications";
import { NOTIFY } from "./notificationText";
import { audit, type OperatorRow } from "./operators";

interface RequestRow {
  id: string;
  ride_id: string | null;
  user_id: string;
  requester_role: SupportRole;
  category: string;
  status: SupportStatus;
  message: string;
  destination_address: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
  resolution_message: string | null;
  user_read_at: Date | null;
  last_operator_message_at: Date | null;
  assigned_operator_id: string | null;
}

interface MessageRow {
  id: string;
  author: "user" | "operator";
  body: string;
  created_at: Date;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

const SELECT = `
  SELECT s.id, s.ride_id, s.user_id, s.requester_role, s.category, s.status, s.message,
         CASE WHEN s.requester_role = 'passenger' THEN r.destination_address END
           AS destination_address,
         s.created_at, s.updated_at, s.resolved_at,
         s.resolution_message, s.user_read_at, s.last_operator_message_at,
         s.assigned_operator_id
    FROM mobility.support_requests s
    LEFT JOIN mobility.rides r ON r.id = s.ride_id`;

const unread = (r: RequestRow) => {
  const latest = Math.max(
    r.last_operator_message_at
      ? new Date(r.last_operator_message_at).getTime()
      : 0,
    r.resolved_at ? new Date(r.resolved_at).getTime() : 0,
  );
  return (
    latest > 0 &&
    (!r.user_read_at || new Date(r.user_read_at).getTime() < latest)
  );
};

const item = (r: RequestRow): MySupportRequest => ({
  id: r.id,
  rideId: r.ride_id,
  role: r.requester_role,
  category: r.category,
  status: r.status,
  destination: r.destination_address,
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
  unread: unread(r),
});

export async function listMySupport(
  db: SqlClient,
  userId: string,
  opts: { cursor: [string, string] | null; limit: number },
) {
  const { rows } = await db.query<RequestRow>(
    `${SELECT}
      WHERE s.user_id = $1
        AND ($2::timestamptz IS NULL OR (s.created_at, s.id) < ($2::timestamptz, $3::uuid))
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $4`,
    [
      userId,
      opts.cursor?.[0] ?? null,
      opts.cursor?.[1] ?? null,
      opts.limit + 1,
    ],
  );
  const more = rows.length > opts.limit;
  const page = more ? rows.slice(0, opts.limit) : rows;
  return {
    items: page.map(item),
    last: more ? page[page.length - 1] : null,
  };
}

async function messagesOf(db: SqlClient, requestId: string) {
  const { rows } = await db.query<MessageRow>(
    `SELECT id::text, author, body, created_at FROM mobility.support_messages
      WHERE support_request_id = $1 ORDER BY id LIMIT 500`,
    [requestId],
  );
  return rows.map((m): SupportMessageView => ({
    id: m.id,
    author: m.author,
    body: m.body,
    createdAt: iso(m.created_at)!,
  }));
}

export async function mySupportConversation(
  db: SqlClient,
  userId: string,
  requestId: string,
  now: Date,
): Promise<SupportConversation> {
  const { rows } = await db.query<RequestRow>(
    `${SELECT} WHERE s.id = $1 AND s.user_id = $2`,
    [requestId, userId],
  );
  const r = rows[0];
  if (!r) throw notFound("Support request");
  await db.query(
    "UPDATE mobility.support_requests SET user_read_at = $2 WHERE id = $1",
    [requestId, now],
  );
  return {
    ...item({ ...r, user_read_at: now }),
    message: r.message,
    resolutionMessage: r.status === "resolved" ? r.resolution_message : null,
    resolvedAt: iso(r.resolved_at),
    messages: await messagesOf(db, requestId),
    canReply: r.status !== "resolved",
  };
}

export async function userSupportMessage(
  deps: { db: Database; now: () => Date },
  userId: string,
  requestId: string,
  input: { body: string; clientMessageId: string },
) {
  const now = deps.now();
  await transaction(deps.db, async (tx) => {
    const { rows } = await tx.query<{ status: SupportStatus }>(
      "SELECT status FROM mobility.support_requests WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [requestId, userId],
    );
    if (!rows[0]) throw notFound("Support request");
    const { rows: existing } = await tx.query(
      "SELECT 1 FROM mobility.support_messages WHERE support_request_id = $1 AND client_message_id = $2",
      [requestId, input.clientMessageId],
    );
    if (existing.length) return;
    if (rows[0].status === "resolved") {
      throw new ApiError(
        409,
        "SUPPORT_CLOSED",
        "This request is resolved. Open a new request from the trip's receipt if you still need help.",
      );
    }
    const { rows: counts } = await tx.query<{ total: number; recent: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE created_at > $2)::int AS recent
         FROM mobility.support_messages
        WHERE support_request_id = $1 AND author = 'user'`,
      [
        requestId,
        new Date(now.getTime() - SUPPORT_RULES.burstWindowSeconds * 1000),
      ],
    );
    if (
      counts[0].total >= SUPPORT_RULES.userMessagesPerRequest ||
      counts[0].recent >= SUPPORT_RULES.burstLimit
    ) {
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "You're sending messages too quickly. Please wait a moment.",
        undefined,
        SUPPORT_RULES.burstWindowSeconds,
      );
    }
    await tx.query(
      `INSERT INTO mobility.support_messages
         (support_request_id, author, user_id, body, client_message_id, created_at)
       VALUES ($1, 'user', $2, $3, $4, $5)`,
      [requestId, userId, input.body, input.clientMessageId, now],
    );
    await tx.query(
      `UPDATE mobility.support_requests
          SET last_user_message_at = $2, user_read_at = $2, updated_at = $2
        WHERE id = $1`,
      [requestId, now],
    );
    await tx.query(
      `INSERT INTO mobility.support_events (support_request_id, action)
       VALUES ($1, 'user_message')`,
      [requestId],
    );
  });
  return mySupportConversation(deps.db, userId, requestId, now);
}

export async function notifySupport(
  tx: SqlClient,
  requestId: string,
  event: "reply" | "resolved" | "reopened" | "in_progress",
  dedupe: string,
  now: Date,
) {
  const { rows } = await tx.query<{ user_id: string; ride_id: string | null }>(
    "SELECT user_id, ride_id FROM mobility.support_requests WHERE id = $1",
    [requestId],
  );
  if (!rows[0]) return;
  await enqueueNotification(
    tx,
    {
      userId: rows[0].user_id,
      rideId: rows[0].ride_id,
      kind: "support_update",
      dedupeKey: `support:${requestId}:${event}:${dedupe}`,
      ...NOTIFY.support(event),
      target: `/support/${requestId}`,
    },
    now,
  );
}

export async function operatorSupportMessage(
  deps: { db: Database; push?: PushGateway | null; now: () => Date },
  operator: OperatorRow,
  requestId: string,
  input: { body: string; clientMessageId: string },
) {
  const now = deps.now();
  const refuse = async (status: number, code: string, message: string) => {
    await audit(deps.db, {
      operator,
      action: "support_message",
      targetType: "support_request",
      targetId: requestId,
      result: "failed",
      detail: { error: code },
    });
    throw new ApiError(status, code, message);
  };
  const outcome = await transaction(deps.db, async (tx) => {
    const { rows } = await tx.query<{
      status: SupportStatus;
      assigned_operator_id: string | null;
    }>(
      "SELECT status, assigned_operator_id FROM mobility.support_requests WHERE id = $1 FOR UPDATE",
      [requestId],
    );
    if (!rows[0]) return "NOT_FOUND" as const;
    if (rows[0].assigned_operator_id !== operator.id) {
      return "NOT_ASSIGNED_TO_YOU" as const;
    }
    if (rows[0].status === "resolved") return "ALREADY_RESOLVED" as const;
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO mobility.support_messages
         (support_request_id, author, operator_id, body, client_message_id, created_at)
       VALUES ($1, 'operator', $2, $3, $4, $5)
       ON CONFLICT (support_request_id, client_message_id) DO NOTHING
       RETURNING id::text`,
      [requestId, operator.id, input.body, input.clientMessageId, now],
    );
    if (!inserted.rows[0]) return "DUPLICATE" as const;
    await tx.query(
      `UPDATE mobility.support_requests
          SET last_operator_message_at = $2, updated_at = $2
        WHERE id = $1`,
      [requestId, now],
    );
    await tx.query(
      `INSERT INTO mobility.support_events (support_request_id, operator_id, action)
       VALUES ($1, $2, 'operator_message')`,
      [requestId, operator.id],
    );
    await notifySupport(tx, requestId, "reply", inserted.rows[0].id, now);
    return "SENT" as const;
  });
  if (outcome === "NOT_FOUND") throw notFound("Support request");
  if (outcome === "NOT_ASSIGNED_TO_YOU") {
    return refuse(
      409,
      outcome,
      "Assign this request to yourself before replying.",
    );
  }
  if (outcome === "ALREADY_RESOLVED") {
    return refuse(409, outcome, "Reopen this request before replying.");
  }
  if (outcome === "SENT") {
    await audit(deps.db, {
      operator,
      action: "support_message",
      targetType: "support_request",
      targetId: requestId,
      result: "succeeded",
      detail: { length: input.body.length },
    });
    await deliverPending(deps).catch(() => undefined);
  }
}

export async function supportMessagesForOperator(
  db: SqlClient,
  requestId: string,
) {
  return messagesOf(db, requestId);
}
