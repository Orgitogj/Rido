import { randomUUID } from "node:crypto";

import { sweep } from "../../server/rides";
import {
  assignSupport,
  listSupport,
  resolveSupport,
  supportAttachmentAccess as adminAttachmentAccess,
  supportDetail,
} from "../../server/routes/admin";
import {
  adminSupportReply,
  completeSupportAttachment,
  createSupport,
  createSupportAttachment,
  deleteSupportAttachment,
  getInbox,
  getSupportRequest,
  listSupportRequests,
  postSupportMessage,
  supportAttachmentAccess,
} from "../../server/routes/inbox";
import { deleteAccount, getAccount } from "../../server/routes/profile";
import { SUPPORT_RULES } from "../../shared/account";

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
  cancel,
  drive,
  makeOperator,
  onlineDriver,
  requestRide,
} from "./scenario";

import type {
  InboxPage,
  SupportAttachmentTicket,
  SupportConversation,
} from "../../shared/account";
import type { AdminSupportDetail, Page } from "../../shared/contracts";
import type { AdminSupportItem } from "../../shared/contracts";

const db = testDb();
let ctx: TestContext;

beforeEach(async () => {
  await resetDb(db);
  ctx = createContext(db);
});
afterEach(() => assertInvariants(ctx));
afterAll(() => db.end());

const P = "user_passenger";
const D = "user_driver";
const D2 = "user_driver_two";
const X = "user_stranger";
const OPS = "user_operator";
const VIEW = "user_viewer";

const PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...new Array(200).fill(1),
]);
const JPEG = new Uint8Array([
  0xff,
  0xd8,
  0xff,
  0xe0,
  ...new Array(300).fill(2),
]);

const ticketFor = (user: string, bytes: Uint8Array, contentType: string) =>
  call(ctx, createSupportAttachment, {
    user,
    body: { contentType, sizeBytes: bytes.length },
  });

async function readyAttachment(
  user: string,
  bytes = PNG,
  contentType = "image/png",
) {
  const res = await ticketFor(user, bytes, contentType);
  expect(res.status).toBe(201);
  const ticket = res.json.data as SupportAttachmentTicket;
  ctx.storage.upload(ticket.upload, bytes, contentType);
  const done = await call(ctx, completeSupportAttachment, {
    method: "POST",
    user,
    params: { id: ticket.attachment.id },
  });
  expect(done.status).toBe(200);
  return ticket;
}

const open = (
  user: string,
  body: Partial<{
    role: string;
    rideId: string | null;
    category: string;
    message: string;
    clientRequestId: string;
    attachmentIds: string[];
  }>,
) =>
  call(ctx, createSupport, {
    user,
    body: {
      role: "passenger",
      category: "other",
      message: "I need some help with this.",
      clientRequestId: randomUUID(),
      ...body,
    },
  });

async function rideWithFormerDriver() {
  await onlineDriver(ctx, D, 300);
  const { rideId } = await requestRide(ctx, P);
  await assign(ctx, D, rideId);
  expect((await cancel(ctx, D, rideId)).status).toBe(200);
  await onlineDriver(ctx, D2, 600);
  await assign(ctx, D2, rideId);
  await drive(ctx, D2, rideId);
  return rideId;
}

describe("support for drivers", () => {
  it("lets a driver ask about the account and about a ride they drove", async () => {
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    await drive(ctx, D, rideId);

    const account = await open(D, {
      role: "driver",
      category: "application_question",
    });
    expect(account.status).toBe(201);
    expect(account.json.data).toMatchObject({
      role: "driver",
      rideId: null,
      destination: null,
    });

    const aboutRide = await open(D, {
      role: "driver",
      rideId,
      category: "passenger_issue",
    });
    expect(aboutRide.status).toBe(201);
    const view = aboutRide.json.data as SupportConversation;
    expect(view).toMatchObject({ role: "driver", rideId, destination: null });
    expect(JSON.stringify(view)).not.toMatch(/Mission St|user_passenger/);

    const list = await call(ctx, listSupportRequests, {
      user: D,
      url: "http://localhost/api/support",
    });
    expect(list.json.data.items).toHaveLength(2);
    const passengerList = await call(ctx, listSupportRequests, {
      user: P,
      url: "http://localhost/api/support",
    });
    expect(passengerList.json.data.items).toHaveLength(0);
  });

  it("enforces categories by role and ride, and needs a driver profile", async () => {
    const { rideId } = await (async () => {
      await onlineDriver(ctx, D);
      const r = await requestRide(ctx, P);
      await assign(ctx, D, r.rideId);
      await drive(ctx, D, r.rideId);
      return r;
    })();
    expect(
      (await open(P, { role: "passenger", category: "earnings_question" }))
        .status,
    ).toBe(400);
    expect(
      (await open(P, { role: "passenger", category: "charge_question" }))
        .status,
    ).toBe(400);
    expect(
      (await open(D, { role: "driver", rideId, category: "driver_issue" }))
        .status,
    ).toBe(400);
    const notDriver = await open(X, {
      role: "driver",
      category: "account_issue",
    });
    expect(notDriver.status).toBe(403);
    expect(notDriver.json.error.code).toBe("NOT_A_DRIVER");
    expect(
      (await open(P, { role: "passenger", category: "account_issue" })).status,
    ).toBe(201);
  });

  it("refuses rides the user never took part in, in either role", async () => {
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    await drive(ctx, D, rideId);
    await apply(ctx, D2);

    for (const [user, role, category] of [
      [X, "passenger", "trip_problem"],
      [D2, "driver", "trip_problem"],
      [D, "passenger", "trip_problem"],
      [P, "driver", "trip_problem"],
    ] as const) {
      const res = await open(user, { role, rideId, category });
      expect([user, role, res.status]).toEqual([user, role, 404]);
    }
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.support_requests",
    );
    expect(rows[0].n).toBe(0);
  });

  it("lets a former driver report their own experience without seeing the other conversations", async () => {
    const rideId = await rideWithFormerDriver();
    const former = await open(D, {
      role: "driver",
      rideId,
      category: "passenger_issue",
      message: "The passenger was not at the pickup.",
    });
    expect(former.status).toBe(201);
    const current = await open(D2, {
      role: "driver",
      rideId,
      category: "trip_problem",
      message: "The route was closed near the destination.",
    });
    const passenger = await open(P, {
      role: "passenger",
      rideId,
      category: "driver_issue",
      message: "The first driver cancelled on me.",
    });
    const formerId = former.json.data.id as string;
    expect(JSON.stringify(former.json.data)).not.toMatch(
      /Mission St|first driver cancelled|route was closed/,
    );
    for (const otherId of [current.json.data.id, passenger.json.data.id]) {
      expect(
        (
          await call(ctx, getSupportRequest, {
            user: D,
            params: { id: otherId },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await call(ctx, postSupportMessage, {
            user: D,
            params: { id: otherId },
            body: { body: "Let me in", clientMessageId: randomUUID() },
          })
        ).status,
      ).toBe(404);
    }
    expect(
      (
        await call(ctx, getSupportRequest, {
          user: P,
          params: { id: formerId },
        })
      ).status,
    ).toBe(404);
    const mine = await call(ctx, listSupportRequests, {
      user: D,
      url: "http://localhost/api/support",
    });
    expect(mine.json.data.items.map((i: { id: string }) => i.id)).toEqual([
      formerId,
    ]);
  });

  it("creates one request when the same submission is retried or sent twice at once", async () => {
    await apply(ctx, D);
    const clientRequestId = randomUUID();
    const body = {
      role: "driver",
      category: "account_issue",
      clientRequestId,
    };
    const [a, b] = await Promise.all([open(D, body), open(D, body)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const again = await open(D, body);
    expect(again.status).toBe(200);
    expect(again.json.data.id).toBe(a.json.data.id);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.support_requests",
    );
    expect(rows[0].n).toBe(1);
  });

  it("uses the same assignment, reply, note and notification flow for driver requests", async () => {
    await apply(ctx, D);
    await makeOperator(ctx, OPS, "view,support");
    await makeOperator(ctx, VIEW, "view");
    const created = await open(D, {
      role: "driver",
      category: "earnings_question",
      message: "My earnings look different from the fare.",
    });
    const id = created.json.data.id as string;

    const queue = await adminGet(ctx, OPS, listSupport, {
      query: { role: "driver" },
    });
    const items = (queue.json.data as Page<AdminSupportItem>).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id, role: "driver", rideId: null });
    expect(
      (await adminGet(ctx, OPS, listSupport, { query: { role: "passenger" } }))
        .json.data.items,
    ).toHaveLength(0);

    const reply = (op: string) =>
      adminPost(
        ctx,
        op,
        adminSupportReply,
        { id },
        { body: "We're checking the ledger.", clientMessageId: randomUUID() },
      );
    expect((await reply(VIEW)).status).toBe(403);
    expect((await reply(OPS)).status).toBe(409);
    expect(
      (await adminPost(ctx, OPS, assignSupport, { id }, { expectedVersion: 1 }))
        .status,
    ).toBe(200);
    expect((await reply(OPS)).status).toBe(201);

    const inbox = (
      await call(ctx, getInbox, {
        user: D,
        url: "http://localhost/api/notifications",
      })
    ).json.data as InboxPage;
    expect(inbox.items.map((i) => i.target)).toContain(`/support/${id}`);
    expect(inbox.items.every((i) => i.category === "support")).toBe(true);

    const detail = (await adminGet(ctx, OPS, supportDetail, { params: { id } }))
      .json.data as AdminSupportDetail;
    expect(detail.role).toBe("driver");
    expect(detail.passenger.account).toMatch(/^user_…/);
  });
});

describe("private support attachments", () => {
  it("attaches validated images to a request and a reply, with short-lived private links", async () => {
    await makeOperator(ctx, OPS, "view,support");
    await makeOperator(ctx, VIEW, "view");
    const first = await readyAttachment(P, PNG, "image/png");
    const created = await open(P, {
      category: "account_issue",
      attachmentIds: [first.attachment.id],
    });
    expect(created.status).toBe(201);
    const id = created.json.data.id as string;
    expect(created.json.data.attachments).toHaveLength(1);
    expect(JSON.stringify(created.json.data)).not.toMatch(
      /support-attachments|storage\.test|etag/,
    );

    const second = await readyAttachment(P, JPEG, "image/jpeg");
    const replied = await call(ctx, postSupportMessage, {
      user: P,
      params: { id },
      body: {
        body: "Here is another photo.",
        clientMessageId: randomUUID(),
        attachmentIds: [second.attachment.id],
      },
    });
    expect(replied.status).toBe(201);
    const view = replied.json.data as SupportConversation;
    expect(view.messages[0].attachments).toHaveLength(1);
    expect(view.attachmentsRemaining).toBe(
      SUPPORT_RULES.attachmentsPerRequest - 2,
    );

    const mine = await call(ctx, supportAttachmentAccess, {
      method: "POST",
      user: P,
      params: { id, attachmentId: first.attachment.id },
    });
    expect(mine.status).toBe(200);
    expect(mine.json.data.url).toMatch(
      new RegExp(`expires=${SUPPORT_RULES.attachmentViewUrlSeconds}$`),
    );
    expect(ctx.storage.fetchView(mine.json.data.url)).toEqual(PNG);

    expect(
      (
        await call(ctx, supportAttachmentAccess, {
          method: "POST",
          user: X,
          params: { id, attachmentId: first.attachment.id },
        })
      ).status,
    ).toBe(404);

    const op = await adminPost(
      ctx,
      OPS,
      adminAttachmentAccess,
      { id, attachmentId: second.attachment.id },
      undefined,
    );
    expect(op.status).toBe(200);
    expect(ctx.storage.fetchView(op.json.data.url)).toEqual(JPEG);
    expect(
      (
        await adminPost(
          ctx,
          VIEW,
          adminAttachmentAccess,
          { id, attachmentId: second.attachment.id },
          undefined,
        )
      ).status,
    ).toBe(403);
    const { rows: audit } = await db.query<{ result: string; detail: string }>(
      `SELECT result, detail::text AS detail FROM mobility.audit_log
        WHERE action LIKE 'support_attachment_access%' ORDER BY id`,
    );
    expect(audit.map((a) => a.result)).toEqual(["succeeded", "denied"]);
    expect(audit[0].detail).not.toMatch(/support-attachments|storage\.test/);

    const detail = (await adminGet(ctx, OPS, supportDetail, { params: { id } }))
      .json.data as AdminSupportDetail;
    expect(detail.attachments.map((a) => a.messageId === null).sort()).toEqual([
      false,
      true,
    ]);
    expect(JSON.stringify(detail)).not.toMatch(/support-attachments/);
  });

  it("rejects wrong types, oversized, disguised and missing files, and removes them", async () => {
    expect((await ticketFor(P, PNG, "application/pdf")).status).toBe(400);
    expect(
      (
        await call(ctx, createSupportAttachment, {
          user: P,
          body: {
            contentType: "image/png",
            sizeBytes: SUPPORT_RULES.attachmentMaxBytes + 1,
          },
        })
      ).status,
    ).toBe(400);

    const disguised = (await ticketFor(P, PNG, "image/jpeg")).json
      .data as SupportAttachmentTicket;
    ctx.storage.upload(disguised.upload, PNG, "image/jpeg");
    const rejected = await call(ctx, completeSupportAttachment, {
      method: "POST",
      user: P,
      params: { id: disguised.attachment.id },
    });
    expect(rejected.status).toBe(422);
    expect(rejected.json.error.code).toBe("FILE_REJECTED");
    expect(ctx.storage.objects.size).toBe(0);

    const wrongSize = (await ticketFor(P, PNG, "image/png")).json
      .data as SupportAttachmentTicket;
    ctx.storage.upload(
      wrongSize.upload,
      new Uint8Array([...PNG, 1, 2, 3]),
      "image/png",
    );
    expect(
      (
        await call(ctx, completeSupportAttachment, {
          method: "POST",
          user: P,
          params: { id: wrongSize.attachment.id },
        })
      ).status,
    ).toBe(422);

    const missing = (await ticketFor(P, PNG, "image/png")).json
      .data as SupportAttachmentTicket;
    const notUploaded = await call(ctx, completeSupportAttachment, {
      method: "POST",
      user: P,
      params: { id: missing.attachment.id },
    });
    expect(notUploaded.status).toBe(409);
    expect(notUploaded.json.error.code).toBe("UPLOAD_NOT_FOUND");
    ctx.storage.upload(missing.upload, PNG, "image/png");
    expect(
      (
        await call(ctx, completeSupportAttachment, {
          method: "POST",
          user: P,
          params: { id: missing.attachment.id },
        })
      ).status,
    ).toBe(200);
  });

  it("answers 503 honestly when storage isn't configured and still accepts a text-only request", async () => {
    ctx.deps.storage = null;
    const res = await ticketFor(P, PNG, "image/png");
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("STORAGE_NOT_CONFIGURED");
    expect((await open(P, { category: "account_issue" })).status).toBe(201);
  });

  it("only accepts the owner's ready, unused attachments", async () => {
    const mine = await readyAttachment(P);
    const theirs = await readyAttachment(X);
    const pending = (await ticketFor(P, PNG, "image/png")).json
      .data as SupportAttachmentTicket;

    for (const attachmentIds of [
      [theirs.attachment.id],
      [pending.attachment.id],
      [randomUUID()],
      [mine.attachment.id, theirs.attachment.id],
    ]) {
      const res = await open(P, { category: "account_issue", attachmentIds });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe("ATTACHMENT_NOT_READY");
    }
    expect(
      (
        await open(P, {
          category: "account_issue",
          attachmentIds: [mine.attachment.id, mine.attachment.id],
        })
      ).status,
    ).toBe(400);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.support_requests",
    );
    expect(rows[0].n).toBe(0);

    const first = await open(P, {
      category: "account_issue",
      attachmentIds: [mine.attachment.id],
    });
    expect(first.status).toBe(201);
    const reuse = await open(P, {
      category: "other",
      attachmentIds: [mine.attachment.id],
    });
    expect(reuse.status).toBe(409);

    expect(
      (
        await call(ctx, completeSupportAttachment, {
          method: "POST",
          user: X,
          params: { id: mine.attachment.id },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(ctx, deleteSupportAttachment, {
          method: "DELETE",
          user: X,
          params: { id: mine.attachment.id },
        })
      ).status,
    ).toBe(404);
  });

  it("can't change an attachment through its upload link after confirmation", async () => {
    const ticket = await readyAttachment(P);
    const created = await open(P, {
      category: "account_issue",
      attachmentIds: [ticket.attachment.id],
    });
    const id = created.json.data.id as string;
    const evil = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...new Array(200).fill(9),
    ]);
    ctx.storage.upload(ticket.upload, evil, "image/png");
    const again = await call(ctx, completeSupportAttachment, {
      method: "POST",
      user: P,
      params: { id: ticket.attachment.id },
    });
    expect(again.status).toBe(200);
    const access = await call(ctx, supportAttachmentAccess, {
      method: "POST",
      user: P,
      params: { id, attachmentId: ticket.attachment.id },
    });
    expect(ctx.storage.fetchView(access.json.data.url)).toEqual(PNG);

    advanceClock(
      ctx,
      SUPPORT_RULES.attachmentUploadUrlSeconds +
        SUPPORT_RULES.attachmentUploadKeyGraceSeconds +
        5,
    );
    await sweep(ctx.deps);
    expect(
      [...ctx.storage.objects.keys()].filter((k) => k.includes("/uploads/")),
    ).toEqual([]);
    expect(ctx.storage.fetchView(access.json.data.url)).toEqual(PNG);
  });

  it("removes an attachment before sending, and refuses once it was sent", async () => {
    const ticket = await readyAttachment(P);
    const removed = await call(ctx, deleteSupportAttachment, {
      method: "DELETE",
      user: P,
      params: { id: ticket.attachment.id },
    });
    expect(removed.status).toBe(200);
    expect(
      (
        await open(P, {
          category: "account_issue",
          attachmentIds: [ticket.attachment.id],
        })
      ).status,
    ).toBe(409);
    await sweep(ctx.deps);
    expect(ctx.storage.objects.size).toBe(0);

    const sent = await readyAttachment(P);
    await open(P, {
      category: "account_issue",
      attachmentIds: [sent.attachment.id],
    });
    const refuse = await call(ctx, deleteSupportAttachment, {
      method: "DELETE",
      user: P,
      params: { id: sent.attachment.id },
    });
    expect(refuse.status).toBe(409);
    expect(refuse.json.error.code).toBe("ATTACHMENT_SENT");
  });

  it("limits unsent attachments per user and attachments per message and request", async () => {
    const ids: string[] = [];
    for (let i = 0; i < SUPPORT_RULES.pendingAttachmentsPerUser; i++) {
      ids.push((await readyAttachment(P)).attachment.id);
    }
    const over = await ticketFor(P, PNG, "image/png");
    expect(over.status).toBe(409);
    expect(over.json.error.code).toBe("ATTACHMENT_LIMIT");

    expect(
      (await open(P, { category: "account_issue", attachmentIds: ids })).status,
    ).toBe(400);
    const created = await open(P, {
      category: "account_issue",
      attachmentIds: ids.slice(0, 3),
    });
    expect(created.status).toBe(201);
    const id = created.json.data.id as string;
    const send = (attachmentIds: string[]) =>
      call(ctx, postSupportMessage, {
        user: P,
        params: { id },
        body: {
          body: "More photos",
          clientMessageId: randomUUID(),
          attachmentIds,
        },
      });
    expect((await send(ids.slice(3, 6))).status).toBe(201);
    for (let i = 0; i < 2; i++) {
      const more = [
        (await readyAttachment(P)).attachment.id,
        (await readyAttachment(P)).attachment.id,
      ];
      expect((await send(more)).status).toBe(201);
    }
    const last = (await readyAttachment(P)).attachment.id;
    const tooMany = await send([last]);
    expect(tooMany.status).toBe(409);
    expect(tooMany.json.error.code).toBe("ATTACHMENT_LIMIT");
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.support_messages",
    );
    expect(rows[0].n).toBe(3);
  });

  it("promotes one upload once under concurrent confirmations", async () => {
    const ticket = (await ticketFor(P, PNG, "image/png")).json
      .data as SupportAttachmentTicket;
    ctx.storage.upload(ticket.upload, PNG, "image/png");
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        call(ctx, completeSupportAttachment, {
          method: "POST",
          user: P,
          params: { id: ticket.attachment.id },
        }),
      ),
    );
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThan(0);
    for (const r of results) expect([200, 409]).toContain(r.status);
    advanceClock(ctx, SUPPORT_RULES.attachmentReservationSeconds + 10);
    await sweep(ctx.deps);
    const { rows } = await db.query<{ storage_key: string }>(
      "SELECT storage_key FROM mobility.support_attachments WHERE id = $1",
      [ticket.attachment.id],
    );
    expect([...ctx.storage.objects.keys()]).toEqual([rows[0].storage_key]);
  });

  it("deletes abandoned uploads, resolved requests' files after retention, and files of deleted accounts", async () => {
    await makeOperator(ctx, OPS, "view,support");
    const abandoned = await readyAttachment(P);
    const kept = await readyAttachment(P);
    const created = await open(P, {
      category: "account_issue",
      attachmentIds: [kept.attachment.id],
    });
    const id = created.json.data.id as string;

    advanceClock(ctx, SUPPORT_RULES.abandonedAttachmentHours * 3600 + 60);
    await sweep(ctx.deps);
    const status = async (attachmentId: string) =>
      (
        await db.query<{ status: string }>(
          "SELECT status FROM mobility.support_attachments WHERE id = $1",
          [attachmentId],
        )
      ).rows[0].status;
    expect(await status(abandoned.attachment.id)).toBe("deleted");
    expect(await status(kept.attachment.id)).toBe("attached");
    expect(ctx.storage.objects.size).toBe(1);

    await adminPost(ctx, OPS, assignSupport, { id }, { expectedVersion: 1 });
    expect(
      (
        await adminPost(
          ctx,
          OPS,
          resolveSupport,
          { id },
          { expectedVersion: 2, resolutionMessage: "Sorted out." },
        )
      ).status,
    ).toBe(200);
    await db.query(
      "UPDATE mobility.support_requests SET resolved_at = $2 WHERE id = $1",
      [
        id,
        new Date(
          ctx.clock.now.getTime() -
            (SUPPORT_RULES.attachmentRetentionDays - 1) * 86_400_000,
        ),
      ],
    );
    await sweep(ctx.deps);
    expect(await status(kept.attachment.id)).toBe("attached");
    advanceClock(ctx, 2 * 86_400);
    await sweep(ctx.deps);
    expect(await status(kept.attachment.id)).toBe("deleted");
    expect(ctx.storage.objects.size).toBe(0);
    const gone = await call(ctx, supportAttachmentAccess, {
      method: "POST",
      user: P,
      params: { id, attachmentId: kept.attachment.id },
    });
    expect(gone.status).toBe(404);

    const other = await readyAttachment(X);
    await open(X, {
      category: "account_issue",
      attachmentIds: [other.attachment.id],
    });
    await call(ctx, getAccount, { user: X });
    const deleted = await call(ctx, deleteAccount, {
      user: X,
      factorAgeMinutes: 1,
      body: { confirm: "DELETE" },
    });
    expect(deleted.status).toBe(200);
    await sweep(ctx.deps);
    expect(await status(other.attachment.id)).toBe("deleted");
    expect(ctx.storage.objects.size).toBe(0);
  });
});
