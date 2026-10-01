import { randomUUID } from "node:crypto";

import { sweep } from "../../server/rides";
import {
  addSupportNote,
  assignSupport,
  resolveSupport,
} from "../../server/routes/admin";
import { sendChatMessage } from "../../server/routes/chat";
import {
  adminBadges,
  adminSupportReply,
  getInbox,
  getNotificationPreferences,
  getSupportRequest,
  listSupportRequests,
  postSupportMessage,
  putNotificationPreferences,
  readInbox,
} from "../../server/routes/inbox";
import { patchAccount } from "../../server/routes/profile";
import { createSupportRequest } from "../../server/routes/receipts";
import { createReport, triageSafety } from "../../server/routes/safety";
import {
  decideDriverApplication,
  getDriverApplication,
} from "../../server/routes/verification";

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
  apply,
  assertInvariants,
  assign,
  dashboard,
  drive,
  makeOperator,
  onlineDriver,
  registerDevice,
  requestRide,
} from "./scenario";

import type {
  AdminBadges,
  InboxPage,
  SupportConversation,
} from "../../shared/account";
import type { AdminDriverDetail } from "../../shared/contracts";

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
const OPS2 = "user_operator_two";

const inbox = async (user: string, query = "") =>
  (
    await call(ctx, getInbox, {
      user,
      url: `http://localhost/api/notifications${query}`,
    })
  ).json.data as InboxPage;

async function completedRide(passenger = P) {
  await onlineDriver(ctx, D);
  const { rideId } = await requestRide(ctx, passenger);
  await assign(ctx, D, rideId);
  await drive(ctx, D, rideId);
  return rideId;
}

async function openSupport(rideId: string, user = P) {
  const res = await call(ctx, createSupportRequest, {
    user,
    params: { id: rideId },
    body: { category: "charge_question", message: "Why was I charged this?" },
  });
  expect(res.status).toBe(201);
  return res.json.data.id as string;
}

const reply = (
  op: string,
  id: string,
  body: string,
  clientMessageId = randomUUID(),
) => adminPost(ctx, op, adminSupportReply, { id }, { body, clientMessageId });

const conversation = async (user: string, id: string) =>
  call(ctx, getSupportRequest, { user, params: { id } });

describe("notification inbox", () => {
  it("lists a user's own ride updates with paging and read state, without offers or chat", async () => {
    const rideId = await completedRide();
    await call(ctx, sendChatMessage, {
      user: D,
      params: { id: rideId },
      body: { clientMessageId: randomUUID(), body: "On my way" },
    }).catch(() => undefined);
    const first = await inbox(P, "?limit=2");
    expect(first.items).toHaveLength(2);
    expect(first.unread).toBe(4);
    expect(first.items[0].kind).toBe("ride_completed");
    expect(first.items[0].target).toBe(`/ride/${rideId}`);
    expect(first.nextCursor).not.toBeNull();
    const second = await inbox(P, `?limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((i) => i.kind)).toEqual([
      "ride_arrived",
      "ride_accepted",
    ]);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items];
    expect(all.every((i) => i.category === "ride")).toBe(true);
    expect((await inbox(D)).items).toEqual([]);

    const stolen = await call(ctx, readInbox, {
      user: Q,
      body: { ids: all.map((i) => i.id) },
    });
    expect(stolen.json.data.unread).toBe(0);
    expect((await inbox(P)).unread).toBe(4);
    const one = await call(ctx, readInbox, {
      user: P,
      body: { ids: [all[0].id] },
    });
    expect(one.json.data.unread).toBe(3);
    const rest = await call(ctx, readInbox, { user: P, body: { all: true } });
    expect(rest.json.data.unread).toBe(0);
    expect((await inbox(P)).items.every((i) => i.readAt)).toBe(true);
    for (const body of [{}, { ids: [] }, { ids: ["x"] }, { all: false }]) {
      expect((await call(ctx, readInbox, { user: P, body })).status).toBe(400);
    }
  });

  it("writes notifications in the account's language", async () => {
    await call(ctx, patchAccount, {
      method: "PATCH",
      user: P,
      body: { language: "sq" },
    });
    await registerDevice(ctx, P, "ExponentPushToken[p]");
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    const page = await inbox(P);
    expect(page.items[0].title).toBe("Shoferi po vjen");
    expect(ctx.push.sent.at(-1)?.title).toBe("Shoferi po vjen");
  });

  it("mutes push per category while keeping the inbox entry", async () => {
    expect(
      (await call(ctx, getNotificationPreferences, { user: P })).json.data,
    ).toEqual({
      rideUpdates: true,
      chatMessages: true,
      rideOffers: true,
      accountUpdates: true,
    });
    const saved = await call(ctx, putNotificationPreferences, {
      method: "PUT",
      user: P,
      body: {
        rideUpdates: false,
        chatMessages: true,
        rideOffers: true,
        accountUpdates: true,
      },
    });
    expect(saved.json.data.rideUpdates).toBe(false);
    expect(
      (
        await call(ctx, putNotificationPreferences, {
          method: "PUT",
          user: P,
          body: { rideUpdates: false },
        })
      ).status,
    ).toBe(400);
    await registerDevice(ctx, P, "ExponentPushToken[p]");
    await registerDevice(ctx, D, "ExponentPushToken[d]");
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    expect(ctx.push.sent.some((m) => m.to === "ExponentPushToken[p]")).toBe(
      false,
    );
    expect(ctx.push.sent.some((m) => m.to === "ExponentPushToken[d]")).toBe(
      true,
    );
    expect((await inbox(P)).items[0].kind).toBe("ride_accepted");
    const { rows } = await db.query(
      "SELECT status, last_error FROM mobility.notifications WHERE kind = 'ride_accepted'",
    );
    expect(rows).toEqual([{ status: "skipped", last_error: "muted" }]);
  });
});

describe("account and case updates", () => {
  it("tells a driver about an application decision without exposing the reason", async () => {
    await apply(ctx, D);
    await db.query(
      "UPDATE mobility.driver_profiles SET status = 'submitted', documents_waived = true, waiver_note = 'fixture'",
    );
    await makeOperator(ctx, OPS, "view,verify");
    await registerDevice(ctx, D, "ExponentPushToken[d]");
    const profileId = (await dashboard(ctx, D)).profile!.id;
    const detail = (
      await adminGet(ctx, OPS, getDriverApplication, {
        params: { id: profileId },
      })
    ).json.data as AdminDriverDetail;
    const res = await adminPost(
      ctx,
      OPS,
      decideDriverApplication,
      { id: profileId },
      {
        action: "request_changes",
        reason: "Internal: plate photo unreadable",
        applicantMessage: "Please re-upload your registration.",
        expectedVersion: detail.version,
      },
    );
    expect(res.status).toBe(200);
    const page = await inbox(D);
    expect(page.items[0]).toMatchObject({
      kind: "application_update",
      category: "account",
      target: "/driver",
    });
    const sent = JSON.stringify(ctx.push.sent.at(-1));
    expect(sent).toContain("Changes requested");
    expect(sent).not.toContain("plate photo");
    expect(sent).not.toContain("re-upload");
  });

  it("notifies the reporter when a safety report changes status, without its contents", async () => {
    const rideId = await completedRide();
    await makeOperator(ctx, OPS, "view,support");
    await registerDevice(ctx, P, "ExponentPushToken[p]");
    const report = await call(ctx, createReport, {
      user: P,
      params: { id: rideId },
      body: {
        category: "unsafe_driving",
        description: "The driver ran a red light near the school.",
        clientReportId: randomUUID(),
      },
    });
    const reportId = report.json.data.id as string;
    ctx.push.sent.length = 0;
    const triage = await adminPost(
      ctx,
      OPS,
      triageSafety,
      { id: reportId },
      {
        action: "assign",
        expectedVersion: 1,
      },
    );
    expect(triage.status).toBe(200);
    const top = (await inbox(P)).items[0];
    expect(top).toMatchObject({
      kind: "safety_update",
      category: "safety",
      target: `/safety/${rideId}`,
    });
    expect(JSON.stringify(ctx.push.sent)).not.toContain("red light");
    const note = await adminPost(
      ctx,
      OPS,
      triageSafety,
      { id: reportId },
      {
        action: "note",
        note: "Called the driver",
        expectedVersion: 2,
      },
    );
    expect(note.status).toBe(200);
    expect(
      (await inbox(P)).items.filter((i) => i.kind === "safety_update"),
    ).toHaveLength(1);
  });
});

describe("support conversation", () => {
  it("keeps operator replies, user replies and internal notes separate and scoped", async () => {
    const rideId = await completedRide();
    const id = await openSupport(rideId);
    await makeOperator(ctx, OPS, "view,support");
    await makeOperator(ctx, OPS2, "view,support");
    await registerDevice(ctx, P, "ExponentPushToken[p]");

    const early = await reply(OPS, id, "Looking into it");
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe("NOT_ASSIGNED_TO_YOU");

    ctx.push.sent.length = 0;
    await adminPost(ctx, OPS, assignSupport, { id }, { expectedVersion: 1 });
    expect(ctx.push.sent.at(-1)?.title).toContain(
      "working on your support request",
    );
    await adminPost(
      ctx,
      OPS,
      addSupportNote,
      { id },
      { note: "Internal: check capture" },
    );
    const other = await reply(OPS2, id, "Not mine");
    expect(other.status).toBe(409);

    const messageId = randomUUID();
    const sent = await reply(
      OPS,
      id,
      "We checked: the fare matches your quote.",
      messageId,
    );
    expect(sent.status).toBe(201);
    expect(
      (
        await reply(
          OPS,
          id,
          "We checked: the fare matches your quote.",
          messageId,
        )
      ).json.data,
    ).toHaveLength(1);
    expect(JSON.stringify(ctx.push.sent)).not.toContain("matches your quote");

    const list = await call(ctx, listSupportRequests, { user: P });
    expect(list.json.data.items).toEqual([
      expect.objectContaining({ id, status: "in_progress", unread: true }),
    ]);
    const view = (await conversation(P, id)).json.data as SupportConversation;
    expect(view.messages.map((m) => [m.author, m.body])).toEqual([
      ["operator", "We checked: the fare matches your quote."],
    ]);
    expect(JSON.stringify(view)).not.toContain("Internal");
    expect(view.canReply).toBe(true);
    expect(
      (await call(ctx, listSupportRequests, { user: P })).json.data.items[0]
        .unread,
    ).toBe(false);

    expect((await conversation(Q, id)).status).toBe(404);
    const foreign = await call(ctx, postSupportMessage, {
      user: Q,
      params: { id },
      body: { body: "Let me in", clientMessageId: randomUUID() },
    });
    expect(foreign.status).toBe(404);

    const userMessage = randomUUID();
    const mine = await call(ctx, postSupportMessage, {
      user: P,
      params: { id },
      body: {
        body: "Thanks, but the route was longer.",
        clientMessageId: userMessage,
      },
    });
    expect(mine.status).toBe(201);
    const again = await call(ctx, postSupportMessage, {
      user: P,
      params: { id },
      body: {
        body: "Thanks, but the route was longer.",
        clientMessageId: userMessage,
      },
    });
    expect((again.json.data as SupportConversation).messages).toHaveLength(2);

    await adminPost(
      ctx,
      OPS,
      resolveSupport,
      { id },
      {
        expectedVersion: 2,
        resolutionMessage: "No change to the fare.",
      },
    );
    const closed = (await conversation(P, id)).json.data as SupportConversation;
    expect(closed).toMatchObject({
      status: "resolved",
      canReply: false,
      resolutionMessage: "No change to the fare.",
    });
    const late = await call(ctx, postSupportMessage, {
      user: P,
      params: { id },
      body: { body: "One more thing", clientMessageId: randomUUID() },
    });
    expect(late.status).toBe(409);
    expect(late.json.error.code).toBe("SUPPORT_CLOSED");
    const kinds = (await inbox(P)).items
      .filter((i) => i.category === "support")
      .map((i) => i.target);
    expect(kinds).toEqual([
      `/support/${id}`,
      `/support/${id}`,
      `/support/${id}`,
    ]);

    const { rows } = await db.query(
      "SELECT detail FROM mobility.audit_log WHERE action = 'support_message' AND result = 'succeeded'",
    );
    expect(rows).toEqual([{ detail: { length: 40 } }]);
  });

  it("limits how fast a user can send support messages", async () => {
    const rideId = await completedRide();
    const id = await openSupport(rideId);
    const send = () =>
      call(ctx, postSupportMessage, {
        user: P,
        params: { id },
        body: { body: "Hello?", clientMessageId: randomUUID() },
      });
    for (let i = 0; i < 5; i++) expect((await send()).status).toBe(201);
    const limited = await send();
    expect(limited.status).toBe(429);
    advanceClock(ctx, 61);
    expect((await send()).status).toBe(201);
  });
});

describe("operator badges", () => {
  it("counts only the queues an operator may see", async () => {
    const rideId = await completedRide();
    await openSupport(rideId);
    await call(ctx, createReport, {
      user: P,
      params: { id: rideId },
      body: {
        category: "other",
        description: "Something felt unsafe during the trip.",
        clientReportId: randomUUID(),
      },
    });
    await db.query(
      "UPDATE mobility.rides SET needs_review = true, review_reason = 'refund_mismatch' WHERE id = $1",
      [rideId],
    );
    await makeOperator(ctx, OPS, "view");
    await makeOperator(ctx, OPS2, "view,support,verify");
    const viewOnly = (await adminGet(ctx, OPS, adminBadges)).json
      .data as AdminBadges;
    expect(viewOnly).toEqual({
      review: 1,
      financial: 1,
      support: 1,
      safety: null,
      drivers: null,
    });
    const full = (await adminGet(ctx, OPS2, adminBadges)).json
      .data as AdminBadges;
    expect(full).toMatchObject({ safety: 1, drivers: 0 });
    expect((await adminGet(ctx, P, adminBadges)).status).toBe(403);
    await sweep(ctx.deps);
  });
});
