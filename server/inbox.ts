import { formatClock, parseClock } from "../shared/quietHours";

import type { SqlClient } from "./db";
import type {
  InboxItem,
  InboxPage,
  NotificationCategory,
  NotificationPreferences,
} from "../shared/account";

interface InboxRow {
  id: string;
  kind: string;
  category: NotificationCategory;
  title: string;
  body: string;
  target: string | null;
  created_at: Date;
  read_at: Date | null;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export async function listInbox(
  db: SqlClient,
  userId: string,
  opts: { cursor?: string; limit: number },
): Promise<InboxPage> {
  const { rows } = await db.query<InboxRow>(
    `SELECT id::text, kind, category, title, body, data->>'target' AS target,
            created_at, read_at
       FROM mobility.notifications
      WHERE user_id = $1 AND inbox AND ($2::bigint IS NULL OR id < $2::bigint)
      ORDER BY id DESC
      LIMIT $3`,
    [userId, opts.cursor ?? null, opts.limit + 1],
  );
  const more = rows.length > opts.limit;
  const page = more ? rows.slice(0, opts.limit) : rows;
  const items: InboxItem[] = page.map((r) => ({
    id: r.id,
    kind: r.kind,
    category: r.category,
    title: r.title,
    body: r.body,
    target: r.target,
    createdAt: iso(r.created_at)!,
    readAt: iso(r.read_at),
  }));
  return {
    items,
    nextCursor: more ? page[page.length - 1].id : null,
    unread: await unreadCount(db, userId),
  };
}

export async function unreadCount(db: SqlClient, userId: string) {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM mobility.notifications
      WHERE user_id = $1 AND inbox AND read_at IS NULL`,
    [userId],
  );
  return rows[0].n;
}

export async function markRead(
  db: SqlClient,
  userId: string,
  input: { all: true } | { ids: string[] },
  now: Date,
) {
  if ("all" in input) {
    await db.query(
      `UPDATE mobility.notifications SET read_at = $2
        WHERE user_id = $1 AND inbox AND read_at IS NULL`,
      [userId, now],
    );
  } else {
    await db.query(
      `UPDATE mobility.notifications SET read_at = $2
        WHERE user_id = $1 AND inbox AND read_at IS NULL AND id = ANY($3::bigint[])`,
      [userId, now, input.ids],
    );
  }
  return unreadCount(db, userId);
}

export async function getPreferences(
  db: SqlClient,
  userId: string,
): Promise<NotificationPreferences> {
  const { rows } = await db.query<{
    ride_updates: boolean;
    chat_messages: boolean;
    ride_offers: boolean;
    account_updates: boolean;
    quiet_enabled: boolean;
    quiet_start_minute: number | null;
    quiet_end_minute: number | null;
    quiet_timezone: string | null;
  }>(
    `SELECT ride_updates, chat_messages, ride_offers, account_updates,
            quiet_enabled, quiet_start_minute, quiet_end_minute, quiet_timezone
       FROM mobility.notification_preferences WHERE user_id = $1`,
    [userId],
  );
  const r = rows[0];
  return {
    rideUpdates: r?.ride_updates ?? true,
    chatMessages: r?.chat_messages ?? true,
    rideOffers: r?.ride_offers ?? true,
    accountUpdates: r?.account_updates ?? true,
    quietHours:
      r && r.quiet_start_minute !== null && r.quiet_end_minute !== null
        ? {
            enabled: r.quiet_enabled,
            start: formatClock(r.quiet_start_minute),
            end: formatClock(r.quiet_end_minute),
            timezone: r.quiet_timezone!,
          }
        : null,
  };
}

export async function setPreferences(
  db: SqlClient,
  userId: string,
  p: NotificationPreferences,
  now: Date,
) {
  await db.query(
    `INSERT INTO mobility.notification_preferences
       (user_id, ride_updates, chat_messages, ride_offers, account_updates, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE
       SET ride_updates = EXCLUDED.ride_updates, chat_messages = EXCLUDED.chat_messages,
           ride_offers = EXCLUDED.ride_offers, account_updates = EXCLUDED.account_updates,
           updated_at = EXCLUDED.updated_at`,
    [
      userId,
      p.rideUpdates,
      p.chatMessages,
      p.rideOffers,
      p.accountUpdates,
      now,
    ],
  );
  return getPreferences(db, userId);
}
