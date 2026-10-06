import { randomUUID } from "node:crypto";

import { sweep } from "../../server/rides";
import { rideDetail } from "../../server/routes/admin";
import { getInbox } from "../../server/routes/inbox";
import { runSweep } from "../../server/routes/internal";
import { deleteAccount, getAccount } from "../../server/routes/profile";
import { createBooking } from "../../server/routes/rides";
import {
  cancelSchedule,
  createSchedule,
  getSchedule,
  getScheduleWindow,
  listSchedules,
  quoteSchedule,
} from "../../server/routes/scheduled";
import { SCHEDULE_RULES } from "../../shared/schedule";
import { formatInZone, resolveLocalTime } from "../../shared/zonedTime";

import {
  call,
  createContext,
  DESTINATION,
  PICKUP,
  resetDb,
  testDb,
  type TestContext,
} from "./helpers";
import {
  adminGet,
  advanceClock,
  assertInvariants,
  assign,
  drive,
  makeOperator,
  onlineDriver,
  refresh,
  registerDevice,
  requestRide,
  viewRide,
} from "./scenario";

import type { InboxPage } from "../../shared/account";
import type { RideView } from "../../shared/contracts";
import type {
  ScheduledRideList,
  ScheduledRideView,
} from "../../shared/schedule";

const db = testDb();
let ctx: TestContext;

const START = new Date("2026-06-10T09:00:00Z");

beforeEach(async () => {
  await resetDb(db);
  ctx = createContext(db);
  ctx.clock.now = new Date(START);
  process.env.CRON_SECRET = "test-cron-secret-123";
});
afterEach(() => assertInvariants(ctx));
afterAll(() => db.end());

const P = "user_passenger";
const Q = "user_other";
const D = "user_driver";
const TOKEN = "ExponentPushToken[passenger]";

const localIn = (minutes: number, zone = "UTC") =>
  formatInZone(new Date(ctx.clock.now.getTime() + minutes * 60_000), zone)!;

const schedule = (user: string, body: object = {}) =>
  call(ctx, createSchedule, {
    user,
    body: {
      pickup: PICKUP,
      destination: DESTINATION,
      localTime: localIn(120),
      clientRequestId: randomUUID(),
      ...body,
    },
  });

const get = async (user: string, id: string) =>
  (await call(ctx, getSchedule, { user, params: { id } })).json
    .data as ScheduledRideView;

const quoteFor = (user: string, id: string) =>
  call(ctx, quoteSchedule, { method: "POST", user, params: { id } });

const kinds = () => ctx.push.to(TOKEN).map((m) => m.data.kind);

async function openForConfirmation(body: object = {}) {
  await registerDevice(ctx, P, TOKEN);
  const created = await schedule(P, body);
  expect(created.status).toBe(201);
  const id = created.json.data.id as string;
  advanceClock(ctx, (120 - SCHEDULE_RULES.confirmLeadMinutes) * 60 + 5);
  await sweep(ctx.deps);
  return id;
}

async function confirm(id: string) {
  const quote = await quoteFor(P, id);
  expect(quote.status).toBe(201);
  const booking = await call(ctx, createBooking, {
    user: P,
    body: { quoteId: quote.json.data.quote.id },
  });
  expect(booking.status).toBe(201);
  const rideId = booking.json.data.rideId as string;
  const intent = [...ctx.stripe.intents.values()].find(
    (i) => i.metadata.ride_id === rideId,
  )!;
  return { rideId, intentId: intent.id, quote: quote.json.data.quote };
}

describe("local time resolution", () => {
  it("resolves ordinary, skipped and repeated local times", () => {
    expect(resolveLocalTime("2026-06-10T12:00", "UTC")).toEqual({
      kind: "ok",
      instant: new Date("2026-06-10T12:00:00Z"),
    });
    expect(resolveLocalTime("2026-06-10T12:00", "Europe/Tirane")).toEqual({
      kind: "ok",
      instant: new Date("2026-06-10T10:00:00Z"),
    });
    expect(resolveLocalTime("2026-01-10T12:00", "Europe/Tirane")).toEqual({
      kind: "ok",
      instant: new Date("2026-01-10T11:00:00Z"),
    });
    expect(resolveLocalTime("2026-03-29T02:30", "Europe/Tirane")).toEqual({
      kind: "nonexistent",
    });
    expect(resolveLocalTime("2026-10-25T02:30", "Europe/Tirane")).toEqual({
      kind: "ambiguous",
      earlier: new Date("2026-10-25T00:30:00Z"),
      later: new Date("2026-10-25T01:30:00Z"),
    });
    expect(resolveLocalTime("2026-02-30T10:00", "UTC")).toEqual({
      kind: "invalid",
    });
    expect(resolveLocalTime("2026-06-10T25:00", "UTC")).toEqual({
      kind: "invalid",
    });
    expect(resolveLocalTime("2026-06-10T12:00", "Mars/Olympus")).toEqual({
      kind: "invalid",
    });
    expect(
      formatInZone(new Date("2026-06-10T22:30:00Z"), "Europe/Tirane"),
    ).toBe("2026-06-11T00:30");
  });
});

describe("scheduling a ride request", () => {
  it("stores the intention with the service area's time zone and promises nothing", async () => {
    await db.query(
      "UPDATE mobility.service_areas SET timezone = 'Europe/Tirane'",
    );
    const window = await call(ctx, getScheduleWindow, {
      user: P,
      url: `http://localhost/api/scheduled-rides/window?latitude=${PICKUP.latitude}&longitude=${PICKUP.longitude}`,
    });
    expect(window.json.data).toMatchObject({
      timezone: "Europe/Tirane",
      localNow: "2026-06-10T11:00",
    });

    const created = await schedule(P, { localTime: "2026-06-10T14:30" });
    expect(created.status).toBe(201);
    const view = created.json.data as ScheduledRideView;
    expect(view).toMatchObject({
      state: "scheduled",
      timezone: "Europe/Tirane",
      localTime: "2026-06-10T14:30",
      pickupAt: "2026-06-10T12:30:00.000Z",
      confirmFrom: "2026-06-10T12:10:00.000Z",
      confirmBy: "2026-06-10T12:40:00.000Z",
      rideId: null,
      canCancel: true,
      canConfirm: false,
      passengerCount: 1,
    });
    expect(ctx.routing.calls).toHaveLength(0);
    expect(ctx.stripe.intents.size).toBe(0);
    const { rows } = await db.query(
      "SELECT (SELECT count(*)::int FROM mobility.quotes) AS quotes, (SELECT count(*)::int FROM mobility.rides) AS rides",
    );
    expect(rows[0]).toEqual({ quotes: 0, rides: 0 });
    expect(JSON.stringify(view)).not.toMatch(/fare|price|cents/i);
  });

  it("rejects past, too-soon, too-far, skipped and ambiguous times, and bad places", async () => {
    await db.query(
      "UPDATE mobility.service_areas SET timezone = 'Europe/Tirane'",
    );
    const code = async (body: object) => {
      const res = await schedule(P, body);
      return [res.status, res.json.error?.code];
    };
    expect(await code({ localTime: "2026-06-09T12:00" })).toEqual([
      422,
      "SCHEDULE_TOO_SOON",
    ]);
    expect(await code({ localTime: "2026-06-10T11:10" })).toEqual([
      422,
      "SCHEDULE_TOO_SOON",
    ]);
    expect(await code({ localTime: "2026-06-20T12:00" })).toEqual([
      422,
      "SCHEDULE_TOO_FAR",
    ]);
    expect(await code({ localTime: "2026-06-10 14:30" })).toEqual([
      400,
      "INVALID_INPUT",
    ]);
    expect(await code({ localTime: "2026-02-31T10:00" })).toEqual([
      400,
      "INVALID_INPUT",
    ]);
    expect(
      await code({
        destination: { address: "Far", latitude: 10, longitude: 10 },
      }),
    ).toEqual([422, "DESTINATION_OUTSIDE_SERVICE_AREA"]);
    expect(await code({ passengerCount: 7 })).toEqual([
      422,
      "TOO_MANY_PASSENGERS",
    ]);

    ctx.clock.now = new Date("2026-03-28T12:00:00Z");
    expect(await code({ localTime: "2026-03-29T02:30" })).toEqual([
      422,
      "SCHEDULE_TIME_SKIPPED",
    ]);
    ctx.clock.now = new Date("2026-10-24T12:00:00Z");
    expect(await code({ localTime: "2026-10-25T02:30" })).toEqual([
      422,
      "SCHEDULE_TIME_AMBIGUOUS",
    ]);
    const later = await schedule(P, {
      localTime: "2026-10-25T02:30",
      fold: "later",
    });
    expect(later.status).toBe(201);
    expect(later.json.data.pickupAt).toBe("2026-10-25T01:30:00.000Z");
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.scheduled_rides",
    );
    expect(rows[0].n).toBe(1);
  });

  it("is idempotent per submission, limits upcoming requests and refuses overlapping ones", async () => {
    const clientRequestId = randomUUID();
    const [a, b] = await Promise.all([
      schedule(P, { clientRequestId }),
      schedule(P, { clientRequestId }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.json.data.id).toBe(b.json.data.id);
    const overlap = await schedule(P, { localTime: localIn(130) });
    expect(overlap.status).toBe(409);
    expect(overlap.json.error.code).toBe("SCHEDULE_OVERLAP");
    for (let i = 1; i < SCHEDULE_RULES.maxUpcoming; i++) {
      expect(
        (await schedule(P, { localTime: localIn(120 + i * 90) })).status,
      ).toBe(201);
    }
    const over = await schedule(P, { localTime: localIn(1000) });
    expect(over.status).toBe(409);
    expect(over.json.error.code).toBe("SCHEDULE_LIMIT");
    expect((await schedule(Q, {})).status).toBe(201);
  });

  it("keeps each passenger's schedules private", async () => {
    const id = (await schedule(P)).json.data.id as string;
    expect(
      (await call(ctx, getSchedule, { user: Q, params: { id } })).status,
    ).toBe(404);
    expect(
      (
        await call(ctx, cancelSchedule, {
          method: "POST",
          user: Q,
          params: { id },
        })
      ).status,
    ).toBe(404);
    expect((await quoteFor(Q, id)).status).toBe(404);
    const list = (await call(ctx, listSchedules, { user: Q })).json
      .data as ScheduledRideList;
    expect(list.upcoming).toEqual([]);
    expect((await call(ctx, listSchedules, {})).status).toBe(401);
  });
});

describe("confirmation and dispatch", () => {
  it("notifies near pickup, gives a fresh price, and starts matching only after payment is authorized", async () => {
    const id = await openForConfirmation();
    await onlineDriver(ctx, D);
    expect(kinds()).toEqual(["scheduled_confirm"]);
    expect(ctx.push.to(TOKEN)[0].data.target).toBe(`/scheduled/${id}`);
    const waiting = await get(P, id);
    expect(waiting).toMatchObject({
      state: "awaiting_confirmation",
      canConfirm: true,
    });
    expect(ctx.stripe.intents.size).toBe(0);
    const { rows: none } = await db.query("SELECT 1 FROM mobility.rides");
    expect(none).toEqual([]);

    const { rideId, intentId, quote } = await confirm(id);
    expect(new Date(quote.expiresAt).getTime()).toBeGreaterThan(
      ctx.clock.now.getTime(),
    );
    expect(await get(P, id)).toMatchObject({
      state: "awaiting_confirmation",
      rideId: null,
    });
    expect((await db.query("SELECT 1 FROM mobility.ride_offers")).rows).toEqual(
      [],
    );

    ctx.stripe.authorize(intentId);
    const view = await refresh(ctx, P, rideId);
    expect(view.status).toBe("offered");
    expect(await get(P, id)).toMatchObject({
      state: "searching",
      rideId,
      canCancel: false,
    });

    await assign(ctx, D, rideId);
    await drive(ctx, D, rideId);
    expect(await get(P, id)).toMatchObject({
      state: "fulfilled",
      rideStatus: "completed",
    });
    expect(ctx.stripe.effectiveCaptures).toBe(1);
    const list = (await call(ctx, listSchedules, { user: P })).json
      .data as ScheduledRideList;
    expect(list.upcoming).toEqual([]);
    expect(list.past.map((s) => s.id)).toEqual([id]);

    await makeOperator(ctx, "user_viewer", "view");
    const detail = await adminGet(ctx, "user_viewer", rideDetail, {
      params: { id: rideId },
    });
    expect(detail.json.data.ride.fromScheduledRequest).toBe(true);
    const passengerView = (await viewRide(ctx, P, rideId)).json
      .data as RideView;
    expect(passengerView.scheduledRideId).toBe(id);
    const driverView = (await viewRide(ctx, D, rideId)).json.data as RideView;
    expect(driverView.scheduledRideId).toBeNull();
  });

  it("won't quote before the confirmation window opens and never reuses an old price", async () => {
    const created = await schedule(P);
    const id = created.json.data.id as string;
    const early = await quoteFor(P, id);
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe("SCHEDULE_NOT_OPEN");
    expect(ctx.routing.calls).toHaveLength(0);

    advanceClock(ctx, (120 - SCHEDULE_RULES.confirmLeadMinutes) * 60 + 5);
    await sweep(ctx.deps);
    const first = await quoteFor(P, id);
    expect(first.status).toBe(201);
    advanceClock(ctx, 11 * 60);
    ctx.routing.distanceMeters = 6200;
    const second = await quoteFor(P, id);
    expect(second.status).toBe(201);
    expect(second.json.data.quote.id).not.toBe(first.json.data.quote.id);
    expect(second.json.data.quote.fareCents).toBeGreaterThan(
      first.json.data.quote.fareCents,
    );
    const stale = await call(ctx, createBooking, {
      user: P,
      body: { quoteId: first.json.data.quote.id },
    });
    expect(stale.status).toBe(410);
    expect(stale.json.error.code).toBe("QUOTE_EXPIRED");
  });

  it("expires without a charge when it isn't confirmed in time, and tells the passenger once", async () => {
    const id = await openForConfirmation();
    advanceClock(
      ctx,
      (SCHEDULE_RULES.confirmLeadMinutes + SCHEDULE_RULES.confirmGraceMinutes) *
        60 +
        30,
    );
    await sweep(ctx.deps);
    await sweep(ctx.deps);
    expect(await get(P, id)).toMatchObject({
      state: "expired",
      endReason: "not_confirmed",
      canConfirm: false,
      canCancel: false,
    });
    expect(kinds()).toEqual(["scheduled_confirm", "scheduled_expired"]);
    expect(ctx.stripe.intents.size).toBe(0);
    const late = await quoteFor(P, id);
    expect(late.status).toBe(409);
    expect(late.json.error.code).toBe("SCHEDULE_CLOSED");
    const inbox = (
      await call(ctx, getInbox, {
        user: P,
        url: "http://localhost/api/notifications",
      })
    ).json.data as InboxPage;
    expect(
      inbox.items.filter((i) => i.kind === "scheduled_expired"),
    ).toHaveLength(1);
  });

  it("refuses to book a scheduled quote after the request expired or was cancelled", async () => {
    const id = await openForConfirmation();
    const quote = await quoteFor(P, id);
    const cancelled = await call(ctx, cancelSchedule, {
      method: "POST",
      user: P,
      params: { id },
    });
    expect(cancelled.json.data.state).toBe("cancelled");
    const booking = await call(ctx, createBooking, {
      user: P,
      body: { quoteId: quote.json.data.quote.id },
    });
    expect(booking.status).toBe(409);
    expect(booking.json.error.code).toBe("SCHEDULE_CLOSED");
    expect(ctx.stripe.intents.size).toBe(0);
  });

  it("handles a missed scheduler: late runs expire the request instead of dispatching it", async () => {
    await registerDevice(ctx, P, TOKEN);
    const id = (await schedule(P)).json.data.id as string;
    advanceClock(ctx, 5 * 3600);
    await sweep(ctx.deps);
    expect(await get(P, id)).toMatchObject({
      state: "expired",
      endReason: "missed_window",
    });
    expect(kinds()).toEqual(["scheduled_expired"]);
  });

  it("still opens the confirmation when the scheduler runs late but inside the window", async () => {
    await registerDevice(ctx, P, TOKEN);
    const id = (await schedule(P)).json.data.id as string;
    advanceClock(ctx, 125 * 60);
    await sweep(ctx.deps);
    expect(await get(P, id)).toMatchObject({
      state: "awaiting_confirmation",
      canConfirm: true,
    });
    expect((await quoteFor(P, id)).status).toBe(201);
  });

  it("opens each request exactly once under scheduler replays and concurrent runs", async () => {
    await registerDevice(ctx, P, TOKEN);
    const id = (await schedule(P)).json.data.id as string;
    advanceClock(ctx, (120 - SCHEDULE_RULES.confirmLeadMinutes) * 60 + 5);
    const bearer = { authorization: `Bearer ${process.env.CRON_SECRET}` };
    const runs = await Promise.all(
      [1, 2, 3].map(() =>
        call(ctx, runSweep, { method: "POST", headers: bearer }),
      ),
    );
    expect(runs.every((r) => r.status === 200)).toBe(true);
    await sweep(ctx.deps);
    await sweep(ctx.deps);
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM mobility.notifications WHERE kind = 'scheduled_confirm'",
    );
    expect(rows[0].n).toBe(1);
    expect(kinds()).toEqual(["scheduled_confirm"]);
    expect((await get(P, id)).state).toBe("awaiting_confirmation");
  });

  it("revalidates coverage and category at dispatch time", async () => {
    await registerDevice(ctx, P, TOKEN);
    const first = (await schedule(P)).json.data.id as string;
    const second = (await schedule(Q)).json.data.id as string;
    await db.query(
      `UPDATE mobility.scheduled_rides SET vehicle_category_id = NULL WHERE id = $1`,
      [second],
    );
    await db.query(
      "UPDATE mobility.vehicle_categories SET status = 'inactive' WHERE is_default",
    );
    advanceClock(ctx, (120 - SCHEDULE_RULES.confirmLeadMinutes) * 60 + 5);
    await sweep(ctx.deps);
    expect(await get(P, first)).toMatchObject({
      state: "expired",
      endReason: "category_unavailable",
    });
    expect((await get(Q, second)).state).toBe("awaiting_confirmation");
    await db.query(
      "UPDATE mobility.vehicle_categories SET status = 'active' WHERE is_default",
    );

    const third = (await schedule(P, { localTime: localIn(200) })).json.data
      .id as string;
    await db.query("UPDATE mobility.service_areas SET status = 'inactive'");
    advanceClock(ctx, (200 - SCHEDULE_RULES.confirmLeadMinutes) * 60 + 5);
    await sweep(ctx.deps);
    expect(await get(P, third)).toMatchObject({
      state: "expired",
      endReason: "area_unavailable",
    });
    await db.query("UPDATE mobility.service_areas SET status = 'active'");
  });

  it("can't create a second active ride: confirmation waits while another ride is active", async () => {
    const id = await openForConfirmation();
    await onlineDriver(ctx, D);
    const { rideId: active } = await requestRide(ctx, P);
    const quote = await quoteFor(P, id);
    expect(quote.status).toBe(201);
    const booking = await call(ctx, createBooking, {
      user: P,
      body: { quoteId: quote.json.data.quote.id },
    });
    expect(booking.status).toBe(409);
    expect(booking.json.error.code).toBe("ACTIVE_RIDE_EXISTS");
    expect(await get(P, id)).toMatchObject({
      state: "awaiting_confirmation",
      rideId: null,
    });
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM mobility.rides WHERE user_id = (SELECT id FROM mobility.users WHERE clerk_id = $1) AND status = ANY($2::text[])",
      [
        P,
        [
          "requested",
          "offered",
          "accepted",
          "arriving",
          "arrived",
          "in_progress",
        ],
      ],
    );
    expect(rows[0].n).toBe(1);
    expect(
      ((await viewRide(ctx, P, active)).json.data as RideView).status,
    ).toBe("offered");
  });

  it("keeps the normal no-driver and cancellation rules after dispatch", async () => {
    const id = await openForConfirmation();
    const { rideId, intentId } = await confirm(id);
    ctx.stripe.authorize(intentId);
    await refresh(ctx, P, rideId);
    expect((await get(P, id)).state).toBe("searching");
    advanceClock(ctx, 130);
    await sweep(ctx.deps);
    expect(await get(P, id)).toMatchObject({
      state: "no_driver",
      rideStatus: "no_driver",
    });
    expect(ctx.stripe.intents.get(intentId)!.status).toBe("canceled");
    expect(ctx.stripe.effectiveCaptures).toBe(0);
    await sweep(ctx.deps);
    const { rows } = await db.query<{ status: string }>(
      "SELECT status FROM mobility.scheduled_rides WHERE id = $1",
      [id],
    );
    expect(rows[0].status).toBe("confirmed");
  });

  it("lets the passenger try payment again if the first authorization was abandoned", async () => {
    const id = await openForConfirmation();
    const first = await confirm(id);
    advanceClock(ctx, 60);
    const cancelled = await call(ctx, cancelSchedule, {
      method: "POST",
      user: Q,
      params: { id },
    });
    expect(cancelled.status).toBe(404);
    const again = await quoteFor(P, id);
    expect(again.status).toBe(201);
    const rebook = await call(ctx, createBooking, {
      user: P,
      body: { quoteId: again.json.data.quote.id },
    });
    expect(rebook.status).toBe(201);
    expect(rebook.json.data.rideId).not.toBe(first.rideId);
    const intent = [...ctx.stripe.intents.values()].find(
      (i) => i.metadata.ride_id === rebook.json.data.rideId,
    )!;
    ctx.stripe.authorize(intent.id);
    await refresh(ctx, P, rebook.json.data.rideId);
    expect(await get(P, id)).toMatchObject({
      state: "searching",
      rideId: rebook.json.data.rideId,
    });
  });

  it("cancels an upcoming request, including a half-finished payment, without a charge", async () => {
    const id = await openForConfirmation();
    const { rideId, intentId } = await confirm(id);
    const res = await call(ctx, cancelSchedule, {
      method: "POST",
      user: P,
      params: { id },
    });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      state: "cancelled",
      endReason: "cancelled_by_passenger",
    });
    expect(
      ((await viewRide(ctx, P, rideId)).json.data as RideView).status,
    ).toBe("cancelled");
    expect(ctx.stripe.intents.get(intentId)!.status).not.toBe("succeeded");
    const again = await call(ctx, cancelSchedule, {
      method: "POST",
      user: P,
      params: { id },
    });
    expect(again.status).toBe(200);
    advanceClock(ctx, 3600);
    await sweep(ctx.deps);
    expect((await get(P, id)).state).toBe("cancelled");
    expect(kinds()).toEqual(["scheduled_confirm"]);
  });

  it("removes upcoming schedules when the account is deleted", async () => {
    await schedule(P);
    await call(ctx, getAccount, { user: P });
    const deleted = await call(ctx, deleteAccount, {
      user: P,
      factorAgeMinutes: 1,
      body: { confirm: "DELETE" },
    });
    expect(deleted.status).toBe(200);
    const { rows } = await db.query("SELECT 1 FROM mobility.scheduled_rides");
    expect(rows).toEqual([]);
    advanceClock(ctx, 3 * 3600);
    await sweep(ctx.deps);
    expect(ctx.stripe.intents.size).toBe(0);
  });
});
