import { randomBytes, randomUUID } from "node:crypto";

import { CHAT } from "../../server/chat";
import { sweep } from "../../server/rides";
import { sendChatMessage } from "../../server/routes/chat";
import {
  createReport,
  createShare,
  getReport,
  getSafety,
  getSafetyReport,
  listSafety,
  reportMessage,
  revokeShare,
  triageSafety,
  viewShare,
} from "../../server/routes/safety";
import { SAFETY_RULES } from "../../shared/contracts";

import {
  call,
  createContext,
  resetDb,
  testDb,
  type TestContext,
} from "./helpers";
import {
  adminGet,
  adminPost,
  advanceClock,
  assertInvariants,
  assign,
  assignedRide,
  cancel,
  drive,
  makeOperator,
  onlineDriver,
  requestRide,
} from "./scenario";

import type {
  AdminSafetyDetail,
  AdminSafetyItem,
  MySafetyReport,
  Page,
  SafetyView,
  SharedTripView,
  TripShareCreated,
} from "../../shared/contracts";

const db = testDb();
let ctx: TestContext;

beforeEach(async () => {
  await resetDb(db);
  ctx = createContext(db);
});
afterEach(() => assertInvariants(ctx));
afterAll(() => db.end());

const P = "user_passenger";
const Q = "user_stranger";
const A = "user_driver_a";
const B = "user_driver_b";
const OPS = "user_operator";
const OPS2 = "user_operator_two";
const VIEWER = "user_viewer";
const DAY = 24 * 3600;

const report = (
  user: string,
  rideId: string,
  body: Partial<{
    category: string;
    description: string;
    clientReportId: string;
  }> = {},
) =>
  call(ctx, createReport, {
    user,
    params: { id: rideId },
    body: {
      category: "unsafe_driving",
      description: "The driver was speeding through a school zone.",
      clientReportId: randomUUID(),
      ...body,
    },
  });

const safety = async (user: string, rideId: string) =>
  call(ctx, getSafety, { user, params: { id: rideId } });

const send = (user: string, rideId: string, body: string) =>
  call(ctx, sendChatMessage, {
    user,
    params: { id: rideId },
    body: { clientMessageId: randomUUID(), body },
  });

const reportMsg = (
  user: string,
  rideId: string,
  messageId: string,
  body: Partial<{
    category: string;
    description: string;
    clientReportId: string;
  }> = {},
) =>
  call(ctx, reportMessage, {
    user,
    params: { id: rideId, messageId },
    body: { category: "harassment", clientReportId: randomUUID(), ...body },
  });

const share = (user: string, rideId: string) =>
  call(ctx, createShare, { user, params: { id: rideId }, body: {} });

const view = (token: string) => call(ctx, viewShare, { params: { token } });

const triage = (
  user: string,
  id: string,
  action: string,
  expectedVersion: number,
  note?: string,
) =>
  adminPost(
    ctx,
    user,
    triageSafety,
    { id },
    {
      action,
      expectedVersion,
      ...(note ? { note } : {}),
    },
  );

const detail = async (user: string, id: string) =>
  (await adminGet(ctx, user, getSafetyReport, { params: { id } })).json
    .data as AdminSafetyDetail;

describe("safety reports", () => {
  it("lets the passenger and assigned driver report, and nobody else", async () => {
    const rideId = await assignedRide(ctx, P, A);
    const byPassenger = await report(P, rideId);
    expect(byPassenger.status).toBe(201);
    expect(byPassenger.json.data).toMatchObject({
      rideId,
      category: "unsafe_driving",
      status: "open",
    });
    expect((await report(A, rideId, { category: "harassment" })).status).toBe(
      201,
    );
    expect((await report(Q, rideId)).status).toBe(404);
    expect((await safety(Q, rideId)).status).toBe(404);

    const passengerView = (await safety(P, rideId)).json.data as SafetyView;
    expect(passengerView).toMatchObject({
      role: "passenger",
      currentParticipant: true,
      canReport: true,
      canShare: true,
    });
    expect(passengerView.driver?.plate).toBeTruthy();
    expect(passengerView.reports).toHaveLength(1);
    const driverView = (await safety(A, rideId)).json.data as SafetyView;
    expect(driverView).toMatchObject({
      role: "driver",
      canShare: false,
      driver: null,
    });
    expect(driverView.reports.map((r) => r.category)).toEqual(["harassment"]);
  });

  it("keeps reports private to their author", async () => {
    const rideId = await assignedRide(ctx, P, A);
    const id = ((await report(P, rideId)).json.data as MySafetyReport).id;
    expect(
      (await call(ctx, getReport, { user: P, params: { id } })).status,
    ).toBe(200);
    for (const other of [A, Q]) {
      expect(
        (await call(ctx, getReport, { user: other, params: { id } })).status,
      ).toBe(404);
    }
    expect(JSON.stringify((await safety(A, rideId)).json.data)).not.toContain(
      id,
    );
  });

  it("validates input and is idempotent per client report ID", async () => {
    const rideId = await assignedRide(ctx, P, A);
    for (const bad of [
      { description: "too short" },
      { description: "x".repeat(2001) },
      { description: "Contains a bell \u0007 character here." },
      { category: "not_a_category" },
      { clientReportId: "nope" },
    ]) {
      expect((await report(P, rideId, bad)).status).toBe(400);
    }
    const key = randomUUID();
    const first = await report(P, rideId, { clientReportId: key });
    const again = await report(P, rideId, { clientReportId: key });
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(again.json.data.id).toBe(first.json.data.id);
    expect(
      (await report(P, rideId, { clientReportId: key, category: "accident" }))
        .json.error.code,
    ).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("follows the ride through rematching, cancellation and completion", async () => {
    await onlineDriver(ctx, A, 300);
    await onlineDriver(ctx, B, 900);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    expect((await cancel(ctx, A, rideId)).status).toBe(200);

    const former = (await safety(A, rideId)).json.data as SafetyView;
    expect(former).toMatchObject({
      role: "driver",
      currentParticipant: false,
      passengerName: null,
      driver: null,
      canReport: true,
    });
    expect((await report(A, rideId, { category: "harassment" })).status).toBe(
      201,
    );

    await assign(ctx, B, rideId);
    const current = (await safety(B, rideId)).json.data as SafetyView;
    expect(current.currentParticipant).toBe(true);
    expect(current.reports).toEqual([]);
    await drive(ctx, B, rideId);
    expect((await report(B, rideId)).status).toBe(201);
    expect((await report(P, rideId)).status).toBe(201);

    advanceClock(ctx, SAFETY_RULES.reportWindowDays * DAY + 60);
    for (const user of [P, A, B]) {
      expect((await report(user, rideId)).json.error.code).toBe(
        "REPORT_WINDOW_CLOSED",
      );
    }
    expect(((await safety(P, rideId)).json.data as SafetyView).canReport).toBe(
      false,
    );
  });

  it("accepts reports on a cancelled ride", async () => {
    const rideId = await assignedRide(ctx, P, A);
    await cancel(ctx, P, rideId);
    expect((await report(P, rideId, { category: "other" })).status).toBe(201);
    expect((await report(A, rideId, { category: "other" })).status).toBe(201);
  });
});

describe("reporting chat messages", () => {
  it("keeps a bounded snapshot of a received message as evidence", async () => {
    const rideId = await assignedRide(ctx, P, A);
    const sent = await send(A, rideId, "Give me your number or else");
    await send(A, rideId, "This other message is private");
    const messageId = sent.json.data.message.id;

    const res = await reportMsg(P, rideId, messageId);
    expect(res.status).toBe(201);
    expect(res.json.data.reportedMessages).toBe(1);
    const again = await reportMsg(P, rideId, messageId);
    expect(again.status).toBe(201);
    expect(again.json.data.id).not.toBe(res.json.data.id);

    const own = await send(P, rideId, "My own words");
    expect(
      (await reportMsg(P, rideId, own.json.data.message.id)).json.error.code,
    ).toBe("CANNOT_REPORT_OWN_MESSAGE");
    expect((await reportMsg(Q, rideId, messageId)).status).toBe(404);
    expect((await reportMsg(P, rideId, randomUUID())).status).toBe(404);

    await makeOperator(ctx, OPS, "view,support");
    const d = await detail(OPS, res.json.data.id);
    expect(d.messages).toEqual([
      expect.objectContaining({
        messageId,
        senderRole: "driver",
        body: "Give me your number or else",
        redacted: false,
      }),
    ]);
    expect(JSON.stringify(d)).not.toContain("This other message is private");
  });

  it("never lets a new driver reach an earlier driver's messages", async () => {
    await onlineDriver(ctx, A, 300);
    await onlineDriver(ctx, B, 900);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    const early = await send(P, rideId, "Message for the first driver");
    await cancel(ctx, A, rideId);
    await assign(ctx, B, rideId);

    expect(
      (await reportMsg(B, rideId, early.json.data.message.id)).status,
    ).toBe(404);
    expect(
      (await reportMsg(A, rideId, early.json.data.message.id)).status,
    ).toBe(404);
    const late = await send(P, rideId, "Hello second driver");
    expect((await reportMsg(B, rideId, late.json.data.message.id)).status).toBe(
      201,
    );
  });

  it("keeps evidence after chat purge and redacts it after the retention period", async () => {
    await makeOperator(ctx, OPS, "view,support");
    const rideId = await assignedRide(ctx, P, A);
    const msg = await send(A, rideId, "Threatening message");
    const id = (await reportMsg(P, rideId, msg.json.data.message.id)).json.data
      .id;
    await drive(ctx, A, rideId);

    advanceClock(ctx, CHAT.retentionDays * DAY + 60);
    await sweep(ctx.deps);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.ride_messages WHERE ride_id = $1",
      [rideId],
    );
    expect(rows[0].n).toBe(0);
    expect((await detail(OPS, id)).messages[0].body).toBe(
      "Threatening message",
    );

    advanceClock(ctx, 200 * DAY);
    await sweep(ctx.deps);
    expect((await detail(OPS, id)).messages[0].body).toBe(
      "Threatening message",
    );

    let d = await detail(OPS, id);
    d = (await triage(OPS, id, "assign", d.version)).json.data;
    const resolved = (
      await triage(OPS, id, "resolve", d.version, "Driver warned")
    ).json.data as AdminSafetyDetail;
    expect(resolved.status).toBe("resolved");
    const retained = new Date(resolved.evidenceRetainedUntil!).getTime();
    expect(retained - ctx.clock.now.getTime()).toBe(
      SAFETY_RULES.evidenceRetentionDays * DAY * 1000,
    );

    advanceClock(ctx, SAFETY_RULES.evidenceRetentionDays * DAY + 60);
    await sweep(ctx.deps);
    const after = await detail(OPS, id);
    expect(after.messages[0]).toMatchObject({ body: null, redacted: true });
    expect(after.history.map((h) => h.action)).toContain("evidence_redacted");
    expect(after.description).toBeTruthy();
  });
});

describe("operator triage", () => {
  it("requires the support permission and audits access", async () => {
    await makeOperator(ctx, OPS, "view,support");
    await makeOperator(ctx, VIEWER, "view");
    const rideId = await assignedRide(ctx, P, A);
    const id = (await report(P, rideId)).json.data.id;

    expect(
      (await adminGet(ctx, VIEWER, listSafety, { query: {} })).json.error.code,
    ).toBe("PERMISSION_DENIED");
    expect(
      (await adminGet(ctx, VIEWER, getSafetyReport, { params: { id } })).json
        .error.code,
    ).toBe("PERMISSION_DENIED");
    expect(
      (await adminGet(ctx, P, listSafety, { query: {} })).json.error.code,
    ).toBe("NOT_AN_OPERATOR");

    const list = (await adminGet(ctx, OPS, listSafety, { query: {} })).json
      .data as Page<AdminSafetyItem>;
    expect(list.items.map((i) => i.id)).toEqual([id]);
    await detail(OPS, id);
    const { rows } = await db.query(
      "SELECT action, result FROM mobility.audit_log WHERE target_type = 'safety_report' ORDER BY id",
    );
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        "safety_list_denied",
        "safety_view_denied",
        "safety_view",
      ]),
    );
    expect(JSON.stringify(rows)).not.toContain("speeding");
  });

  it("enforces assignment, versions and notes, and records history", async () => {
    await makeOperator(ctx, OPS, "view,support");
    await makeOperator(ctx, OPS2, "view,support");
    const rideId = await assignedRide(ctx, P, A);
    const id = (await report(P, rideId)).json.data.id;
    const v1 = (await detail(OPS, id)).version;

    const [a, b] = await Promise.all([
      triage(OPS, id, "assign", v1),
      triage(OPS2, id, "assign", v1),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? OPS : OPS2;
    const loser = winner === OPS ? OPS2 : OPS;
    let d = await detail(winner, id);
    expect(d.status).toBe("in_review");

    expect(
      (await triage(loser, id, "resolve", d.version, "Not mine")).json.error
        .code,
    ).toBe("NOT_ASSIGNED_TO_YOU");
    expect((await triage(winner, id, "resolve", d.version)).status).toBe(400);
    expect(
      (await triage(winner, id, "resolve", d.version - 1, "Old")).json.error
        .code,
    ).toBe("VERSION_CONFLICT");
    d = (await triage(winner, id, "note", d.version, "Called the driver")).json
      .data;
    d = (await triage(winner, id, "dismiss", d.version, "No evidence")).json
      .data;
    expect(d.status).toBe("dismissed");
    d = (
      await triage(
        loser,
        id,
        "reopen",
        d.version,
        "Passenger sent more details",
      )
    ).json.data;
    expect(d).toMatchObject({
      status: "open",
      assignedTo: null,
      evidenceRetainedUntil: null,
    });
    expect(d.history.map((h) => h.action)).toEqual([
      "created",
      "assigned",
      "note_added",
      "status_changed",
      "status_changed",
    ]);
    const mine = (await call(ctx, getReport, { user: P, params: { id } })).json
      .data;
    expect(mine.status).toBe("open");
    expect(JSON.stringify(mine)).not.toContain("Called the driver");
  });
});

describe("trip sharing", () => {
  it("shares minimal live trip status through a revocable, unguessable link", async () => {
    const rideId = await assignedRide(ctx, P, A);
    expect((await share(A, rideId)).status).toBe(404);
    expect((await share(Q, rideId)).status).toBe(404);
    const created = (await share(P, rideId)).json.data as TripShareCreated;
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { rows } = await db.query(
      "SELECT token_hash FROM mobility.trip_shares",
    );
    expect(rows[0].token_hash).not.toContain(created.token);

    const res = await view(created.token);
    expect(res.status).toBe(200);
    expect(res.response.headers.get("Referrer-Policy")).toBe("no-referrer");
    const trip = res.json.data as SharedTripView;
    expect(trip.status).toBe("driver_on_the_way");
    expect(trip.driver?.firstName).toBe("Driver");
    expect(trip.destination).toBeTruthy();
    expect(trip.driverLocation).not.toBeNull();
    const body = JSON.stringify(res.json);
    expect(body).not.toMatch(
      /fare|payment|cents|chat|message|rideId|passenger|pi_|user_/i,
    );
    expect(body).not.toContain(rideId);

    await call(ctx, revokeShare, {
      user: Q,
      params: { id: created.share.id },
      body: {},
    });
    expect((await view(created.token)).status).toBe(200);
    const revoked = await call(ctx, revokeShare, {
      user: P,
      params: { id: created.share.id },
      body: {},
    });
    expect(revoked.json.data.active).toBe(false);
    expect((await view(created.token)).json.error.code).toBe(
      "SHARE_UNAVAILABLE",
    );

    expect((await view("short")).status).toBe(400);
    expect((await view(randomBytes(32).toString("base64url"))).status).toBe(
      404,
    );
  });

  it("expires links and limits how many are active", async () => {
    const rideId = await assignedRide(ctx, P, A);
    const tokens: string[] = [];
    for (let i = 0; i < SAFETY_RULES.maxActiveShares; i++) {
      tokens.push(
        ((await share(P, rideId)).json.data as TripShareCreated).token,
      );
    }
    expect((await share(P, rideId)).json.error.code).toBe("TOO_MANY_SHARES");
    advanceClock(ctx, SAFETY_RULES.shareTtlMinutes * 60 + 1);
    expect((await view(tokens[0])).status).toBe(404);
    expect((await share(P, rideId)).status).toBe(201);
  });

  it("drops location after the trip and ends the link shortly after", async () => {
    const rideId = await assignedRide(ctx, P, A);
    const { token } = (await share(P, rideId)).json.data as TripShareCreated;
    await drive(ctx, A, rideId);
    const done = (await view(token)).json.data as SharedTripView;
    expect(done).toMatchObject({
      status: "completed",
      driverLocation: null,
      destination: null,
      driver: null,
    });
    expect((await share(P, rideId)).json.error.code).toBe(
      "SHARE_NOT_AVAILABLE",
    );
    advanceClock(ctx, SAFETY_RULES.shareAfterTripMinutes * 60 + 1);
    expect((await view(token)).status).toBe(404);
  });

  it("shows a cancelled ride as ended and follows a rematch", async () => {
    await onlineDriver(ctx, A, 300);
    await onlineDriver(ctx, B, 900);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    const { token } = (await share(P, rideId)).json.data as TripShareCreated;
    await cancel(ctx, A, rideId);
    const searching = (await view(token)).json.data as SharedTripView;
    expect(searching).toMatchObject({
      status: "searching",
      driver: null,
      driverLocation: null,
    });
    await assign(ctx, B, rideId);
    expect(
      ((await view(token)).json.data as SharedTripView).driver?.firstName,
    ).toBe("Driver");
    expect(JSON.stringify((await view(token)).json)).toContain(
      "user_driver_b"
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(-8)
        .toUpperCase(),
    );

    await cancel(ctx, P, rideId);
    const ended = (await view(token)).json.data as SharedTripView;
    expect(ended).toMatchObject({
      status: "ended",
      driver: null,
      driverLocation: null,
    });
  });
});
