import {
  CHAT_RULES,
  type ChatMessageView,
  type ChatPage,
  type ChatState,
  type ChatView,
  type RideChatSummary,
  type RideStatus,
} from "../shared/contracts";

import { type Database, type SqlClient, transaction } from "./db";
import { ApiError, notFound } from "./errors";
import { ASSIGNED_STATUSES, TERMINAL_STATUSES } from "./lifecycle";
import {
  deliverPending,
  enqueueNotification,
  type PushGateway,
} from "./notifications";
import { NOTIFY } from "./notificationText";

export const CHAT = {
  burstWindowSeconds: 30,
  burstLimit: 8,
  perRideLimit: 200,
  retentionDays: 30,
  pushQuietSeconds: 120,
  purgeBatch: 500,
} as const;

export type ChatRole = "passenger" | "driver";

interface ChatTimes {
  status: RideStatus;
  driver_profile_id: string | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  interrupted_at: Date | null;
}

interface ChatRideRow extends ChatTimes {
  id: string;
  user_id: string;
  driver_user_id: string | null;
  passenger_name: string | null;
  driver_name: string | null;
  last_seq: number;
  passenger_read_seq: number;
  driver_read_seq: number;
}

export interface MessageRow {
  id: string;
  ride_id: string;
  seq: number;
  driver_profile_id: string;
  sender_role: ChatRole;
  sender_user_id: string;
  client_message_id: string;
  body: string;
  created_at: Date;
}

export interface ChatAccess {
  row: ChatRideRow;
  role: ChatRole;
  userId: string;
}

const RETENTION_MS = CHAT.retentionDays * 24 * 3600 * 1000;

export function chatEndedAt(row: ChatTimes): Date | null {
  if (!TERMINAL_STATUSES.includes(row.status)) return null;
  const at = row.completed_at ?? row.interrupted_at ?? row.cancelled_at;
  return at ? new Date(at) : null;
}

export function chatAvailableUntil(row: ChatTimes): Date | null {
  const ended = chatEndedAt(row);
  return ended ? new Date(ended.getTime() + RETENTION_MS) : null;
}

export function chatStateFor(row: ChatTimes, now: Date): ChatState {
  if (row.status === "legacy") return "unavailable";
  if (ASSIGNED_STATUSES.includes(row.status) && row.driver_profile_id) {
    return "open";
  }
  const until = chatAvailableUntil(row);
  if (until) return now.getTime() > until.getTime() ? "expired" : "closed";
  if (TERMINAL_STATUSES.includes(row.status)) return "closed";
  return "waiting";
}

export function chatSummary(
  row: ChatTimes & { chat_seq: number | null },
  unread: number,
  now: Date,
): RideChatSummary {
  const state = chatStateFor(row, now);
  return {
    state,
    canSend: state === "open",
    latestSeq: Number(row.chat_seq ?? 0),
    unread: state === "expired" || state === "unavailable" ? 0 : unread,
  };
}

const CHAT_RIDE_SQL = `
  SELECT r.id, r.user_id, r.status, r.driver_profile_id, dp.user_id AS driver_user_id,
         r.completed_at, r.cancelled_at, r.interrupted_at,
         COALESCE(r.passenger_name, u.name) AS passenger_name, dp.display_name AS driver_name,
         COALESCE(c.last_seq, 0) AS last_seq,
         COALESCE(c.passenger_read_seq, 0) AS passenger_read_seq,
         COALESCE(c.driver_read_seq, 0) AS driver_read_seq
    FROM mobility.rides r
    JOIN mobility.users u ON u.id = r.user_id
    LEFT JOIN mobility.driver_profiles dp ON dp.id = r.driver_profile_id
    LEFT JOIN mobility.ride_chats c ON c.ride_id = r.id
   WHERE r.id = $1`;

export async function chatAccess(
  db: SqlClient,
  userId: string,
  rideId: string,
  lock = false,
): Promise<ChatAccess> {
  const { rows } = await db.query<ChatRideRow>(
    `${CHAT_RIDE_SQL}${lock ? " FOR SHARE OF r" : ""}`,
    [rideId],
  );
  const row = rows[0];
  if (row?.user_id === userId) return { row, role: "passenger", userId };
  if (row && row.driver_user_id === userId) {
    return { row, role: "driver", userId };
  }
  throw notFound("Ride");
}

const visibleFilter = (access: ChatAccess) =>
  access.role === "passenger"
    ? { sql: "m.ride_id = $1", values: [access.row.id] }
    : {
        sql: "m.ride_id = $1 AND m.driver_profile_id = $2",
        values: [access.row.id, access.row.driver_profile_id],
      };

async function unreadCount(db: SqlClient, access: ChatAccess) {
  const filter = visibleFilter(access);
  const readSeq =
    access.role === "passenger"
      ? access.row.passenger_read_seq
      : access.row.driver_read_seq;
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM mobility.ride_messages m
      WHERE ${filter.sql} AND m.sender_user_id <> $${filter.values.length + 1}
        AND m.seq > $${filter.values.length + 2}`,
    [...filter.values, access.userId, readSeq],
  );
  return rows[0].n;
}

export async function chatView(
  db: SqlClient,
  access: ChatAccess,
  now: Date,
): Promise<ChatView> {
  const { row, role } = access;
  const summary = chatSummary(
    { ...row, chat_seq: row.last_seq },
    await unreadCount(db, access),
    now,
  );
  const until = chatAvailableUntil(row);
  return {
    ...summary,
    rideId: row.id,
    role,
    counterpartName:
      role === "passenger"
        ? row.driver_profile_id
          ? row.driver_name
          : null
        : (row.passenger_name ?? "Passenger"),
    readSeq:
      role === "passenger" ? row.passenger_read_seq : row.driver_read_seq,
    availableUntil: until ? until.toISOString() : null,
    maxLength: CHAT_RULES.maxLength,
  };
}

const toMessage = (m: MessageRow, access: ChatAccess): ChatMessageView => {
  const mine = m.sender_user_id === access.userId;
  return {
    id: m.id,
    seq: m.seq,
    mine,
    clientMessageId: mine ? m.client_message_id : null,
    body: m.body,
    createdAt: new Date(m.created_at).toISOString(),
    earlierDriver:
      access.role === "passenger" &&
      m.driver_profile_id !== access.row.driver_profile_id,
  };
};

export async function listMessages(
  db: SqlClient,
  access: ChatAccess,
  query: { after?: number; before?: number; limit: number },
  now: Date,
): Promise<ChatPage> {
  const chat = await chatView(db, access, now);
  if (chat.state === "expired" || chat.state === "unavailable") {
    return { chat, messages: [], hasMoreBefore: false, hasMoreAfter: false };
  }
  const filter = visibleFilter(access);
  const next = filter.values.length + 1;
  let sql: string;
  let values: unknown[];
  if (query.after !== undefined) {
    sql = `AND m.seq > $${next} ORDER BY m.seq ASC`;
    values = [query.after];
  } else if (query.before !== undefined) {
    sql = `AND m.seq < $${next} ORDER BY m.seq DESC`;
    values = [query.before];
  } else {
    sql = "ORDER BY m.seq DESC";
    values = [];
  }
  const { rows } = await db.query<MessageRow>(
    `SELECT m.* FROM mobility.ride_messages m WHERE ${filter.sql} ${sql}
      LIMIT $${filter.values.length + values.length + 1}`,
    [...filter.values, ...values, query.limit],
  );
  const items = query.after !== undefined ? rows : [...rows].reverse();
  const { rows: bounds } = await db.query<{
    min: number | null;
    max: number | null;
  }>(
    `SELECT min(m.seq) AS min, max(m.seq) AS max
       FROM mobility.ride_messages m WHERE ${filter.sql}`,
    filter.values,
  );
  const { min, max } = bounds[0];
  const first = items[0]?.seq;
  const last = items[items.length - 1]?.seq;
  return {
    chat,
    messages: items.map((m) => toMessage(m, access)),
    hasMoreBefore:
      first !== undefined
        ? min !== null && first > min
        : query.before !== undefined && min !== null && min < query.before,
    hasMoreAfter:
      last !== undefined
        ? max !== null && last < max
        : query.after !== undefined && max !== null && max > query.after,
  };
}

const closedMessage: Record<Exclude<ChatState, "open">, string> = {
  waiting: "You can message once a driver accepts the ride.",
  closed: "This ride has ended, so new messages can't be sent.",
  expired: "This conversation is no longer available.",
  unavailable: "Messaging isn't available for this ride.",
};

export async function sendMessage(
  deps: { db: Database; push?: PushGateway | null; now: () => Date },
  userId: string,
  rideId: string,
  input: { clientMessageId: string; body: string },
) {
  const now = deps.now();
  const outcome = await transaction(deps.db, async (tx) => {
    const access = await chatAccess(tx, userId, rideId, true);
    await tx.query(
      "INSERT INTO mobility.ride_chats (ride_id) VALUES ($1) ON CONFLICT (ride_id) DO NOTHING",
      [rideId],
    );
    await tx.query(
      "SELECT last_seq FROM mobility.ride_chats WHERE ride_id = $1 FOR UPDATE",
      [rideId],
    );

    const existing = await findByClientId(tx, userId, input.clientMessageId);
    if (existing)
      return { access, message: sameMessage(existing, rideId, input) };

    const state = chatStateFor(access.row, now);
    if (state !== "open") {
      throw new ApiError(409, "CHAT_CLOSED", closedMessage[state]);
    }

    const windowStart = new Date(
      now.getTime() - CHAT.burstWindowSeconds * 1000,
    );
    const { rows: usage } = await tx.query<{
      recent: number;
      oldest: Date | null;
      total: number;
    }>(
      `SELECT count(*) FILTER (WHERE created_at > $3)::int AS recent,
              min(created_at) FILTER (WHERE created_at > $3) AS oldest,
              count(*)::int AS total
         FROM mobility.ride_messages
        WHERE sender_user_id = $1 AND ride_id = $2`,
      [userId, rideId, windowStart],
    );
    if (usage[0].total >= CHAT.perRideLimit) {
      throw new ApiError(
        429,
        "CHAT_LIMIT_REACHED",
        "You've reached the message limit for this ride.",
      );
    }
    if (usage[0].recent >= CHAT.burstLimit && usage[0].oldest) {
      const retryAfter = Math.max(
        1,
        Math.ceil(
          (new Date(usage[0].oldest).getTime() +
            CHAT.burstWindowSeconds * 1000 -
            now.getTime()) /
            1000,
        ),
      );
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "You're sending messages too quickly. Wait a moment and try again.",
        undefined,
        retryAfter,
      );
    }

    const { rows: seqRows } = await tx.query<{ last_seq: number }>(
      `UPDATE mobility.ride_chats
          SET last_seq = last_seq + 1,
              ${access.role === "passenger" ? "passenger_read_seq" : "driver_read_seq"} = last_seq + 1,
              updated_at = now()
        WHERE ride_id = $1
        RETURNING last_seq`,
      [rideId],
    );
    const { rows: inserted } = await tx.query<MessageRow>(
      `INSERT INTO mobility.ride_messages
         (ride_id, seq, driver_profile_id, sender_role, sender_user_id,
          client_message_id, body, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (sender_user_id, client_message_id) DO NOTHING
       RETURNING *`,
      [
        rideId,
        seqRows[0].last_seq,
        access.row.driver_profile_id,
        access.role,
        userId,
        input.clientMessageId,
        input.body,
        now,
      ],
    );
    if (!inserted[0]) {
      const raced = await findByClientId(tx, userId, input.clientMessageId);
      if (!raced) throw new ApiError(409, "RETRY", "Please try again.");
      return { access, message: sameMessage(raced, rideId, input) };
    }

    const recipient =
      access.role === "passenger"
        ? access.row.driver_user_id
        : access.row.user_id;
    if (recipient) {
      await enqueueNotification(
        tx,
        {
          userId: recipient,
          rideId,
          kind: "chat_message",
          dedupeKey: `chat:${rideId}:${recipient}:${Math.floor(
            now.getTime() / (CHAT.pushQuietSeconds * 1000),
          )}`,
          ...NOTIFY.chatMessage(access.role === "passenger"),
          target: `/chat/${rideId}`,
        },
        now,
      );
    }
    return { access, message: { row: inserted[0], duplicate: false } };
  });

  await deliverPending(deps).catch(() => {
    console.error(
      JSON.stringify({ event: "notification_delivery_deferred", rideId }),
    );
  });
  const access = await chatAccess(deps.db, userId, rideId);
  return {
    chat: await chatView(deps.db, access, now),
    message: toMessage(outcome.message.row, access),
    duplicate: outcome.message.duplicate,
  };
}

async function findByClientId(
  db: SqlClient,
  userId: string,
  clientMessageId: string,
) {
  const { rows } = await db.query<MessageRow>(
    "SELECT * FROM mobility.ride_messages WHERE sender_user_id = $1 AND client_message_id = $2",
    [userId, clientMessageId],
  );
  return rows[0] ?? null;
}

function sameMessage(row: MessageRow, rideId: string, input: { body: string }) {
  if (row.ride_id !== rideId || row.body !== input.body) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This message ID was already used for a different message.",
    );
  }
  return { row, duplicate: true };
}

export async function markRead(db: SqlClient, access: ChatAccess, seq: number) {
  const column =
    access.role === "passenger" ? "passenger_read_seq" : "driver_read_seq";
  await db.query(
    `UPDATE mobility.ride_chats
        SET ${column} = GREATEST(${column}, LEAST($2::int, last_seq)), updated_at = now()
      WHERE ride_id = $1`,
    [access.row.id, seq],
  );
}

export async function purgeExpiredChats(
  deps: { db: Database; now: () => Date },
  limit: number = CHAT.purgeBatch,
): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - RETENTION_MS);
  const { rows } = await deps.db.query<{ ride_id: string }>(
    `DELETE FROM mobility.ride_messages
      WHERE id IN (
        SELECT m.id FROM mobility.ride_messages m
          JOIN mobility.rides r ON r.id = m.ride_id
         WHERE r.status = ANY($1::text[])
           AND COALESCE(r.completed_at, r.interrupted_at, r.cancelled_at) < $2
         LIMIT $3)
      RETURNING ride_id`,
    [TERMINAL_STATUSES, cutoff, limit],
  );
  const rides = [...new Set(rows.map((r) => r.ride_id))];
  if (rides.length) {
    await deps.db.query(
      `UPDATE mobility.ride_chats SET purged_at = $2, updated_at = now()
        WHERE ride_id = ANY($1::uuid[])`,
      [rides, deps.now()],
    );
  }
  return rows.length;
}

export async function findVisibleMessage(
  db: SqlClient,
  access: ChatAccess,
  messageId: string,
  now: Date,
): Promise<MessageRow | null> {
  const state = chatStateFor(access.row, now);
  if (state === "expired" || state === "unavailable") return null;
  const filter = visibleFilter(access);
  const { rows } = await db.query<MessageRow>(
    `SELECT m.* FROM mobility.ride_messages m
      WHERE ${filter.sql} AND m.id = $${filter.values.length + 1}`,
    [...filter.values, messageId],
  );
  return rows[0] ?? null;
}
