import { inQuietHours, quietHoursApplyTo } from "../shared/quietHours";

import { NOTIFY, type NotificationText } from "./notificationText";

import type { Database, SqlClient } from "./db";
import type { Actor, RideRow } from "./lifecycle";

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: "default";
  priority: "high";
  channelId: "rides";
  ttl: number;
}

export type PushTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message?: string; details?: { error?: string } };

export type PushReceipt =
  | { status: "ok" }
  | { status: "error"; message?: string; details?: { error?: string } };

export interface PushGateway {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  receipts(ids: string[]): Promise<Record<string, PushReceipt>>;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push";

export function expoPushGateway(
  accessToken = process.env.EXPO_ACCESS_TOKEN,
  fetchImpl: typeof fetch = fetch,
): PushGateway {
  const post = async (path: string, body: unknown) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetchImpl(`${EXPO_PUSH_URL}/${path}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Expo push ${response.status}`);
      return (await response.json()) as { data: unknown };
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    async send(messages) {
      const tickets: PushTicket[] = [];
      for (let i = 0; i < messages.length; i += 100) {
        const { data } = await post("send", messages.slice(i, i + 100));
        tickets.push(...(data as PushTicket[]));
      }
      return tickets;
    },
    async receipts(ids) {
      const { data } = await post("getReceipts", { ids });
      return data as Record<string, PushReceipt>;
    },
  };
}

const TTL_SECONDS: Record<string, number> = {
  offer: 20,
  ride_accepted: 30 * 60,
  ride_arrived: 15 * 60,
  ride_started: 30 * 60,
  ride_completed: 60 * 60,
  ride_cancelled: 30 * 60,
  ride_rematching: 5 * 60,
  ride_interrupted: 60 * 60,
  pin_waived: 15 * 60,
  no_driver: 30 * 60,
  hold_released: 24 * 3600,
  chat_message: 10 * 60,
  application_update: 24 * 3600,
  support_update: 24 * 3600,
  safety_update: 24 * 3600,
};

export type NotificationCategory =
  "ride" | "chat" | "offer" | "account" | "support" | "safety";

export const KIND_CATEGORY: Record<string, NotificationCategory> = {
  offer: "offer",
  chat_message: "chat",
  application_update: "account",
  support_update: "support",
  safety_update: "safety",
};

export const categoryOf = (kind: string): NotificationCategory =>
  KIND_CATEGORY[kind] ?? "ride";

const PREFERENCE_COLUMN: Record<NotificationCategory, string> = {
  ride: "ride_updates",
  chat: "chat_messages",
  offer: "ride_offers",
  account: "account_updates",
  support: "account_updates",
  safety: "account_updates",
};
const MAX_ATTEMPTS = 5;
const RECLAIM_SECONDS = 60;
const RECEIPT_DELAY_SECONDS = 15 * 60;

interface NotificationInput {
  userId: string;
  rideId: string | null;
  kind: keyof typeof TTL_SECONDS;
  dedupeKey: string;
  title: string;
  body: string;
  sq?: { title: string; body: string };
  target: string;
}

export async function enqueueNotification(
  tx: SqlClient,
  n: NotificationInput,
  now: Date,
) {
  await tx.query(
    `INSERT INTO mobility.notifications
       (user_id, ride_id, kind, dedupe_key, title, body, data, created_at, category, inbox)
     SELECT $1::uuid, $2::uuid, $3::varchar, $4::varchar,
            left(CASE WHEN u.language = 'sq' AND $9::varchar IS NOT NULL THEN $9::varchar ELSE $5::varchar END, 100),
            left(CASE WHEN u.language = 'sq' AND $10::varchar IS NOT NULL THEN $10::varchar ELSE $6::varchar END, 200),
            jsonb_build_object('kind', $3::varchar, 'rideId', COALESCE($2::uuid::text, ''),
                               'target', $7::varchar, 'recipient', u.clerk_id),
            $8::timestamptz, $11::varchar, $12::boolean
       FROM mobility.users u WHERE u.id = $1::uuid AND u.deleted_at IS NULL
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      n.userId,
      n.rideId,
      n.kind,
      n.dedupeKey,
      n.title,
      n.body,
      n.target,
      now,
      n.sq?.title ?? null,
      n.sq?.body ?? null,
      categoryOf(n.kind),
      !["offer", "chat"].includes(categoryOf(n.kind)),
    ],
  );
}

async function driverInfo(tx: SqlClient, driverProfileId: string | null) {
  if (!driverProfileId) return null;
  const { rows } = await tx.query<{
    user_id: string;
    display_name: string;
    vehicle_plate: string;
  }>(
    "SELECT user_id, display_name, vehicle_plate FROM mobility.driver_profiles WHERE id = $1",
    [driverProfileId],
  );
  return rows[0] ?? null;
}

export async function enqueueForTransition(
  tx: SqlClient,
  before: RideRow,
  after: RideRow,
  actor: Actor,
  now: Date,
) {
  const rideTarget = `/ride/${after.id}`;
  const toPassenger = (
    kind: NotificationInput["kind"],
    text: NotificationText,
  ) =>
    enqueueNotification(
      tx,
      {
        userId: after.user_id,
        rideId: after.id,
        kind,
        dedupeKey: `ride:${after.id}:${after.status}:${after.rematch_count}:${after.user_id}`,
        ...text,
        target: rideTarget,
      },
      now,
    );

  const driver = await driverInfo(
    tx,
    after.driver_profile_id ?? before.driver_profile_id,
  );
  const inVehicle = after.payment_method === "in_vehicle";
  switch (after.status) {
    case "accepted":
      return toPassenger("ride_accepted", NOTIFY.rideAccepted(driver));
    case "arrived":
      return toPassenger("ride_arrived", NOTIFY.rideArrived(driver));
    case "in_progress":
      return toPassenger("ride_started", NOTIFY.rideStarted());
    case "completed":
      return toPassenger(
        "ride_completed",
        NOTIFY.rideCompleted(after.fare_cents, inVehicle),
      );
    case "no_driver":
      return toPassenger("no_driver", NOTIFY.noDriver(inVehicle));
    case "cancelled": {
      if (actor === "passenger" && driver) {
        return enqueueNotification(
          tx,
          {
            userId: driver.user_id,
            rideId: after.id,
            kind: "ride_cancelled",
            dedupeKey: `ride:${after.id}:cancelled:${after.rematch_count}:${driver.user_id}`,
            ...NOTIFY.cancelledByPassenger(),
            target: "/driver",
          },
          now,
        );
      }
      if (actor === "driver") {
        return toPassenger(
          "ride_cancelled",
          NOTIFY.cancelledByDriver(inVehicle),
        );
      }
      if (actor === "system" && before.status !== "awaiting_payment") {
        return toPassenger(
          "ride_cancelled",
          NOTIFY.cancelledBySystem(inVehicle),
        );
      }
      return;
    }
    case "requested":
      if (
        actor === "driver" ||
        (actor === "system" &&
          ["accepted", "arriving", "arrived"].includes(before.status))
      ) {
        return toPassenger(
          "ride_rematching",
          NOTIFY.rematching(actor === "driver"),
        );
      }
      return;
    case "interrupted":
      return toPassenger("ride_interrupted", NOTIFY.interrupted(inVehicle));
    default:
      return;
  }
}

export async function enqueueOffer(
  tx: SqlClient,
  offer: {
    id: string;
    driverProfileId: string;
    distanceMeters: number;
    fareCents: number;
  },
  now: Date,
) {
  const driver = await driverInfo(tx, offer.driverProfileId);
  if (!driver) return;
  await enqueueNotification(
    tx,
    {
      userId: driver.user_id,
      rideId: null,
      kind: "offer",
      dedupeKey: `offer:${offer.id}`,
      ...NOTIFY.offer(offer.fareCents, offer.distanceMeters),
      target: "/driver",
    },
    now,
  );
}

interface ClaimedNotification {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, string>;
  attempts: number;
  created_at: Date;
}

const log = (event: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ event, ...fields }));

export async function deliverPending(
  deps: { db: Database; push?: PushGateway | null; now: () => Date },
  limit = 20,
): Promise<number> {
  if (!deps.push) return 0;
  const now = deps.now();
  const { rows: claimed } = await deps.db.query<ClaimedNotification>(
    `UPDATE mobility.notifications
        SET status = 'sending', attempts = attempts + 1, claimed_at = $1
      WHERE id IN (
        SELECT id FROM mobility.notifications
         WHERE (status = 'pending' OR (status = 'sending' AND claimed_at < $2))
           AND attempts < $3
         ORDER BY id
         LIMIT $4
         FOR UPDATE SKIP LOCKED)
      RETURNING id, user_id, kind, title, body, data, attempts, created_at`,
    [
      now,
      new Date(now.getTime() - RECLAIM_SECONDS * 1000),
      MAX_ATTEMPTS,
      limit,
    ],
  );
  if (!claimed.length) return 0;

  const finish = (id: string, status: string, error: string | null = null) =>
    deps.db.query(
      `UPDATE mobility.notifications
          SET status = $2, last_error = $3,
              sent_at = CASE WHEN $2::varchar = 'sent' THEN $4::timestamptz ELSE sent_at END
        WHERE id = $1`,
      [id, status, error, now],
    );

  const outgoing: {
    notification: ClaimedNotification;
    token: string;
    message: PushMessage;
  }[] = [];
  for (const n of claimed) {
    const ttl = TTL_SECONDS[n.kind] ?? 1800;
    const ageSeconds =
      (now.getTime() - new Date(n.created_at).getTime()) / 1000;
    if (ageSeconds > ttl) {
      await finish(n.id, "skipped", "expired");
      continue;
    }
    const column = PREFERENCE_COLUMN[categoryOf(n.kind)];
    const { rows: prefs } = await deps.db.query<{
      muted: boolean;
      quiet_enabled: boolean;
      quiet_start_minute: number | null;
      quiet_end_minute: number | null;
      quiet_timezone: string | null;
    }>(
      `SELECT NOT ${column} AS muted, quiet_enabled, quiet_start_minute,
              quiet_end_minute, quiet_timezone
         FROM mobility.notification_preferences WHERE user_id = $1`,
      [n.user_id],
    );
    const pref = prefs[0];
    if (pref?.muted) {
      await finish(n.id, "skipped", "muted");
      continue;
    }
    if (
      pref?.quiet_enabled &&
      pref.quiet_start_minute !== null &&
      pref.quiet_end_minute !== null &&
      pref.quiet_timezone &&
      quietHoursApplyTo(n.kind) &&
      inQuietHours(
        {
          startMinute: pref.quiet_start_minute,
          endMinute: pref.quiet_end_minute,
          timeZone: pref.quiet_timezone,
        },
        now,
      )
    ) {
      await finish(n.id, "skipped", "quiet_hours");
      continue;
    }
    const { rows: tokens } = await deps.db.query<{ token: string }>(
      "SELECT token FROM mobility.push_tokens WHERE user_id = $1 AND disabled_at IS NULL",
      [n.user_id],
    );
    if (!tokens.length) {
      await finish(n.id, "skipped", "no_device");
      continue;
    }
    for (const { token } of tokens) {
      outgoing.push({
        notification: n,
        token,
        message: {
          to: token,
          title: n.title,
          body: n.body,
          data: n.data,
          sound: "default",
          priority: "high",
          channelId: "rides",
          ttl: Math.max(1, Math.round(ttl - ageSeconds)),
        },
      });
    }
  }
  if (!outgoing.length) return claimed.length;

  let tickets: PushTicket[];
  try {
    tickets = await deps.push.send(outgoing.map((o) => o.message));
  } catch {
    log("push_send_failed", { count: outgoing.length });
    for (const n of new Set(outgoing.map((o) => o.notification))) {
      await finish(
        n.id,
        n.attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        "send_failed",
      );
    }
    return claimed.length;
  }

  const delivered = new Set<string>();
  const errors = new Map<string, string>();
  for (let i = 0; i < outgoing.length; i++) {
    const { notification, token } = outgoing[i];
    const ticket = tickets[i];
    if (ticket?.status === "ok") {
      delivered.add(notification.id);
      await deps.db.query(
        `INSERT INTO mobility.push_tickets (ticket_id, notification_id, token, created_at)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [ticket.id, notification.id, token, now],
      );
    } else {
      const code = ticket?.details?.error ?? "unknown";
      errors.set(notification.id, code);
      if (code === "DeviceNotRegistered")
        await disableToken(deps.db, token, code);
    }
  }
  for (const n of new Set(outgoing.map((o) => o.notification))) {
    if (delivered.has(n.id)) await finish(n.id, "sent");
    else {
      await finish(
        n.id,
        n.attempts >= MAX_ATTEMPTS || errors.get(n.id) === "DeviceNotRegistered"
          ? "failed"
          : "pending",
        errors.get(n.id) ?? "unknown",
      );
    }
  }
  return claimed.length;
}

export async function disableToken(
  db: SqlClient,
  token: string,
  reason: string,
) {
  await db.query(
    `UPDATE mobility.push_tokens
        SET disabled_at = now(), disabled_reason = $2, updated_at = now()
      WHERE token = $1 AND disabled_at IS NULL`,
    [token, reason.slice(0, 40)],
  );
}

export async function checkReceipts(
  deps: { db: Database; push?: PushGateway | null; now: () => Date },
  limit = 300,
): Promise<number> {
  if (!deps.push) return 0;
  const now = deps.now();
  const { rows } = await deps.db.query<{ ticket_id: string; token: string }>(
    `SELECT ticket_id, token FROM mobility.push_tickets
      WHERE checked_at IS NULL AND created_at <= $1
      ORDER BY created_at LIMIT $2`,
    [new Date(now.getTime() - RECEIPT_DELAY_SECONDS * 1000), limit],
  );
  if (!rows.length) return 0;
  let receipts: Record<string, PushReceipt>;
  try {
    receipts = await deps.push.receipts(rows.map((r) => r.ticket_id));
  } catch {
    log("push_receipts_failed", { count: rows.length });
    return 0;
  }
  for (const { ticket_id, token } of rows) {
    const receipt = receipts[ticket_id];
    if (
      receipt?.status === "error" &&
      receipt.details?.error === "DeviceNotRegistered"
    ) {
      await disableToken(deps.db, token, "DeviceNotRegistered");
    }
    await deps.db.query(
      "UPDATE mobility.push_tickets SET checked_at = $2 WHERE ticket_id = $1",
      [ticket_id, now],
    );
  }
  return rows.length;
}
