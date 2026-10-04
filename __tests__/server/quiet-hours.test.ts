import { randomUUID } from "node:crypto";

import { sweep } from "../../server/rides";
import { assignSupport } from "../../server/routes/admin";
import {
  adminSupportReply,
  createSupport,
  getInbox,
  getNotificationPreferences,
  putNotificationPreferences,
} from "../../server/routes/inbox";
import {
  formatClock,
  inQuietHours,
  isValidTimeZone,
  localMinutes,
  parseClock,
  quietHoursApplyTo,
} from "../../shared/quietHours";

import {
  call,
  createContext,
  resetDb,
  testDb,
  type TestContext,
} from "./helpers";
import {
  adminPost,
  advanceClock,
  assertInvariants,
  assign,
  drive,
  makeOperator,
  onlineDriver,
  registerDevice,
  requestRide,
} from "./scenario";

import type { InboxPage, NotificationPreferences } from "../../shared/account";

const db = testDb();
let ctx: TestContext;

beforeEach(async () => {
  await resetDb(db);
  ctx = createContext(db);
});
afterEach(() => assertInvariants(ctx));
afterAll(() => db.end());

const P = "user_passenger";
const Q = "user_other";
const D = "user_driver";
const OPS = "user_operator";
const P_TOKEN = "ExponentPushToken[passenger]";
const Q_TOKEN = "ExponentPushToken[other]";
const D_TOKEN = "ExponentPushToken[driver]";

const BASE = {
  rideUpdates: true,
  chatMessages: true,
  rideOffers: true,
  accountUpdates: true,
};

const put = (user: string, body: unknown) =>
  call(ctx, putNotificationPreferences, { method: "PUT", user, body });

const quiet = (user: string, start: string, end: string, timezone = "UTC") =>
  put(user, { ...BASE, quietHours: { enabled: true, start, end, timezone } });

const kinds = (token: string) => ctx.push.to(token).map((m) => m.data.kind);

const inbox = async (user: string) =>
  (
    await call(ctx, getInbox, {
      user,
      url: "http://localhost/api/notifications",
    })
  ).json.data as InboxPage;

describe("quiet hours helpers", () => {
  it("parses and formats clock times", () => {
    expect(parseClock("22:00")).toBe(1320);
    expect(parseClock("00:00")).toBe(0);
    expect(parseClock("23:59")).toBe(1439);
    for (const bad of ["24:00", "7:00", "07:60", "0700", "", "ab:cd"]) {
      expect(parseClock(bad)).toBeNull();
    }
    expect(formatClock(1320)).toBe("22:00");
    expect(formatClock(5)).toBe("00:05");
  });

  it("validates IANA time zones", () => {
    expect(isValidTimeZone("Europe/Tirane")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("x".repeat(80))).toBe(false);
  });

  it("handles same-day and overnight ranges", () => {
    const at = (iso: string) => new Date(iso);
    const day = { startMinute: 13 * 60, endMinute: 15 * 60, timeZone: "UTC" };
    expect(inQuietHours(day, at("2026-01-10T12:59:00Z"))).toBe(false);
    expect(inQuietHours(day, at("2026-01-10T13:00:00Z"))).toBe(true);
    expect(inQuietHours(day, at("2026-01-10T14:59:00Z"))).toBe(true);
    expect(inQuietHours(day, at("2026-01-10T15:00:00Z"))).toBe(false);
    const night = { startMinute: 22 * 60, endMinute: 7 * 60, timeZone: "UTC" };
    expect(inQuietHours(night, at("2026-01-10T21:59:00Z"))).toBe(false);
    expect(inQuietHours(night, at("2026-01-10T22:00:00Z"))).toBe(true);
    expect(inQuietHours(night, at("2026-01-11T03:00:00Z"))).toBe(true);
    expect(inQuietHours(night, at("2026-01-11T06:59:00Z"))).toBe(true);
    expect(inQuietHours(night, at("2026-01-11T07:00:00Z"))).toBe(false);
    expect(
      inQuietHours(
        { startMinute: 60, endMinute: 60, timeZone: "UTC" },
        at("2026-01-11T01:00:00Z"),
      ),
    ).toBe(false);
    expect(
      inQuietHours(
        { ...night, timeZone: "Not/AZone" },
        at("2026-01-11T03:00:00Z"),
      ),
    ).toBe(false);
  });

  it("follows the local clock across daylight-saving changes", () => {
    const tirane = {
      startMinute: 22 * 60,
      endMinute: 7 * 60,
      timeZone: "Europe/Tirane",
    };
    expect(
      localMinutes(new Date("2026-03-28T05:30:00Z"), "Europe/Tirane"),
    ).toBe(6 * 60 + 30);
    expect(
      localMinutes(new Date("2026-03-29T05:30:00Z"), "Europe/Tirane"),
    ).toBe(7 * 60 + 30);
    expect(inQuietHours(tirane, new Date("2026-03-28T05:30:00Z"))).toBe(true);
    expect(inQuietHours(tirane, new Date("2026-03-29T05:30:00Z"))).toBe(false);
    expect(inQuietHours(tirane, new Date("2026-03-29T00:30:00Z"))).toBe(true);
    expect(inQuietHours(tirane, new Date("2026-10-25T00:30:00Z"))).toBe(true);
    expect(inQuietHours(tirane, new Date("2026-10-25T05:30:00Z"))).toBe(true);
    expect(inQuietHours(tirane, new Date("2026-10-25T06:30:00Z"))).toBe(false);
    expect(inQuietHours(tirane, new Date("2026-10-24T20:30:00Z"))).toBe(true);
    expect(inQuietHours(tirane, new Date("2026-10-25T20:30:00Z"))).toBe(false);
  });

  it("classifies ride-critical kinds as exempt and the rest as optional", () => {
    for (const kind of [
      "offer",
      "ride_accepted",
      "ride_arrived",
      "ride_started",
      "ride_cancelled",
      "ride_rematching",
      "no_driver",
      "ride_interrupted",
      "pin_waived",
      "chat_message",
      "scheduled_confirm",
    ]) {
      expect([kind, quietHoursApplyTo(kind)]).toEqual([kind, false]);
    }
    for (const kind of [
      "ride_completed",
      "hold_released",
      "application_update",
      "support_update",
      "safety_update",
      "scheduled_expired",
    ]) {
      expect([kind, quietHoursApplyTo(kind)]).toEqual([kind, true]);
    }
  });
});

describe("quiet hours preferences", () => {
  it("validates input and keeps the setting when it's omitted", async () => {
    const fresh = await call(ctx, getNotificationPreferences, { user: P });
    expect(fresh.json.data.quietHours).toBeNull();

    for (const quietHours of [
      { enabled: true, start: "22:00", end: "22:00", timezone: "UTC" },
      { enabled: true, start: "25:00", end: "07:00", timezone: "UTC" },
      { enabled: true, start: "22:00", end: "07:00", timezone: "Mars/Olympus" },
      { enabled: true, start: "22:00", end: "07:00" },
      {
        enabled: true,
        start: "22:00",
        end: "07:00",
        timezone: "UTC",
        extra: 1,
      },
    ]) {
      expect((await put(P, { ...BASE, quietHours })).status).toBe(400);
    }

    const saved = await quiet(P, "22:00", "07:00", "Europe/Tirane");
    expect(saved.status).toBe(200);
    expect(saved.json.data.quietHours).toEqual({
      enabled: true,
      start: "22:00",
      end: "07:00",
      timezone: "Europe/Tirane",
    });

    const toggled = await put(P, { ...BASE, chatMessages: false });
    expect(toggled.json.data).toMatchObject({
      chatMessages: false,
      quietHours: { enabled: true, start: "22:00", timezone: "Europe/Tirane" },
    });

    const other = await call(ctx, getNotificationPreferences, { user: Q });
    expect((other.json.data as NotificationPreferences).quietHours).toBeNull();

    const off = await put(P, {
      ...BASE,
      quietHours: {
        enabled: false,
        start: "22:00",
        end: "07:00",
        timezone: "Europe/Tirane",
      },
    });
    expect(off.json.data.quietHours.enabled).toBe(false);
    const cleared = await put(P, { ...BASE, quietHours: null });
    expect(cleared.json.data.quietHours).toBeNull();
  });

  it("suppresses optional pushes in quiet hours, keeps them in the inbox, and sends ride-critical ones", async () => {
    ctx.clock.now = new Date("2026-01-15T23:30:00Z");
    await registerDevice(ctx, P, P_TOKEN);
    await quiet(P, "22:00", "07:00", "UTC");
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    await drive(ctx, D, rideId);
    await sweep(ctx.deps);

    expect(kinds(P_TOKEN)).toEqual([
      "ride_accepted",
      "ride_arrived",
      "ride_started",
    ]);
    const items = (await inbox(P)).items.map((i) => i.kind);
    expect(items).toEqual(
      expect.arrayContaining([
        "ride_accepted",
        "ride_arrived",
        "ride_started",
        "ride_completed",
      ]),
    );
    const { rows } = await db.query<{ status: string; last_error: string }>(
      "SELECT status, last_error FROM mobility.notifications WHERE kind = 'ride_completed'",
    );
    expect(rows).toEqual([{ status: "skipped", last_error: "quiet_hours" }]);
  });

  it("doesn't send a burst of old notifications when quiet hours end", async () => {
    ctx.clock.now = new Date("2026-01-15T23:30:00Z");
    await makeOperator(ctx, OPS, "view,support");
    await registerDevice(ctx, P, P_TOKEN);
    await registerDevice(ctx, Q, Q_TOKEN);
    await quiet(P, "22:00", "07:00", "UTC");

    const ids: Record<string, string> = {};
    for (const user of [P, Q]) {
      const created = await call(ctx, createSupport, {
        user,
        body: {
          role: "passenger",
          category: "account_issue",
          message: "Please help with my account.",
          clientRequestId: randomUUID(),
        },
      });
      ids[user] = created.json.data.id;
      await adminPost(
        ctx,
        OPS,
        assignSupport,
        { id: ids[user] },
        { expectedVersion: 1 },
      );
      await adminPost(
        ctx,
        OPS,
        adminSupportReply,
        { id: ids[user] },
        { body: "We're on it.", clientMessageId: randomUUID() },
      );
    }
    await sweep(ctx.deps);
    expect(kinds(P_TOKEN)).toEqual([]);
    expect(kinds(Q_TOKEN).length).toBeGreaterThan(0);
    expect((await inbox(P)).unread).toBeGreaterThan(0);

    advanceClock(ctx, 8 * 3600);
    await sweep(ctx.deps);
    await sweep(ctx.deps);
    expect(kinds(P_TOKEN)).toEqual([]);

    await adminPost(
      ctx,
      OPS,
      adminSupportReply,
      { id: ids[P] },
      { body: "Any update from your side?", clientMessageId: randomUUID() },
    );
    await sweep(ctx.deps);
    expect(kinds(P_TOKEN)).toEqual(["support_update"]);
  });

  it("never hides ride requests from an online driver because of quiet hours or other switches", async () => {
    ctx.clock.now = new Date("2026-01-15T23:30:00Z");
    await onlineDriver(ctx, D);
    await registerDevice(ctx, D, D_TOKEN);
    await put(D, {
      ...BASE,
      accountUpdates: false,
      chatMessages: false,
      rideUpdates: false,
      quietHours: {
        enabled: true,
        start: "22:00",
        end: "07:00",
        timezone: "UTC",
      },
    });
    const { rideId } = await requestRide(ctx, P);
    await sweep(ctx.deps);
    expect(kinds(D_TOKEN)).toEqual(["offer"]);
    await assign(ctx, D, rideId);

    await put(D, { ...BASE, rideOffers: false });
    const { rows } = await db.query<{ ride_offers: boolean }>(
      `SELECT ride_offers FROM mobility.notification_preferences p
         JOIN mobility.users u ON u.id = p.user_id WHERE u.clerk_id = $1`,
      [D],
    );
    expect(rows[0].ride_offers).toBe(false);
  });

  it("applies each user's own time zone", async () => {
    ctx.clock.now = new Date("2026-01-15T21:30:00Z");
    await makeOperator(ctx, OPS, "view,support");
    await registerDevice(ctx, P, P_TOKEN);
    await registerDevice(ctx, Q, Q_TOKEN);
    await quiet(P, "22:00", "07:00", "Europe/Tirane");
    await quiet(Q, "22:00", "07:00", "UTC");
    for (const user of [P, Q]) {
      const created = await call(ctx, createSupport, {
        user,
        body: {
          role: "passenger",
          category: "account_issue",
          message: "Please help with my account.",
          clientRequestId: randomUUID(),
        },
      });
      const id = created.json.data.id;
      await adminPost(ctx, OPS, assignSupport, { id }, { expectedVersion: 1 });
    }
    await sweep(ctx.deps);
    expect(kinds(P_TOKEN)).toEqual([]);
    expect(kinds(Q_TOKEN)).toEqual(["support_update"]);
  });
});
