import { randomUUID } from "node:crypto";

import { sanitizeDetail } from "../../server/operators";
import { sweep } from "../../server/rides";
import {
  addSupportNote,
  adminMe,
  assignSupport,
  createRefund,
  listReview,
  listSupport,
  reopenSupport,
  resolveReview,
  resolveSupport,
  rideDetail,
  searchRides,
  supportDetail,
  syncRefund,
} from "../../server/routes/admin";
import { updateProfile } from "../../server/routes/profile";
import {
  createSupportRequest,
  listRideSupport,
} from "../../server/routes/receipts";
import { stripeWebhook } from "../../server/routes/webhook";

import {
  call,
  createContext,
  resetDb,
  signWebhook,
  testDb,
  type TestContext,
} from "./helpers";
import {
  admin,
  adminGet,
  adminPost,
  advanceClock,
  assertInvariants,
  assign,
  cancel,
  drive,
  interrupt,
  makeOperator,
  onlineDriver,
  receipt,
  requestRide,
} from "./scenario";

import type { AdminRideDetail } from "../../shared/contracts";

const db = testDb();
let ctx: TestContext;

beforeEach(async () => {
  await resetDb(db);
  ctx = createContext(db);
});
afterEach(() => assertInvariants(ctx));
afterAll(() => db.end());

const P = "user_passenger";
const P2 = "user_other_passenger";
const D = "user_driver";
const OPS = "user_ops_full";
const OPS2 = "user_ops_second";
const VIEWER = "user_ops_viewer";
const SUPPORT = "user_ops_support";

async function completedRide(passenger = P) {
  await onlineDriver(ctx, D);
  const { rideId } = await requestRide(ctx, passenger);
  await assign(ctx, D, rideId);
  await drive(ctx, D, rideId);
  return rideId;
}

async function interruptedRide() {
  await onlineDriver(ctx, D);
  const { rideId } = await requestRide(ctx, P);
  await assign(ctx, D, rideId);
  await drive(ctx, D, rideId, "in_progress");
  await interrupt(ctx, D, rideId);
  return rideId;
}

const detail = async (user: string, rideId: string) =>
  (await adminGet(ctx, user, rideDetail, { params: { id: rideId } })).json
    .data as AdminRideDetail;

async function openSupport(rideId: string, passenger = P) {
  const res = await call(ctx, createSupportRequest, {
    user: passenger,
    params: { id: rideId },
    body: {
      category: "charge_question",
      message: "Why was I charged this much?",
    },
  });
  expect(res.status).toBe(201);
  return res.json.data.id as string;
}

async function refundVia(
  user: string,
  rideId: string,
  amountCents: number,
  opts: { key?: string; expectedMax?: number; reason?: string } = {},
) {
  const expected =
    opts.expectedMax ??
    (await detail(OPS, rideId)).refundable.maxRefundableCents;
  return adminPost(
    ctx,
    user,
    createRefund,
    { id: rideId },
    {
      amountCents,
      reason: opts.reason ?? "Goodwill adjustment",
      expectedMaxRefundableCents: expected,
      idempotencyKey: opts.key ?? randomUUID(),
    },
  );
}

const auditRows = async (action: string) =>
  (
    await db.query(
      "SELECT operator_id, actor, action, target_id, reason, result, detail FROM mobility.audit_log WHERE action = $1 ORDER BY id",
      [action],
    )
  ).rows;

describe("operator provisioning", () => {
  it("grants roles only through the server-side tool, with an audit record", async () => {
    await expect(
      admin.grantOperator(db, {
        clerkId: "user_never_signed_in",
        displayName: "Nobody",
        grantedBy: "tester",
      }),
    ).rejects.toThrow(/sign in to the app once/);

    const op = await makeOperator(ctx, OPS, "view,refund");
    expect(op).toMatchObject({
      can_view: true,
      can_support: false,
      can_refund: true,
    });
    const [grant] = await auditRows("operator_grant");
    expect(grant).toMatchObject({
      actor: "cli:test-runner",
      target_id: op.id,
      result: "succeeded",
    });

    const me = await call(ctx, adminMe, { user: OPS });
    expect(me.json.data).toMatchObject({ permissions: ["view", "refund"] });
  });

  it("offers no way for a user to make themselves an operator", async () => {
    const res = await call(ctx, updateProfile, {
      user: P,
      body: { name: "Me", role: "admin", can_refund: true },
    });
    expect(res.status).toBe(400);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.operators",
    );
    expect(rows[0].n).toBe(0);
    expect((await call(ctx, adminMe, { user: P })).status).toBe(403);
  });

  it("rejects unknown permissions and stops access immediately on revoke", async () => {
    await makeOperator(ctx, OPS);
    await expect(makeOperator(ctx, OPS2, "view,superuser")).rejects.toThrow(
      /Unknown permission/,
    );
    await admin.revokeOperator(db, {
      clerkId: OPS,
      grantedBy: "tester",
      reason: "left team",
    });
    const res = await call(ctx, adminMe, { user: OPS });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("NOT_AN_OPERATOR");
    const [revoke] = await auditRows("operator_revoke");
    expect(revoke).toMatchObject({ actor: "cli:tester", reason: "left team" });
  });
});

describe("access control", () => {
  const RIDE = "00000000-0000-4000-8000-000000000000";
  const endpoints = [
    ["me", adminMe, {}],
    ["review", listReview, {}],
    ["rides", searchRides, {}],
    ["ride detail", rideDetail, { params: { id: RIDE } }],
    ["support list", listSupport, {}],
    ["support detail", supportDetail, { params: { id: RIDE } }],
  ] as const;

  it.each(endpoints)(
    "%s requires a signed-in operator",
    async (_name, handler, opts) => {
      const anonymous = await call(ctx, handler as never, opts as never);
      expect(anonymous.status).toBe(401);
      const passenger = await call(
        ctx,
        handler as never,
        { ...opts, user: P } as never,
      );
      expect(passenger.status).toBe(403);
      expect(passenger.json.error.code).toBe("NOT_AN_OPERATOR");
    },
  );

  it("records denied attempts with the verified identity", async () => {
    await call(ctx, listReview, { user: P });
    const denied = await db.query(
      "SELECT actor, result FROM mobility.audit_log WHERE result = 'denied'",
    );
    expect(denied.rows).toEqual([{ actor: `user:${P}`, result: "denied" }]);
  });

  it("enforces each permission separately", async () => {
    await makeOperator(ctx, VIEWER, "view");
    await makeOperator(ctx, SUPPORT, "view,support");
    const rideId = await completedRide();
    const supportId = await openSupport(rideId);

    expect(
      (await adminGet(ctx, VIEWER, rideDetail, { params: { id: rideId } }))
        .status,
    ).toBe(200);
    const assignDenied = await adminPost(
      ctx,
      VIEWER,
      assignSupport,
      { id: supportId },
      { expectedVersion: 1 },
    );
    expect(assignDenied.status).toBe(403);
    expect(assignDenied.json.error.code).toBe("PERMISSION_DENIED");

    const refundDenied = await adminPost(
      ctx,
      SUPPORT,
      createRefund,
      { id: rideId },
      {
        amountCents: 100,
        reason: "Try it",
        expectedMaxRefundableCents: 0,
        idempotencyKey: randomUUID(),
      },
    );
    expect(refundDenied.status).toBe(403);
    expect(ctx.stripe.calls.createRefund).toBe(0);
    const [denied] = await auditRows("refund_create_denied");
    expect(denied).toMatchObject({ result: "denied", target_id: rideId });
    expect(denied.detail).toEqual({ missingPermission: "refund" });
  });
});

describe("support requests", () => {
  it("lets passengers see only the status of their own requests, never internal notes", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const supportId = await openSupport(rideId);
    await adminPost(
      ctx,
      OPS,
      assignSupport,
      { id: supportId },
      { expectedVersion: 1 },
    );
    await adminPost(
      ctx,
      OPS,
      addSupportNote,
      { id: supportId },
      { note: "Checked the route, fare looks right." },
    );

    const own = await call(ctx, listRideSupport, {
      user: P,
      params: { id: rideId },
    });
    expect(own.json.data).toEqual([
      expect.objectContaining({
        id: supportId,
        status: "in_progress",
        resolutionMessage: null,
      }),
    ]);
    expect(JSON.stringify(own.json.data)).not.toContain("Checked the route");

    const other = await call(ctx, listRideSupport, {
      user: P2,
      params: { id: rideId },
    });
    expect(other.json.data).toEqual([]);
    const otherCreate = await call(ctx, createSupportRequest, {
      user: P2,
      params: { id: rideId },
      body: { category: "other", message: "Not my ride at all" },
    });
    expect(otherCreate.status).toBe(404);

    const full = (
      await adminGet(ctx, OPS, supportDetail, { params: { id: supportId } })
    ).json.data;
    const resolved = await adminPost(
      ctx,
      OPS,
      resolveSupport,
      { id: supportId },
      {
        expectedVersion: full.version,
        resolutionMessage: "The fare matched your quote. No change needed.",
      },
    );
    expect(resolved.status).toBe(200);
    const after = await call(ctx, listRideSupport, {
      user: P,
      params: { id: rideId },
    });
    expect(after.json.data[0]).toMatchObject({
      status: "resolved",
      resolutionMessage: "The fare matched your quote. No change needed.",
    });
  });

  it("keeps a full history with the verified operator on every step", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const supportId = await openSupport(rideId);
    await adminPost(
      ctx,
      OPS,
      assignSupport,
      { id: supportId },
      { expectedVersion: 1 },
    );
    await adminPost(
      ctx,
      OPS,
      resolveSupport,
      { id: supportId },
      {
        expectedVersion: 2,
        resolutionMessage: "Resolved.",
      },
    );
    await adminPost(
      ctx,
      OPS,
      reopenSupport,
      { id: supportId },
      {
        expectedVersion: 3,
        reason: "Passenger replied",
      },
    );
    const d = (
      await adminGet(ctx, OPS, supportDetail, { params: { id: supportId } })
    ).json.data;
    expect(
      d.history.map((h: { action: string; operator: string | null }) => [
        h.action,
        h.operator,
      ]),
    ).toEqual([
      ["created", null],
      ["assigned", `Op ${OPS}`],
      ["resolved", `Op ${OPS}`],
      ["reopened", `Op ${OPS}`],
    ]);
    expect(d).toMatchObject({ status: "open", assignedTo: null, version: 4 });
    const audits = await db.query(
      "SELECT action, actor FROM mobility.audit_log WHERE target_type = 'support_request' ORDER BY id",
    );
    expect(audits.rows).toEqual([
      { action: "support_assign", actor: `operator:${OPS}` },
      { action: "support_resolve", actor: `operator:${OPS}` },
      { action: "support_reopen", actor: `operator:${OPS}` },
    ]);
  });

  it("lets only one operator claim a request", async () => {
    await makeOperator(ctx, OPS);
    await makeOperator(ctx, OPS2);
    const supportId = await openSupport(await completedRide());
    const [a, b] = await Promise.all([
      adminPost(
        ctx,
        OPS,
        assignSupport,
        { id: supportId },
        { expectedVersion: 1 },
      ),
      adminPost(
        ctx,
        OPS2,
        assignSupport,
        { id: supportId },
        { expectedVersion: 1 },
      ),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(["ASSIGNED_TO_OTHER", "VERSION_CONFLICT"]).toContain(
      loser.json.error.code,
    );
  });

  it("prevents two resolutions of the same request", async () => {
    await makeOperator(ctx, OPS);
    await makeOperator(ctx, OPS2);
    const supportId = await openSupport(await completedRide());
    await adminPost(
      ctx,
      OPS,
      assignSupport,
      { id: supportId },
      { expectedVersion: 1 },
    );

    const notMine = await adminPost(
      ctx,
      OPS2,
      resolveSupport,
      { id: supportId },
      {
        expectedVersion: 2,
        resolutionMessage: "Closing this",
      },
    );
    expect(notMine.json.error.code).toBe("NOT_ASSIGNED_TO_YOU");

    const [one, two] = await Promise.all([
      adminPost(
        ctx,
        OPS,
        resolveSupport,
        { id: supportId },
        { expectedVersion: 2, resolutionMessage: "First answer" },
      ),
      adminPost(
        ctx,
        OPS,
        resolveSupport,
        { id: supportId },
        { expectedVersion: 2, resolutionMessage: "Second answer" },
      ),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    const { rows } = await db.query(
      "SELECT resolution_message, version FROM mobility.support_requests WHERE id = $1",
      [supportId],
    );
    expect(rows[0].version).toBe(3);
    expect(["First answer", "Second answer"]).toContain(
      rows[0].resolution_message,
    );
    const failed = (await auditRows("support_resolve")).filter(
      (r) => r.result === "failed",
    );
    expect(failed.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects stale edits", async () => {
    await makeOperator(ctx, OPS);
    const supportId = await openSupport(await completedRide());
    const stale = await adminPost(
      ctx,
      OPS,
      assignSupport,
      { id: supportId },
      { expectedVersion: 7 },
    );
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("VERSION_CONFLICT");
  });

  it("filters and paginates the support queue", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    for (let i = 0; i < 3; i++) await openSupport(rideId);
    const first = (
      await adminGet(ctx, OPS, listSupport, {
        query: { limit: 2, status: "open" },
      })
    ).json.data;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = (
      await adminGet(ctx, OPS, listSupport, {
        query: { limit: 2, status: "open", cursor: first.nextCursor },
      })
    ).json.data;
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map(
      (i: { id: string }) => i.id,
    );
    expect(new Set(ids).size).toBe(3);
    const resolvedOnly = (
      await adminGet(ctx, OPS, listSupport, { query: { status: "resolved" } })
    ).json.data;
    expect(resolvedOnly.items).toEqual([]);
    const bad = await adminGet(ctx, OPS, listSupport, {
      query: { cursor: "not-a-cursor" },
    });
    expect(bad.status).toBe(400);
  });
});

describe("review queue and ride details", () => {
  it("lists interrupted rides for review and lets exactly one operator resolve them", async () => {
    await makeOperator(ctx, OPS);
    await makeOperator(ctx, OPS2);
    const rideId = await interruptedRide();
    const queue = (
      await adminGet(ctx, OPS, listReview, {
        query: { category: "interrupted_trip" },
      })
    ).json.data;
    expect(queue.items).toEqual([
      expect.objectContaining({
        rideId,
        category: "interrupted_trip",
        status: "interrupted",
      }),
    ]);
    const [a, b] = await Promise.all([
      adminPost(
        ctx,
        OPS,
        resolveReview,
        { id: rideId },
        { note: "Vehicle issue confirmed, no charge." },
      ),
      adminPost(
        ctx,
        OPS2,
        resolveReview,
        { id: rideId },
        { note: "Looks fine." },
      ),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const after = (await adminGet(ctx, OPS, listReview)).json.data;
    expect(after.items).toEqual([]);
    const d = await detail(OPS, rideId);
    expect(d.review).toMatchObject({
      open: false,
      resolvedBy: expect.stringMatching(/^Op /),
    });
  });

  it("shows settlement failures that are still being retried", async () => {
    await makeOperator(ctx, OPS);
    const { rideId } = await requestRide(ctx, P);
    ctx.stripe.failNext.cancel = true;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await cancel(ctx, P, rideId);
    errorSpy.mockRestore();
    const queue = (await adminGet(ctx, OPS, listReview)).json.data;
    expect(queue.items).toEqual([
      expect.objectContaining({
        rideId,
        category: "settlement_retrying",
        settlementAttempts: 1,
      }),
    ]);
    advanceClock(ctx, 31);
    await sweep(ctx.deps);
    expect((await adminGet(ctx, OPS, listReview)).json.data.items).toEqual([]);
  });

  it("gives ride details with transitions, matching, ledger, and notifications but no location or tokens", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const d = await detail(OPS, rideId);
    expect(d.events.map((e) => e.toStatus)).toEqual([
      "requested",
      "offered",
      "accepted",
      "arriving",
      "arrived",
      "in_progress",
      "completed",
    ]);
    expect(d.offers).toEqual([
      expect.objectContaining({
        driverName: `Driver ${D}`,
        status: "accepted",
      }),
    ]);
    expect(d.ledger.map((l) => l.kind)).toEqual(["authorized", "captured"]);
    expect(d.notifications.length).toBeGreaterThan(0);
    expect(d.refundable).toMatchObject({
      refundable: true,
      maxRefundableCents: d.ride.capturedCents,
    });
    expect(d.passenger.account).toMatch(/^user_…/);
    const text = JSON.stringify(d);
    expect(text).not.toMatch(
      /latitude|longitude|ExponentPushToken|client_secret|clerk_id/,
    );
    expect(text).not.toContain(P);
    const views = await auditRows("ride_view");
    expect(views).toEqual([
      expect.objectContaining({
        actor: `operator:${OPS}`,
        target_id: rideId,
        result: "succeeded",
      }),
    ]);
  });

  it("searches rides by id, payment state, and date, with pagination", async () => {
    await makeOperator(ctx, OPS);
    const done = await completedRide();
    const { rideId: open } = await requestRide(ctx, P2);
    const byId = (
      await adminGet(ctx, OPS, searchRides, { query: { rideId: done } })
    ).json.data;
    expect(byId.items.map((r: { rideId: string }) => r.rideId)).toEqual([done]);
    const paid = (
      await adminGet(ctx, OPS, searchRides, {
        query: { paymentStatus: "paid" },
      })
    ).json.data;
    expect(paid.items.map((r: { rideId: string }) => r.rideId)).toEqual([done]);
    const pageOne = (
      await adminGet(ctx, OPS, searchRides, { query: { limit: 1 } })
    ).json.data;
    expect(pageOne.items).toHaveLength(1);
    const pageTwo = (
      await adminGet(ctx, OPS, searchRides, {
        query: { limit: 1, cursor: pageOne.nextCursor },
      })
    ).json.data;
    expect([pageOne.items[0].rideId, pageTwo.items[0].rideId].sort()).toEqual(
      [done, open].sort(),
    );
    const future = (
      await adminGet(ctx, OPS, searchRides, {
        query: { from: new Date(Date.now() + 86_400_000).toISOString() },
      })
    ).json.data;
    expect(future.items).toEqual([]);
  });
});

describe("refunds from the console", () => {
  it("refunds a captured ride, records the verified operator, and reports Stripe's status", async () => {
    const op = await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const d = await detail(OPS, rideId);
    const res = await refundVia(OPS, rideId, 250);
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({
      status: "succeeded",
      amountCents: 250,
      duplicate: false,
    });

    const { rows } = await db.query(
      "SELECT operator_id, operator FROM mobility.refunds",
    );
    expect(rows).toEqual([{ operator_id: op.id, operator: `Op ${OPS}` }]);
    const after = await detail(OPS, rideId);
    expect(after.refundable.maxRefundableCents).toBe(
      d.refundable.maxRefundableCents - 250,
    );
    expect(after.refunds[0]).toMatchObject({
      verifiedOperator: true,
      status: "succeeded",
    });
    expect(after.ledger.map((l) => [l.kind, l.actor])).toContainEqual([
      "refund_requested",
      `operator:${OPS}`,
    ]);
    const [entry] = await auditRows("refund_create");
    expect(entry).toMatchObject({
      operator_id: op.id,
      actor: `operator:${OPS}`,
      target_id: rideId,
      reason: "Goodwill adjustment",
      result: "succeeded",
    });
    expect(Object.keys(entry.detail).sort()).toEqual(
      [
        "amountCents",
        "outcome",
        "refundId",
        "stripeStatus",
        "supportRequestId",
      ].sort(),
    );
    expect((await receipt(ctx, P, rideId)).json.data.refundedCents).toBe(250);
  });

  it("returns the same refund for a repeated or double-clicked confirmation", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const key = randomUUID();
    const max = (await detail(OPS, rideId)).refundable.maxRefundableCents;
    const [a, b] = await Promise.all([
      refundVia(OPS, rideId, 300, { key, expectedMax: max }),
      refundVia(OPS, rideId, 300, { key, expectedMax: max }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.json.data.refundId).toBe(b.json.data.refundId);
    expect(ctx.stripe.refunds.size).toBe(1);
    const reused = await refundVia(OPS, rideId, 999, { key, expectedMax: max });
    expect(reused.json.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("prevents two operators from starting conflicting refunds", async () => {
    await makeOperator(ctx, OPS);
    await makeOperator(ctx, OPS2);
    const rideId = await completedRide();
    const max = (await detail(OPS, rideId)).refundable.maxRefundableCents;
    ctx.stripe.refundMode = "pending";
    const [a, b] = await Promise.all([
      refundVia(OPS, rideId, max, { expectedMax: max }),
      refundVia(OPS2, rideId, max, { expectedMax: max }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(["REFUND_IN_PROGRESS", "REFUNDABLE_CHANGED"]).toContain(
      loser.json.error.code,
    );
    expect(ctx.stripe.refunds.size).toBe(1);
  });

  it("rejects stale, excessive, and uncaptured refunds", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const max = (await detail(OPS, rideId)).refundable.maxRefundableCents;
    const stale = await refundVia(OPS, rideId, 100, { expectedMax: max + 1 });
    expect(stale.json.error.code).toBe("REFUNDABLE_CHANGED");
    const excessive = await refundVia(OPS, rideId, max + 1, {
      expectedMax: max,
    });
    expect(excessive.json.error.code).toBe("EXCEEDS_REFUNDABLE");
    const { rideId: held } = await requestRide(ctx, P2);
    const uncaptured = await refundVia(OPS, held, 100, { expectedMax: 0 });
    expect(uncaptured.json.error.code).toBe("NOT_REFUNDABLE");
    expect(ctx.stripe.calls.createRefund).toBe(0);
  });

  it("shows a pending refund as pending until Stripe confirms it", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    ctx.stripe.refundMode = "pending";
    const res = await refundVia(OPS, rideId, 200);
    expect(res.json.data.status).toBe("pending");
    const [entry] = await auditRows("refund_create");
    expect(entry.result).toBe("pending");
    expect((await detail(OPS, rideId)).ride.refundedCents).toBe(0);

    const refundRow = (
      await db.query("SELECT id, stripe_refund_id FROM mobility.refunds")
    ).rows[0];
    ctx.stripe.setRefund(refundRow.stripe_refund_id, { status: "succeeded" });
    const evt = {
      id: "evt_admin_refund",
      object: "event",
      type: "refund.updated",
      data: { object: { id: refundRow.stripe_refund_id, object: "refund" } },
    };
    const signed = signWebhook(evt);
    await call(ctx, stripeWebhook, {
      method: "POST",
      rawBody: signed.payload,
      headers: {
        "stripe-signature": signed.header,
        "content-type": "application/json",
      },
    });
    expect((await detail(OPS, rideId)).ride.refundedCents).toBe(200);
    const sync = await adminPost(
      ctx,
      OPS,
      syncRefund,
      { id: refundRow.id },
      {},
    );
    expect(sync.json.data.status).toBe("succeeded");
  });

  it("finishes a refund after a Stripe outage without creating a second one", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    ctx.stripe.refundMode = "down";
    const res = await refundVia(OPS, rideId, 150);
    expect(res.json.data).toMatchObject({
      status: "creating",
      stripeReachable: false,
    });
    expect((await detail(OPS, rideId)).refundable.refundable).toBe(false);
    ctx.stripe.refundMode = "succeed";
    advanceClock(ctx, 61);
    await sweep(ctx.deps);
    await sweep(ctx.deps);
    expect(ctx.stripe.refunds.size).toBe(1);
    expect((await detail(OPS, rideId)).ride.refundedCents).toBe(150);
  });

  it("records a refund Stripe rejects as failed", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    ctx.stripe.refundMode = "reject";
    const res = await refundVia(OPS, rideId, 150);
    expect(res.json.data.status).toBe("failed");
    const [entry] = await auditRows("refund_create");
    expect(entry.result).toBe("failed");
    expect((await detail(OPS, rideId)).ride.refundedCents).toBe(0);
  });
});

describe("audit hygiene", () => {
  it("drops secrets, tokens, contact details, and coordinates from audit details", () => {
    expect(
      sanitizeDetail({
        amountCents: 100,
        clientSecret: "pi_123_secret_abc",
        pushToken: "ExponentPushToken[x]",
        email: "a@b.c",
        latitude: 37.7,
        nested: { cardNumber: "4242", ok: "yes", location: { lat: 1 } },
        long: "x".repeat(500),
      }),
    ).toEqual({
      amountCents: 100,
      nested: { ok: "yes" },
      long: "x".repeat(200),
    });
  });
});

describe("real-money guard", () => {
  it("refuses console refunds when the server has a live Stripe key", async () => {
    await makeOperator(ctx, OPS);
    const rideId = await completedRide();
    const max = (await detail(OPS, rideId)).refundable.maxRefundableCents;
    const original = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_live_example";
    try {
      const me = await call(ctx, adminMe, { user: OPS });
      expect(me.json.data.stripeMode).toBe("live");
      const res = await refundVia(OPS, rideId, 100, { expectedMax: max });
      expect(res.status).toBe(503);
      expect(res.json.error.code).toBe("LIVE_REFUNDS_DISABLED");
    } finally {
      process.env.STRIPE_SECRET_KEY = original;
    }
    expect(ctx.stripe.calls.createRefund).toBe(0);
  });
});
