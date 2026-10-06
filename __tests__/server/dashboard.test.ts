import { randomUUID } from "node:crypto";

import { clearDashboardCache } from "../../server/dashboard";
import { sweep } from "../../server/rides";
import { createRefund } from "../../server/routes/admin";
import { createSupport } from "../../server/routes/inbox";
import { createSchedule } from "../../server/routes/scheduled";
import { adminDashboard } from "../../server/routes/system";
import { DASHBOARD_RULES } from "../../shared/adminDashboard";

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
  adminPost,
  advanceClock,
  apply,
  assertInvariants,
  assign,
  cancel,
  drive,
  goOffline,
  makeOperator,
  onlineDriver,
  requestRide,
} from "./scenario";

import type { DashboardView } from "../../shared/adminDashboard";

const db = testDb();
let ctx: TestContext;

const START = new Date("2026-06-10T09:00:00Z");

beforeEach(async () => {
  await resetDb(db);
  clearDashboardCache();
  ctx = createContext(db);
  ctx.clock.now = new Date(START);
});
afterEach(() => assertInvariants(ctx));
afterAll(() => db.end());

const OPS = "user_operator";
const VIEW = "user_viewer";
const FULL = "user_full";
const D = "user_driver";
const D2 = "user_driver_two";

const dash = async (user = OPS, query: Record<string, string> = {}) => {
  clearDashboardCache();
  const res = await call(ctx, adminDashboard, {
    user,
    url: `http://localhost/api/admin/dashboard?${new URLSearchParams(query)}`,
  });
  return res;
};

const view = async (user = OPS, query: Record<string, string> = {}) =>
  (await dash(user, query)).json.data as DashboardView;

describe("operations dashboard", () => {
  beforeEach(async () => {
    await makeOperator(ctx, OPS, "view,support,refund");
    await makeOperator(ctx, VIEW, "view");
    await makeOperator(ctx, FULL, "view,support,verify");
  });

  it("is only for operators and hides queues the operator may not see", async () => {
    expect((await dash("user_someone")).status).toBe(403);
    expect((await call(ctx, adminDashboard, {})).status).toBe(401);
    const limited = await view(VIEW);
    expect(limited.live!.queues.safetyOpen).toBeNull();
    expect(limited.live!.queues.driverApplications).toBeNull();
    const full = await view(FULL);
    expect(full.live!.queues.safetyOpen).toBe(0);
    expect(full.live!.queues.driverApplications).toBe(0);
    const { rows } = await db.query<{ result: string }>(
      "SELECT result FROM mobility.audit_log WHERE action = 'dashboard_denied'",
    );
    expect(rows).toEqual([{ result: "denied" }]);
  });

  it("validates the date range and documents its time zone", async () => {
    const d = await view();
    expect(d.timezone).toBe("UTC");
    expect(d.from).toBe("2026-06-10T00:00:00.000Z");
    expect(d.to).toBe(START.toISOString());
    expect(d.generatedAt).toBe(START.toISOString());
    expect(d.unavailable).toEqual([]);
    expect(
      (
        await dash(OPS, {
          from: "2026-06-10T00:00:00Z",
          to: "2026-06-09T00:00:00Z",
        })
      ).status,
    ).toBe(400);
    const tooLong = await dash(OPS, {
      from: "2026-01-01T00:00:00Z",
      to: "2026-06-10T00:00:00Z",
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.json.error.code).toBe("RANGE_TOO_LONG");
    expect((await dash(OPS, { from: "yesterday" })).status).toBe(400);
    expect((await dash(OPS, { rideId: "1" })).status).toBe(400);
  });

  it("counts active rides, searching time and drivers who are really available", async () => {
    await onlineDriver(ctx, D, 300);
    await onlineDriver(ctx, D2, 900);
    await apply(ctx, "user_driver_pending");
    let d = await view();
    expect(d.live!.drivers).toEqual({
      approvedOnline: 2,
      eligibleAvailable: 2,
    });

    const { rideId } = await requestRide(ctx, "user_p1");
    advanceClock(ctx, 12);
    d = await view();
    expect(d.live!.activeByStatus.offered).toBe(1);
    expect(d.live!.searching.count).toBe(1);
    expect(d.live!.searching.oldestSeconds).toBeGreaterThanOrEqual(12);

    await assign(ctx, D, rideId);
    d = await view();
    expect(d.live!.activeByStatus).toMatchObject({ offered: 0, accepted: 1 });
    expect(d.live!.searching).toEqual({
      count: 0,
      oldestSeconds: null,
      averageSeconds: null,
    });
    expect(d.live!.drivers).toEqual({
      approvedOnline: 2,
      eligibleAvailable: 1,
    });

    await db.query(
      "DELETE FROM mobility.driver_vehicle_categories WHERE driver_profile_id IN (SELECT dp.id FROM mobility.driver_profiles dp JOIN mobility.users u ON u.id = dp.user_id WHERE u.clerk_id = $1)",
      [D2],
    );
    d = await view();
    expect(d.live!.drivers).toEqual({
      approvedOnline: 2,
      eligibleAvailable: 0,
    });
    await goOffline(ctx, D2);
    expect((await view()).live!.drivers.approvedOnline).toBe(1);
  });

  it("reports outcomes and rates against rides whose search started in the range", async () => {
    await onlineDriver(ctx, D, 300);
    const completed = await requestRide(ctx, "user_p1");
    await assign(ctx, D, completed.rideId);
    advanceClock(ctx, 30);
    await drive(ctx, D, completed.rideId);

    const cancelled = await requestRide(ctx, "user_p2");
    await cancel(ctx, "user_p2", cancelled.rideId);

    await goOffline(ctx, D);
    const nobody = await requestRide(ctx, "user_p3");
    advanceClock(ctx, 130);
    await sweep(ctx.deps);

    const waiting = await requestRide(ctx, "user_p4");
    expect(waiting.view.status).toBe("requested");
    await requestRide(ctx, "user_p5", { authorize: false });

    const d = await view();
    expect(d.period!.requests).toEqual({
      total: 4,
      completed: 1,
      cancelledByPassenger: 1,
      cancelledByDriver: 0,
      cancelledBySystem: 0,
      noDriver: 1,
      interrupted: 0,
      stillActive: 1,
      cancellationRate: 0.25,
      noDriverRate: 0.25,
    });
    expect(d.period!.search.accepted).toBe(1);
    expect(d.live!.activeByStatus).toMatchObject({
      requested: 1,
      awaiting_payment: 1,
    });
    expect(nobody.rideId).toBeTruthy();

    const before = await view(OPS, {
      from: "2026-06-09T00:00:00Z",
      to: "2026-06-10T00:00:00Z",
    });
    expect(before.period!.requests.total).toBe(0);
    expect(before.period!.requests.cancellationRate).toBeNull();
    expect(before.period!.requests.noDriverRate).toBeNull();
  });

  it("keeps captured fares, refunds, ledger earnings and payouts apart", async () => {
    await onlineDriver(ctx, D, 300);
    const { rideId } = await requestRide(ctx, "user_p1");
    await assign(ctx, D, rideId);
    await drive(ctx, D, rideId);
    const { rows } = await db.query<{ fare_cents: number }>(
      "SELECT fare_cents FROM mobility.rides WHERE id = $1",
      [rideId],
    );
    const fare = rows[0].fare_cents;

    let d = await view();
    expect(d.period!.money).toEqual({
      currency: "usd",
      faresCapturedCents: fare,
      tipsCapturedCents: 0,
      refundedCents: 0,
      ledgerDriverEarningsCents: fare,
      ledgerCommissionCents: 0,
      collectedPosCents: 0,
      collectedCashCents: 0,
      transfersToDriversCents: 0,
      transfersFromDriversCents: 0,
      payouts: { available: false, paidOutCents: 0 },
    });

    const refund = await adminPost(
      ctx,
      OPS,
      createRefund,
      { id: rideId },
      {
        amountCents: 200,
        reason: "Goodwill for a late pickup",
        expectedMaxRefundableCents: fare,
        idempotencyKey: randomUUID(),
      },
    );
    expect(refund.status).toBe(201);
    d = await view();
    expect(d.period!.money).toMatchObject({
      faresCapturedCents: fare,
      ledgerDriverEarningsCents: fare - 200,
      collectedPosCents: 0,
      collectedCashCents: 0,
      transfersToDriversCents: 0,
      transfersFromDriversCents: 0,
      payouts: { available: false, paidOutCents: 0 },
    });
    const refundWindow = await view(OPS, {
      from: new Date(Date.now() - 3600_000).toISOString(),
      to: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(refundWindow.period!.money.refundedCents).toBe(200);
    expect(refundWindow.period!.money.faresCapturedCents).toBe(0);
    expect(JSON.stringify(d)).not.toMatch(/paid ?out to drivers|payout_/i);
  });

  it("shows captures and releases that are still waiting for the payment provider", async () => {
    await onlineDriver(ctx, D, 300);
    const done = await requestRide(ctx, "user_p1");
    await assign(ctx, D, done.rideId);
    ctx.stripe.failNext.capture = true;
    await drive(ctx, D, done.rideId);
    const dropped = await requestRide(ctx, "user_p2");
    ctx.stripe.failNext.cancel = true;
    await cancel(ctx, "user_p2", dropped.rideId);

    let d = await view();
    expect(d.live!.settlement).toEqual({
      capturesAwaiting: 1,
      releasesAwaiting: 1,
      retrying: 2,
    });
    expect(d.period!.money.faresCapturedCents).toBe(0);
    expect(d.period!.money.ledgerDriverEarningsCents).toBe(0);

    advanceClock(ctx, 120);
    await sweep(ctx.deps);
    d = await view();
    expect(d.live!.settlement).toEqual({
      capturesAwaiting: 0,
      releasesAwaiting: 0,
      retrying: 0,
    });
    expect(d.period!.money.faresCapturedCents).toBeGreaterThan(0);
  });

  it("counts support, scheduled requests and review items without personal data", async () => {
    await call(ctx, createSupport, {
      user: "user_p1",
      body: {
        role: "passenger",
        category: "account_issue",
        message: "Jane Private needs help at 12 Secret Street.",
        clientRequestId: randomUUID(),
      },
    });
    await call(ctx, createSchedule, {
      user: "user_p1",
      body: {
        pickup: PICKUP,
        destination: DESTINATION,
        localTime: "2026-06-10T12:00",
        clientRequestId: randomUUID(),
      },
    });
    const res = await dash(FULL);
    const d = res.json.data as DashboardView;
    expect(d.live!.queues).toMatchObject({
      supportOpen: 1,
      supportAwaitingReply: 1,
      safetyOpen: 0,
      driverApplications: 0,
      reviewOpen: 0,
      financialIssues: 0,
      disputesOpen: 0,
    });
    expect(d.live!.scheduled).toEqual({ upcoming: 1, awaitingConfirmation: 0 });
    expect(d.period!.scheduled).toEqual({ created: 1, expired: 0 });
    expect(JSON.stringify(res.json)).not.toMatch(
      /Jane|Secret Street|user_p1|Market St|clerk|@/,
    );
  });

  it("serves a short-lived cached copy and says when it was generated", async () => {
    clearDashboardCache();
    const first = (await call(ctx, adminDashboard, { user: OPS })).json
      .data as DashboardView;
    await onlineDriver(ctx, D, 300);
    advanceClock(ctx, DASHBOARD_RULES.cacheSeconds - 5);
    const cached = (await call(ctx, adminDashboard, { user: OPS })).json
      .data as DashboardView;
    expect(cached.generatedAt).toBe(first.generatedAt);
    expect(cached.live!.drivers.approvedOnline).toBe(0);
    const other = (await call(ctx, adminDashboard, { user: VIEW })).json
      .data as DashboardView;
    expect(other.live!.drivers.approvedOnline).toBe(1);
    advanceClock(ctx, 10);
    const fresh = (await call(ctx, adminDashboard, { user: OPS })).json
      .data as DashboardView;
    expect(fresh.generatedAt).not.toBe(first.generatedAt);
  });

  it("reports a section as unavailable instead of returning zeros", async () => {
    await onlineDriver(ctx, D, 300);
    const failing = {
      ...ctx.deps,
      db: {
        connect: () => ctx.db.connect(),
        query: (text: string, values?: unknown[]) =>
          /FROM mobility\.earning_entries/.test(text)
            ? Promise.reject(new Error("statement timeout"))
            : ctx.db.query(text, values),
      },
    };
    clearDashboardCache();
    const original = ctx.deps;
    ctx.deps = failing as never;
    const res = await call(ctx, adminDashboard, { user: OPS });
    ctx.deps = original;
    const d = res.json.data as DashboardView;
    expect(res.status).toBe(200);
    expect(d.unavailable).toEqual(["period"]);
    expect(d.period).toBeNull();
    expect(d.live!.drivers.approvedOnline).toBe(1);
  });
});
