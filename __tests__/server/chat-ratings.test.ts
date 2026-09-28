import { randomUUID } from "node:crypto";

import { CHAT } from "../../server/chat";
import { needsModeration, ratingEligibility } from "../../server/ratings";
import { sweep } from "../../server/rides";
import {
  listFeedback,
  moderateFeedback,
  rideDetail,
} from "../../server/routes/admin";
import {
  getChat,
  listChatMessages,
  markChatRead,
  sendChatMessage,
} from "../../server/routes/chat";
import { rateRide } from "../../server/routes/ratings";

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
  assignedRide,
  cancel,
  dashboard,
  drive,
  interrupt,
  makeOperator,
  onlineDriver,
  registerDevice,
  requestRide,
  viewRide,
  watch,
} from "./scenario";

import type {
  AdminFeedbackItem,
  ChatPage,
  ChatView,
  RideRatingState,
  RideView,
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
const VIEWER = "user_viewer";

const getChatState = (user: string, rideId: string) =>
  call(ctx, getChat, { user, params: { id: rideId } });

const list = (
  user: string,
  rideId: string,
  query: Record<string, number> = {},
) =>
  call(ctx, listChatMessages, {
    user,
    params: { id: rideId },
    url: `http://localhost/api/rides/${rideId}/messages?${new URLSearchParams(
      Object.entries(query).map(([k, v]) => [k, String(v)]),
    )}`,
  });

const send = (
  user: string,
  rideId: string,
  body: string,
  clientMessageId: string = randomUUID(),
) =>
  call(ctx, sendChatMessage, {
    user,
    params: { id: rideId },
    body: { clientMessageId, body },
  });

const markRead = (user: string, rideId: string, seq: number) =>
  call(ctx, markChatRead, { user, params: { id: rideId }, body: { seq } });

const rate = (
  user: string,
  rideId: string,
  stars: number,
  comment?: string | null,
) =>
  call(ctx, rateRide, {
    user,
    params: { id: rideId },
    body: comment === undefined ? { stars } : { stars, comment },
  });

const bodies = (res: { json: { data: ChatPage } }) =>
  res.json.data.messages.map((m) => m.body);

const messageCount = async (rideId: string) =>
  Number(
    (
      await db.query(
        "SELECT count(*) AS n FROM mobility.ride_messages WHERE ride_id = $1",
        [rideId],
      )
    ).rows[0].n,
  );

async function completedRide(passenger = P, driver = A) {
  const rideId = await assignedRide(ctx, passenger, driver);
  await drive(ctx, driver, rideId);
  return rideId;
}

describe("chat access", () => {
  it("opens only between the passenger and the driver who accepted", async () => {
    await onlineDriver(ctx, A);
    const { rideId } = await requestRide(ctx, P);

    expect((await getChatState(P, rideId)).json.data.state).toBe("waiting");
    const early = await send(P, rideId, "hello?");
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe("CHAT_CLOSED");
    expect((await list(A, rideId)).status).toBe(404);
    expect((await send(A, rideId, "offer holder")).status).toBe(404);

    await assign(ctx, A, rideId);
    expect((await send(P, rideId, "I'm by the door")).status).toBe(201);
    expect((await send(A, rideId, "On my way")).status).toBe(201);

    for (const user of [Q, B]) {
      expect((await getChatState(user, rideId)).status).toBe(404);
      expect((await list(user, rideId)).status).toBe(404);
      expect((await send(user, rideId, "let me in")).status).toBe(404);
      expect((await markRead(user, rideId, 5)).status).toBe(404);
    }

    const page = await list(P, rideId);
    expect(page.json.data.messages).toMatchObject([
      { seq: 1, mine: true, body: "I'm by the door" },
      { seq: 2, mine: false, clientMessageId: null, body: "On my way" },
    ]);
    expect(bodies(await list(A, rideId))).toEqual([
      "I'm by the door",
      "On my way",
    ]);
  });

  it("does not depend on payment or location permissions", async () => {
    const rideId = await assignedRide(ctx, P, A);
    advanceClock(ctx, 15 * 60);
    const live = await watch(ctx, P, rideId, { version: 0 });
    expect(live.json.data.live.locationStatus).toBe("unavailable");
    const res = await send(A, rideId, "Here");
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.json.data)).not.toMatch(
      /latitude|longitude|payment|fare/i,
    );
  });

  it("validates message text", async () => {
    const rideId = await assignedRide(ctx, P, A);
    for (const bad of ["", "   \n  ", "x".repeat(501), "bell\u0007"]) {
      const res = await send(P, rideId, bad);
      expect(res.status).toBe(400);
    }
    const ok = await send(P, rideId, "  two\r\nlines  ");
    expect(ok.status).toBe(201);
    expect(ok.json.data.message.body).toBe("two\nlines");
    expect(
      (
        await call(ctx, sendChatMessage, {
          user: P,
          params: { id: rideId },
          body: { clientMessageId: "not-a-uuid", body: "hi" },
        })
      ).status,
    ).toBe(400);
  });
});

describe("driver replacement", () => {
  it("revokes the previous driver at once and hides earlier messages from the new one", async () => {
    await onlineDriver(ctx, A, 300);
    await onlineDriver(ctx, B, 900);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    const kept = randomUUID();
    await send(A, rideId, "Arriving in 2", kept);
    await send(P, rideId, "Blue jacket");

    expect((await cancel(ctx, A, rideId)).status).toBe(200);
    expect((await list(A, rideId)).status).toBe(404);
    expect((await getChatState(A, rideId)).status).toBe(404);
    expect((await send(A, rideId, "wait", kept)).status).toBe(404);
    expect((await send(A, rideId, "still there?")).status).toBe(404);

    expect((await getChatState(P, rideId)).json.data).toMatchObject({
      state: "waiting",
      canSend: false,
    });
    expect((await send(P, rideId, "anyone?")).json.error.code).toBe(
      "CHAT_CLOSED",
    );

    await assign(ctx, B, rideId);
    const fresh = await list(B, rideId);
    expect(fresh.json.data.messages).toEqual([]);
    expect(fresh.json.data.chat.unread).toBe(0);

    await send(B, rideId, "New driver here");
    await send(P, rideId, "Thanks");
    expect(bodies(await list(B, rideId))).toEqual([
      "New driver here",
      "Thanks",
    ]);
    expect((await getChatState(B, rideId)).json.data.unread).toBe(1);

    const passenger = await list(P, rideId);
    expect(
      (passenger.json.data as ChatPage).messages.map((m) => [
        m.body,
        m.earlierDriver,
      ]),
    ).toEqual([
      ["Arriving in 2", true],
      ["Blue jacket", true],
      ["New driver here", false],
      ["Thanks", false],
    ]);
  });
});

describe("ended rides and retention", () => {
  it("stops new messages when the ride ends and keeps history for the retention period", async () => {
    const rideId = await assignedRide(ctx, P, A);
    await send(P, rideId, "See you soon");
    await drive(ctx, A, rideId);

    const closed = await send(A, rideId, "Thanks for riding");
    expect(closed.status).toBe(409);
    expect(closed.json.error.code).toBe("CHAT_CLOSED");
    for (const user of [P, A]) {
      const page = await list(user, rideId);
      expect(page.json.data.chat).toMatchObject({
        state: "closed",
        canSend: false,
      });
      expect(bodies(page)).toEqual(["See you soon"]);
    }
    const until = new Date(
      (await list(P, rideId)).json.data.chat.availableUntil,
    );
    expect(until.getTime() - ctx.clock.now.getTime()).toBe(
      CHAT.retentionDays * 24 * 3600 * 1000,
    );

    advanceClock(ctx, CHAT.retentionDays * 24 * 3600 + 1);
    const expired = await list(P, rideId);
    expect(expired.json.data.chat.state).toBe("expired");
    expect(expired.json.data.messages).toEqual([]);
    await sweep(ctx.deps);
    expect(await messageCount(rideId)).toBe(0);
  });

  it("keeps a cancelled ride's conversation read-only", async () => {
    const rideId = await assignedRide(ctx, P, A);
    await send(A, rideId, "Traffic, 5 min");
    expect((await cancel(ctx, P, rideId)).status).toBe(200);
    const page = await list(A, rideId);
    expect(page.json.data.chat.state).toBe("closed");
    expect(bodies(page)).toEqual(["Traffic, 5 min"]);
    expect((await send(P, rideId, "sorry")).status).toBe(409);
  });
});

describe("ordering and pagination", () => {
  it("pages backwards and forwards in a stable order", async () => {
    const rideId = await assignedRide(ctx, P, A);
    for (let i = 1; i <= 12; i++) {
      const res = await send(i % 2 ? P : A, rideId, `m${i}`);
      expect(res.status).toBe(201);
      expect(res.json.data.message.seq).toBe(i);
    }

    const latest = await list(P, rideId, { limit: 5 });
    expect(bodies(latest)).toEqual(["m8", "m9", "m10", "m11", "m12"]);
    expect(latest.json.data).toMatchObject({
      hasMoreBefore: true,
      hasMoreAfter: false,
    });

    const older = await list(P, rideId, { before: 8, limit: 5 });
    expect(bodies(older)).toEqual(["m3", "m4", "m5", "m6", "m7"]);
    expect(older.json.data.hasMoreBefore).toBe(true);

    const oldest = await list(P, rideId, { before: 3, limit: 5 });
    expect(bodies(oldest)).toEqual(["m1", "m2"]);
    expect(oldest.json.data.hasMoreBefore).toBe(false);

    const newer = await list(A, rideId, { after: 9, limit: 2 });
    expect(bodies(newer)).toEqual(["m10", "m11"]);
    expect(newer.json.data.hasMoreAfter).toBe(true);

    const invalid = await list(P, rideId, { before: 5, after: 2 });
    expect(invalid.status).toBe(400);
    expect((await list(P, rideId, { limit: 51 })).status).toBe(400);
  });

  it("wakes a watcher on a new message and tracks unread messages", async () => {
    const rideId = await assignedRide(ctx, P, A);
    const view = (await viewRide(ctx, P, rideId)).json.data as RideView;
    const cursors = { version: view.version, locationSeq: 1_000_000 };

    const idle = await watch(ctx, P, rideId, { ...cursors, chatSeq: 0 });
    expect(idle.json.data.changed).toBe(false);

    await send(A, rideId, "Outside");
    const woke = await watch(ctx, P, rideId, { ...cursors, chatSeq: 0 });
    expect(woke.json.data.changed).toBe(true);
    expect(woke.json.data.ride.chat).toMatchObject({
      state: "open",
      latestSeq: 1,
      unread: 1,
    });
    const caughtUp = await watch(ctx, P, rideId, { ...cursors, chatSeq: 1 });
    expect(caughtUp.json.data.changed).toBe(false);
    const legacyClient = await watch(ctx, P, rideId, cursors);
    expect(legacyClient.json.data.changed).toBe(false);

    const read = await markRead(P, rideId, 99);
    expect(read.json.data as ChatView).toMatchObject({ readSeq: 1, unread: 0 });
    expect(
      ((await viewRide(ctx, P, rideId)).json.data as RideView).chat.unread,
    ).toBe(0);
    expect(
      ((await viewRide(ctx, A, rideId)).json.data as RideView).chat.unread,
    ).toBe(0);
  });
});

describe("idempotent sending and rate limits", () => {
  it("returns the original message for a repeated or concurrent send", async () => {
    const rideId = await assignedRide(ctx, P, A);
    const id = randomUUID();
    const first = await send(P, rideId, "Gate B", id);
    const again = await send(P, rideId, "Gate B", id);
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(again.json.data).toMatchObject({
      duplicate: true,
      message: { id: first.json.data.message.id, seq: 1 },
    });

    const racer = randomUUID();
    const raced = await Promise.all([
      send(P, rideId, "Gate C", racer),
      send(P, rideId, "Gate C", racer),
      send(P, rideId, "Gate C", racer),
    ]);
    expect(raced.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(await messageCount(rideId)).toBe(2);

    const reused = await send(P, rideId, "Different text", id);
    expect(reused.status).toBe(409);
    expect(reused.json.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("limits bursts and the total per ride", async () => {
    const rideId = await assignedRide(ctx, P, A);
    for (let i = 0; i < CHAT.burstLimit; i++) {
      expect((await send(P, rideId, `quick ${i}`)).status).toBe(201);
    }
    const limited = await send(P, rideId, "one more");
    expect(limited.status).toBe(429);
    expect(limited.json.error).toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: CHAT.burstWindowSeconds,
    });
    expect(limited.response.headers.get("Retry-After")).toBe(
      String(CHAT.burstWindowSeconds),
    );
    expect((await send(A, rideId, "driver unaffected")).status).toBe(201);

    advanceClock(ctx, CHAT.burstWindowSeconds + 1);
    expect((await send(P, rideId, "after the wait")).status).toBe(201);

    await db.query(
      `INSERT INTO mobility.ride_messages
         (ride_id, seq, driver_profile_id, sender_role, sender_user_id, client_message_id, body, created_at)
       SELECT m.ride_id, 1000 + g, m.driver_profile_id, m.sender_role, m.sender_user_id,
              gen_random_uuid(), 'bulk', m.created_at - interval '1 hour'
         FROM mobility.ride_messages m, generate_series(1, $2::int) g
        WHERE m.ride_id = $1 AND m.seq = 1`,
      [rideId, CHAT.perRideLimit],
    );
    await db.query(
      "UPDATE mobility.ride_chats SET last_seq = 5000 WHERE ride_id = $1",
      [rideId],
    );
    const capped = await send(P, rideId, "over the cap");
    expect(capped.status).toBe(429);
    expect(capped.json.error.code).toBe("CHAT_LIMIT_REACHED");
  });
});

describe("chat notifications", () => {
  it("pushes a generic, collapsed notice to the other participant", async () => {
    const rideId = await assignedRide(ctx, P, A);
    await registerDevice(ctx, A, "ExponentPushToken[driver-a]");
    await registerDevice(ctx, P, "ExponentPushToken[passenger]");
    const chatPushes = (token: string) =>
      ctx.push.to(token).filter((m) => m.data.kind === "chat_message");

    await send(P, rideId, "My door code is 4321");
    await send(P, rideId, "Second message");
    const toDriver = chatPushes("ExponentPushToken[driver-a]");
    expect(toDriver).toHaveLength(1);
    expect(toDriver[0]).toMatchObject({
      title: "New message from your passenger",
      body: "Open the app to read it.",
      data: {
        kind: "chat_message",
        rideId,
        target: `/chat/${rideId}`,
        recipient: A,
      },
    });
    expect(JSON.stringify(toDriver[0])).not.toContain("4321");
    expect(chatPushes("ExponentPushToken[passenger]")).toHaveLength(0);

    advanceClock(ctx, CHAT.pushQuietSeconds);
    await send(P, rideId, "Third message");
    expect(chatPushes("ExponentPushToken[driver-a]")).toHaveLength(2);

    await send(A, rideId, "Got it");
    expect(chatPushes("ExponentPushToken[passenger]")).toMatchObject([
      { title: "New message from your driver", data: { recipient: P } },
    ]);
  });
});

describe("rating eligibility", () => {
  it("allows each side to rate a completed, paid trip once", async () => {
    const rideId = await assignedRide(ctx, P, A);
    expect((await rate(P, rideId, 5)).json.error.code).toBe(
      "RATING_NOT_ALLOWED",
    );
    await drive(ctx, A, rideId);

    const passenger = await rate(P, rideId, 5, "Great driver");
    expect(passenger.status).toBe(201);
    expect(passenger.json.data as RideRatingState).toMatchObject({
      stars: 5,
      comment: "Great driver",
      eligible: false,
      canEdit: true,
    });
    expect((await rate(A, rideId, 4)).status).toBe(201);
    expect((await rate(Q, rideId, 1)).status).toBe(404);
    expect((await rate(B, rideId, 1)).status).toBe(404);

    const { rows } = await db.query(
      "SELECT rater_role, stars FROM mobility.ratings WHERE ride_id = $1 ORDER BY rater_role",
      [rideId],
    );
    expect(rows).toEqual([
      { rater_role: "driver", stars: 4 },
      { rater_role: "passenger", stars: 5 },
    ]);
  });

  it("refuses cancelled, interrupted and unpaid trips", async () => {
    const cancelled = await assignedRide(ctx, P, A);
    await cancel(ctx, P, cancelled);
    expect((await rate(P, cancelled, 1)).json.error.code).toBe(
      "RATING_NOT_ALLOWED",
    );
    expect((await rate(A, cancelled, 1)).status).toBe(409);

    const interrupted = await requestRide(ctx, P);
    await assign(ctx, A, interrupted.rideId);
    await drive(ctx, A, interrupted.rideId, "in_progress");
    await interrupt(ctx, A, interrupted.rideId);
    expect((await rate(P, interrupted.rideId, 2)).status).toBe(409);

    const unpaid = await requestRide(ctx, P);
    await assign(ctx, A, unpaid.rideId);
    ctx.stripe.failNext.capture = true;
    await drive(ctx, A, unpaid.rideId);
    const res = await rate(P, unpaid.rideId, 5);
    expect(res.status).toBe(409);
    expect(res.json.error.message).toMatch(/payment is confirmed/);
    const view = (await viewRide(ctx, P, unpaid.rideId)).json.data as RideView;
    expect(view.rating.reason).toBe("payment_pending");
  });

  it("treats simulated trips and the rating window as ineligible", () => {
    const now = new Date("2026-05-10T00:00:00Z");
    const base = {
      status: "completed" as const,
      payment_status: "paid",
      demo_driver_id: null,
      driver_profile_id: "d",
      completed_at: new Date("2026-05-09T00:00:00Z"),
    };
    expect(ratingEligibility(base, now).reason).toBeNull();
    expect(
      ratingEligibility({ ...base, status: "legacy", demo_driver_id: 3 }, now)
        .reason,
    ).toBe("simulated");
    expect(
      ratingEligibility(base, new Date("2026-05-16T00:00:01Z")).reason,
    ).toBe("window_closed");
    expect(needsModeration(5, null)).toBe(false);
    expect(needsModeration(2, null)).toBe(true);
    expect(needsModeration(5, "note")).toBe(true);
  });

  it("does not let a user rate themselves", async () => {
    const rideId = await completedRide();
    expect((await apply(ctx, P)).status).toBe(201);
    await db.query(
      `UPDATE mobility.rides SET driver_profile_id =
         (SELECT dp.id FROM mobility.driver_profiles dp
            JOIN mobility.users u ON u.id = dp.user_id WHERE u.clerk_id = $2)
        WHERE id = $1`,
      [rideId, P],
    );
    const res = await rate(P, rideId, 5);
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("CANNOT_RATE_SELF");
    await db.query(
      `UPDATE mobility.rides r SET driver_profile_id = o.driver_profile_id
         FROM mobility.ride_offers o
        WHERE o.ride_id = r.id AND o.status = 'accepted' AND r.id = $1`,
      [rideId],
    );
  });

  it("validates the scale and feedback length", async () => {
    const rideId = await completedRide();
    for (const stars of [0, 6, 2.5]) {
      expect((await rate(P, rideId, stars)).status).toBe(400);
    }
    expect((await rate(P, rideId, 4, "x".repeat(301))).status).toBe(400);
  });
});

describe("duplicate and edited ratings", () => {
  it("keeps one record under double taps and concurrent submissions", async () => {
    const rideId = await completedRide();
    const results = await Promise.all([
      rate(P, rideId, 5),
      rate(P, rideId, 5),
      rate(P, rideId, 5),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.ratings WHERE ride_id = $1",
      [rideId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("allows edits only inside the editing window", async () => {
    const rideId = await completedRide();
    await rate(P, rideId, 3);
    advanceClock(ctx, 30 * 60);
    const edited = await rate(P, rideId, 4, "Better on reflection");
    expect(edited.status).toBe(200);
    expect(edited.json.data.stars).toBe(4);

    advanceClock(ctx, 31 * 60);
    const locked = await rate(P, rideId, 1);
    expect(locked.status).toBe(409);
    expect(locked.json.error.code).toBe("RATING_LOCKED");
    expect((await rate(P, rideId, 4, "Better on reflection")).status).toBe(200);
  });
});

describe("rating summaries and privacy", () => {
  it("shows an average only after enough final ratings and never shares written feedback", async () => {
    await onlineDriver(ctx, A);
    const passengers = ["user_rider_1", "user_rider_2", "user_rider_3"];
    const rides: string[] = [];
    for (const [i, rider] of passengers.entries()) {
      const { rideId } = await requestRide(ctx, rider);
      await assign(ctx, A, rideId);
      await drive(ctx, A, rideId);
      await rate(rider, rideId, i === 0 ? 3 : 5, `private note ${i}`);
      rides.push(rideId);
    }

    expect((await dashboard(ctx, A)).profile?.rating).toEqual({
      count: 0,
      average: null,
    });
    advanceClock(ctx, 61 * 60);
    expect((await dashboard(ctx, A)).profile?.rating).toEqual({
      count: 3,
      average: 4.3,
    });
    const passengerView = (await viewRide(ctx, passengers[0], rides[0])).json
      .data as RideView;
    expect(passengerView.counterpartRating).toEqual({ count: 3, average: 4.3 });
    expect(passengerView.rating.comment).toBe("private note 0");

    const driverView = JSON.stringify(
      (await viewRide(ctx, A, rides[0])).json.data,
    );
    expect(driverView).not.toContain("private note");
    expect(driverView).not.toMatch(/"stars":3/);
    expect(JSON.stringify(await dashboard(ctx, A))).not.toContain(
      "private note",
    );
  });
});

describe("feedback moderation", () => {
  it("queues low or written feedback for operators and audits decisions", async () => {
    const rideId = await completedRide();
    await rate(P, rideId, 1, "Rude and unsafe");
    await rate(A, rideId, 5);
    await makeOperator(ctx, OPS, "view,support");
    await makeOperator(ctx, VIEWER, "view");

    const queue = await adminGet(ctx, OPS, listFeedback, {
      query: { status: "pending" },
    });
    const items = queue.json.data.items as AdminFeedbackItem[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      rideId,
      raterRole: "passenger",
      stars: 1,
      comment: "Rude and unsafe",
      status: "pending",
    });
    expect(items[0].rater.account).toMatch(/^user_…/);

    expect((await adminGet(ctx, P, listFeedback, { query: {} })).status).toBe(
      403,
    );
    const denied = await adminPost(
      ctx,
      VIEWER,
      moderateFeedback,
      { id: items[0].id },
      { action: "remove", note: "abusive", expectedVersion: 1 },
    );
    expect(denied.json.error.code).toBe("PERMISSION_DENIED");

    const [first, second] = await Promise.all([
      adminPost(
        ctx,
        OPS,
        moderateFeedback,
        { id: items[0].id },
        { action: "reviewed", note: "Checked the trip", expectedVersion: 1 },
      ),
      adminPost(
        ctx,
        OPS,
        moderateFeedback,
        { id: items[0].id },
        { action: "remove", note: "Abusive wording", expectedVersion: 1 },
      ),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winner = first.status === 200 ? first : second;
    const version = winner.json.data.version;

    const removed = await adminPost(
      ctx,
      OPS,
      moderateFeedback,
      { id: items[0].id },
      { action: "remove", note: "Abusive wording", expectedVersion: version },
    );
    if (winner.json.data.status !== "removed") {
      expect(removed.status).toBe(200);
      expect(removed.json.data.status).toBe("removed");
    }

    advanceClock(ctx, 61 * 60);
    expect((await dashboard(ctx, A)).profile?.rating.count).toBe(0);

    const { rows } = await db.query(
      "SELECT action, result, reason, detail FROM mobility.audit_log WHERE target_type = 'rating' ORDER BY id",
    );
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["feedback_moderate_denied", "feedback_remove"]),
    );
    expect(JSON.stringify(rows)).not.toContain("Rude and unsafe");
  });

  it("returns ratings on the operator ride detail", async () => {
    const rideId = await completedRide();
    await rate(P, rideId, 2);
    await makeOperator(ctx, OPS, "view");
    const res = await adminGet(ctx, OPS, rideDetail, {
      params: { id: rideId },
    });
    expect(res.json.data.ratings).toMatchObject([
      { raterRole: "passenger", stars: 2, status: "pending" },
    ]);
  });
});
