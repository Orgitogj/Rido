import * as admin from "../../scripts/admin-lib.cjs";
import { sweep } from "../../server/rides";
import {
  applyToDrive,
  completeDocumentUpload,
  reopenDriverApplication,
  requestDocumentUpload,
  setAvailability,
  submitDriverApplication,
} from "../../server/routes/driver";
import {
  accessDriverDocument,
  decideDriverApplication,
  getDriverApplication,
  listDriverApplications,
} from "../../server/routes/verification";
import { presignS3 } from "../../server/storage";
import { purgeDriverDocuments } from "../../server/verification";

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
  fix,
  goOnline,
  makeOperator,
  onlineDriver,
  postLocation,
  registerDevice,
  requestRide,
  setStatus,
  viewRide,
} from "./scenario";

import type {
  AdminDriverDetail,
  AdminDriverItem,
  DocumentKind,
  DocumentUploadTicket,
  DriverProfileView,
  Page,
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

const A = "user_driver_a";
const B = "user_driver_b";
const P = "user_passenger";
const OPS = "user_operator";
const OPS2 = "user_operator_two";
const SUPPORT = "user_support_only";
const DAY = 24 * 3600;

const pad = (head: number[], size = 400) => {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return bytes;
};
const PDF = pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);

const day = (offset: number) =>
  new Date(ctx.clock.now.getTime() + offset * DAY * 1000)
    .toISOString()
    .slice(0, 10);

const ticket = (
  user: string,
  kind: DocumentKind,
  opts: {
    contentType?: string;
    sizeBytes?: number;
    expiresOn?: string | null;
  } = {},
) =>
  call(ctx, requestDocumentUpload, {
    user,
    body: {
      kind,
      contentType: opts.contentType ?? "application/pdf",
      sizeBytes: opts.sizeBytes ?? PDF.length,
      expiresOn:
        opts.expiresOn === undefined
          ? kind === "identity"
            ? null
            : day(200)
          : opts.expiresOn,
    },
  });

const complete = (user: string, documentId: string) =>
  call(ctx, completeDocumentUpload, {
    method: "POST",
    user,
    params: { id: documentId },
  });

async function upload(
  user: string,
  kind: DocumentKind,
  opts: {
    bytes?: Uint8Array;
    contentType?: string;
    expiresOn?: string | null;
  } = {},
) {
  const bytes = opts.bytes ?? PDF;
  const contentType = opts.contentType ?? "application/pdf";
  const res = await ticket(user, kind, {
    contentType,
    sizeBytes: bytes.length,
    expiresOn: opts.expiresOn,
  });
  expect(res.status).toBe(201);
  const t = res.json.data as DocumentUploadTicket;
  ctx.storage.upload(t.upload, bytes, contentType);
  const done = await complete(user, t.document.id);
  expect(done.status).toBe(200);
  return t;
}

const submit = (user: string) =>
  call(ctx, submitDriverApplication, { method: "POST", user });

const reopen = (user: string) =>
  call(ctx, reopenDriverApplication, { method: "POST", user });

async function profileOf(user: string) {
  return (await dashboard(ctx, user)).profile as DriverProfileView;
}

async function readyApplicant(
  user: string,
  expiries: Partial<Record<DocumentKind, string>> = {},
  displayName?: string,
) {
  const created = displayName
    ? await call(ctx, applyToDrive, {
        user,
        body: {
          displayName,
          vehicleMake: "Toyota",
          vehicleModel: "Prius",
          vehiclePlate: "SF 4821",
          vehicleSeats: 4,
          vehicleColor: "Silver",
        },
      })
    : await apply(ctx, user);
  expect(created.status).toBe(201);
  await upload(user, "identity", { bytes: JPEG, contentType: "image/jpeg" });
  await upload(user, "driving_license", {
    expiresOn: expiries.driving_license,
  });
  await upload(user, "vehicle_registration", {
    bytes: PNG,
    contentType: "image/png",
    expiresOn: expiries.vehicle_registration,
  });
  await upload(user, "insurance", { expiresOn: expiries.insurance });
  expect((await submit(user)).status).toBe(200);
  return (await profileOf(user)).id;
}

const detail = (op: string, id: string) =>
  adminGet(ctx, op, getDriverApplication, { params: { id } });

const decide = (op: string, id: string, body: object) =>
  adminPost(ctx, op, decideDriverApplication, { id }, body);

async function approveAll(op: string, id: string) {
  const d = (await detail(op, id)).json.data as AdminDriverDetail;
  const res = await decide(op, id, {
    action: "approve",
    reason: "Documents checked by eye",
    expectedVersion: d.version,
    documents: d.documents
      .filter((x) => x.status === "uploaded")
      .map((x) => ({ documentId: x.id, decision: "accept" })),
  });
  expect(res.status).toBe(200);
  return res.json.data as AdminDriverDetail;
}

const docRows = async (profileId: string) =>
  (
    await db.query<{
      id: string;
      kind: string;
      status: string;
      storage_key: string | null;
      delete_after: Date | null;
    }>(
      "SELECT id, kind, status, storage_key, delete_after FROM mobility.driver_documents WHERE driver_profile_id = $1 ORDER BY created_at",
      [profileId],
    )
  ).rows;

const verifier = (user = OPS) => makeOperator(ctx, user, "view,verify");

describe("applicant flow", () => {
  it("starts as a draft, validates vehicle details and requires every document before submitting", async () => {
    const missingColor = await call(ctx, applyToDrive, {
      user: A,
      body: {
        displayName: "Dee",
        vehicleMake: "Kia",
        vehicleModel: "Niro",
        vehiclePlate: "ABC 123",
        vehicleSeats: 4,
      },
    });
    expect(missingColor.status).toBe(400);

    const selfApprove = await call(ctx, applyToDrive, {
      user: A,
      body: {
        displayName: "Dee",
        vehicleMake: "Kia",
        vehicleModel: "Niro",
        vehiclePlate: "ABC 123",
        vehicleSeats: 4,
        vehicleColor: "Blue",
        status: "approved",
        documentsWaived: true,
      },
    });
    expect(selfApprove.status).toBe(400);

    expect((await apply(ctx, A)).status).toBe(201);
    let profile = await profileOf(A);
    expect(profile.status).toBe("draft");
    expect(profile.vehicleColor).toBe("Silver");
    expect(profile.canSubmit).toBe(false);

    const early = await submit(A);
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe("REQUIREMENTS_MISSING");

    const online = await goOnline(ctx, A);
    expect(online.status).toBe(403);
    expect(online.json.error.code).toBe("DRIVER_NOT_APPROVED");

    const noExpiry = await ticket(A, "insurance", { expiresOn: null });
    expect(noExpiry.status).toBe(400);
    expect(noExpiry.json.error.code).toBe("EXPIRY_REQUIRED");
    const expired = await ticket(A, "insurance", { expiresOn: day(-1) });
    expect(expired.json.error.code).toBe("DOCUMENT_EXPIRED");

    await upload(A, "identity", { bytes: JPEG, contentType: "image/jpeg" });
    await upload(A, "driving_license");
    await upload(A, "vehicle_registration");
    await upload(A, "insurance");
    profile = await profileOf(A);
    expect(profile.requirements.every((r) => r.met)).toBe(true);
    expect(profile.canSubmit).toBe(true);

    expect((await submit(A)).status).toBe(200);
    profile = await profileOf(A);
    expect(profile.status).toBe("submitted");
    expect(profile.canEdit).toBe(false);

    const edit = await apply(ctx, A);
    expect(edit.status).toBe(409);
    expect(edit.json.error.code).toBe("PROFILE_LOCKED");
    const lockedUpload = await ticket(A, "identity");
    expect(lockedUpload.json.error.code).toBe("PROFILE_LOCKED");
    expect((await goOnline(ctx, A)).status).toBe(403);

    const view = JSON.stringify(profile);
    expect(view).not.toContain("driver-documents/");
  });

  it("rejects files whose type, size or content don't match, and removes them from storage", async () => {
    await apply(ctx, A);
    const gif = await ticket(A, "identity", { contentType: "image/gif" });
    expect(gif.status).toBe(400);
    const huge = await ticket(A, "identity", { sizeBytes: 11 * 1024 * 1024 });
    expect(huge.status).toBe(400);

    const disguised = await ticket(A, "identity", {
      contentType: "application/pdf",
      sizeBytes: PNG.length,
    });
    const t1 = disguised.json.data as DocumentUploadTicket;
    const key1 = ctx.storage.upload(t1.upload, PNG, "application/pdf");
    const r1 = await complete(A, t1.document.id);
    expect(r1.status).toBe(422);
    expect(r1.json.error.code).toBe("FILE_REJECTED");
    expect(ctx.storage.objects.has(key1)).toBe(false);

    const wrongSize = await ticket(A, "identity", { sizeBytes: 5000 });
    const t2 = wrongSize.json.data as DocumentUploadTicket;
    const key2 = ctx.storage.upload(t2.upload, PDF, "application/pdf");
    expect((await complete(A, t2.document.id)).status).toBe(422);
    expect(ctx.storage.objects.has(key2)).toBe(false);

    const missing = await ticket(A, "identity");
    const t3 = missing.json.data as DocumentUploadTicket;
    const r3 = await complete(A, t3.document.id);
    expect(r3.status).toBe(409);
    expect(r3.json.error.code).toBe("UPLOAD_NOT_FOUND");

    const profileId = (await profileOf(A)).id;
    const rows = await docRows(profileId);
    expect(rows.filter((r) => r.status === "deleted")).toHaveLength(2);
    expect(
      rows.filter((r) => r.status === "deleted").every((r) => !r.storage_key),
    ).toBe(true);
  });

  it("replaces an earlier upload and keeps the old file only until its retention ends", async () => {
    await apply(ctx, A);
    const first = await upload(A, "identity", {
      bytes: JPEG,
      contentType: "image/jpeg",
    });
    const second = await upload(A, "identity");
    const profileId = (await profileOf(A)).id;
    const rows = await docRows(profileId);
    const old = rows.find((r) => r.id === first.document.id)!;
    expect(old.status).toBe("replaced");
    expect(old.delete_after!.getTime()).toBe(
      ctx.clock.now.getTime() + 30 * DAY * 1000,
    );
    expect(rows.find((r) => r.id === second.document.id)!.status).toBe(
      "uploaded",
    );
    const visible = (await profileOf(A)).documents.filter(
      (d) => d.kind === "identity",
    );
    expect(visible.map((d) => d.id)).toEqual([second.document.id]);

    const abandoned = await ticket(A, "insurance");
    const abandonedId = (abandoned.json.data as DocumentUploadTicket).document
      .id;

    advanceClock(ctx, 25 * 3600);
    expect(await purgeDriverDocuments(ctx.deps)).toBe(1);
    let after = await docRows(profileId);
    expect(after.find((r) => r.id === abandonedId)!.status).toBe("deleted");
    expect(after.find((r) => r.id === first.document.id)!.status).toBe(
      "replaced",
    );

    advanceClock(ctx, 30 * DAY);
    ctx.storage.down = true;
    expect(await purgeDriverDocuments(ctx.deps)).toBe(1);
    after = await docRows(profileId);
    const purged = after.find((r) => r.id === first.document.id)!;
    expect(purged.status).toBe("deleted");
    expect(purged.storage_key).toBeNull();
    expect(ctx.storage.objects.has(old.storage_key!)).toBe(true);
    const { rows: queued } = await db.query(
      "SELECT attempts, last_error FROM mobility.storage_deletions WHERE key = $1",
      [old.storage_key],
    );
    expect(queued).toEqual([
      { attempts: 1, last_error: "storage unavailable" },
    ]);
    ctx.storage.down = false;
    advanceClock(ctx, 120);
    await sweep(ctx.deps);
    expect(ctx.storage.objects.has(old.storage_key!)).toBe(false);
    expect(after.find((r) => r.id === second.document.id)!.status).toBe(
      "uploaded",
    );
    expect(ctx.storage.removed).toContain(old.storage_key);
  });

  it("says honestly when document storage isn't configured", async () => {
    const id = await readyApplicant(A);
    await verifier();
    ctx.deps.storage = null;
    const res = await ticket(A, "identity");
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("STORAGE_NOT_CONFIGURED");
    const doc = (await profileOf(A)).documents[0];
    const access = await adminPost(
      ctx,
      OPS,
      accessDriverDocument,
      { id, documentId: doc.id },
      {},
    );
    expect(access.status).toBe(503);
  });
});

describe("operator review", () => {
  it("is limited to operators with the verify permission, and denials are audited", async () => {
    const id = await readyApplicant(A);
    await makeOperator(ctx, SUPPORT, "view,support,refund");
    for (const user of [B, SUPPORT]) {
      expect((await adminGet(ctx, user, listDriverApplications)).status).toBe(
        403,
      );
      expect((await detail(user, id)).status).toBe(403);
      expect(
        (
          await decide(user, id, {
            action: "approve",
            reason: "trying",
            expectedVersion: 1,
          })
        ).status,
      ).toBe(403);
    }
    const { rows } = await db.query(
      "SELECT action, result FROM mobility.audit_log WHERE target_type = 'driver_profile' AND result = 'denied'",
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);

    await verifier();
    const list = await adminGet(ctx, OPS, listDriverApplications);
    expect(list.status).toBe(200);
    const page = list.json.data as Page<AdminDriverItem>;
    expect(page.items.map((i) => i.id)).toEqual([id]);
    const d = (await detail(OPS, id)).json.data as AdminDriverDetail;
    expect(d.account).not.toContain(A);
    expect(JSON.stringify(d)).not.toContain("driver-documents/");
  });

  it("gives short-lived, audited access to one driver's own files only", async () => {
    const idA = await readyApplicant(A);
    const idB = await readyApplicant(B);
    await verifier();
    const docA = (await profileOf(A)).documents[0];
    const docB = (await profileOf(B)).documents[0];

    const ok = await adminPost(
      ctx,
      OPS,
      accessDriverDocument,
      { id: idA, documentId: docA.id },
      {},
    );
    expect(ok.status).toBe(200);
    expect(ok.json.data.url).toContain("expires=60");
    expect(new Date(ok.json.data.expiresAt).getTime()).toBe(
      ctx.clock.now.getTime() + 60_000,
    );

    const crossed = await adminPost(
      ctx,
      OPS,
      accessDriverDocument,
      { id: idA, documentId: docB.id },
      {},
    );
    expect(crossed.status).toBe(404);

    const other = await complete(B, docA.id);
    expect(other.status).toBe(404);
    const otherTicket = await call(ctx, completeDocumentUpload, {
      method: "POST",
      user: P,
      params: { id: docB.id },
    });
    expect(otherTicket.status).toBe(404);

    const { rows } = await db.query<{ result: string; target_id: string }>(
      "SELECT result, target_id FROM mobility.audit_log WHERE action = 'driver_document_access' ORDER BY id",
    );
    expect(rows.map((r) => r.result)).toEqual(["succeeded", "failed"]);
    expect(rows.every((r) => r.target_id === idA)).toBe(true);
    expect(idB).not.toBe(idA);
  });

  it("doesn't let an operator review their own application", async () => {
    await verifier();
    await verifier(OPS2);
    const id = await readyApplicant(OPS);
    const d = (await detail(OPS, id)).json.data as AdminDriverDetail;
    expect(d.ownApplication).toBe(true);
    const res = await decide(OPS, id, {
      action: "approve",
      reason: "It's me",
      expectedVersion: d.version,
      documents: d.documents.map((x) => ({
        documentId: x.id,
        decision: "accept",
      })),
    });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("CANNOT_REVIEW_OWN_APPLICATION");
    expect((await profileOf(OPS)).status).toBe("submitted");
    await approveAll(OPS2, id);
    expect((await profileOf(OPS)).status).toBe("approved");
  });

  it("requests specific changes, and the applicant sees the message and the rejected document", async () => {
    const id = await readyApplicant(A);
    await verifier();
    const d = (await detail(OPS, id)).json.data as AdminDriverDetail;
    const insurance = d.documents.find((x) => x.kind === "insurance")!;
    const missingNote = await decide(OPS, id, {
      action: "request_changes",
      reason: "Insurance unreadable",
      applicantMessage: "Please upload a clearer insurance certificate.",
      expectedVersion: d.version,
      documents: [{ documentId: insurance.id, decision: "reject" }],
    });
    expect(missingNote.status).toBe(400);
    const res = await decide(OPS, id, {
      action: "request_changes",
      reason: "Insurance unreadable",
      applicantMessage: "Please upload a clearer insurance certificate.",
      expectedVersion: d.version,
      documents: [
        {
          documentId: insurance.id,
          decision: "reject",
          note: "The policy number is cut off.",
        },
      ],
    });
    expect(res.status).toBe(200);
    const profile = await profileOf(A);
    expect(profile.status).toBe("changes_requested");
    expect(profile.applicantMessage).toContain("clearer insurance");
    const rejected = profile.documents.find((x) => x.id === insurance.id)!;
    expect(rejected.status).toBe("rejected");
    expect(rejected.reviewNote).toBe("The policy number is cut off.");
    expect(profile.canSubmit).toBe(false);

    const replacement = await upload(A, "insurance");
    expect((await submit(A)).status).toBe(200);
    const rows = await docRows(id);
    expect(rows.find((r) => r.id === insurance.id)!.status).toBe("replaced");
    const next = await approveAll(OPS, id);
    expect(next.status).toBe("approved");
    expect(
      next.documents.find((x) => x.id === replacement.document.id)!.status,
    ).toBe("accepted");

    const history = next.history.map((h) => h.action);
    expect(history).toEqual(
      expect.arrayContaining([
        "request_changes",
        "document_rejected",
        "approve",
      ]),
    );
  });

  it("refuses to approve until every document is accepted", async () => {
    const id = await readyApplicant(A);
    await verifier();
    const d = (await detail(OPS, id)).json.data as AdminDriverDetail;
    const res = await decide(OPS, id, {
      action: "approve",
      reason: "Looks fine",
      expectedVersion: d.version,
      documents: d.documents
        .filter((x) => x.kind !== "insurance")
        .map((x) => ({ documentId: x.id, decision: "accept" })),
    });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("REQUIREMENTS_MISSING");
    expect((await profileOf(A)).status).toBe("submitted");
    const rows = await docRows(id);
    expect(rows.every((r) => r.status === "uploaded")).toBe(true);
  });

  it("lets only one of two concurrent decisions win", async () => {
    const id = await readyApplicant(A);
    await verifier();
    await verifier(OPS2);
    const d = (await detail(OPS, id)).json.data as AdminDriverDetail;
    const [x, y] = await Promise.all([
      decide(OPS, id, {
        action: "approve",
        reason: "All good",
        expectedVersion: d.version,
        documents: d.documents.map((doc) => ({
          documentId: doc.id,
          decision: "accept",
        })),
      }),
      decide(OPS2, id, {
        action: "reject",
        reason: "Different view",
        applicantMessage: "We can't approve this application.",
        expectedVersion: d.version,
      }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const loser = x.status === 409 ? x : y;
    expect(loser.json.error.code).toBe("VERSION_CONFLICT");
    const { rows } = await db.query(
      "SELECT action FROM mobility.driver_review_events WHERE driver_profile_id = $1 AND action IN ('approve', 'reject')",
      [id],
    );
    expect(rows).toHaveLength(1);
  });

  it("rejects with a recorded reason, schedules document deletion and allows a fresh application", async () => {
    const id = await readyApplicant(A);
    await verifier();
    const d = (await detail(OPS, id)).json.data as AdminDriverDetail;
    const res = await decide(OPS, id, {
      action: "reject",
      reason: "Vehicle does not match the registration",
      applicantMessage: "The registration is for a different vehicle.",
      expectedVersion: d.version,
    });
    expect(res.status).toBe(200);
    const rows = await docRows(id);
    expect(
      rows.every(
        (r) =>
          r.delete_after?.getTime() ===
          ctx.clock.now.getTime() + 90 * DAY * 1000,
      ),
    ).toBe(true);
    const { rows: audit } = await db.query(
      "SELECT reason, result FROM mobility.audit_log WHERE action = 'driver_reject'",
    );
    expect(audit).toEqual([
      {
        reason: "Vehicle does not match the registration",
        result: "succeeded",
      },
    ]);
    const profile = await profileOf(A);
    expect(profile.status).toBe("rejected");
    expect(profile.canReopen).toBe(true);
    expect((await reopen(A)).status).toBe(200);
    expect((await profileOf(A)).status).toBe("draft");
    expect((await docRows(id)).every((r) => r.delete_after === null)).toBe(
      true,
    );
  });
});

describe("eligibility", () => {
  it("expires approval when a document expires, and the sweep takes the driver offline", async () => {
    const id = await readyApplicant(A, { driving_license: day(10) });
    await verifier();
    const approved = await approveAll(OPS, id);
    expect(approved.approvalExpiresAt).toBe(`${day(11)}T00:00:00.000Z`);
    expect((await goOnline(ctx, A)).status).toBe(200);

    advanceClock(ctx, 12 * DAY);
    const profile = await profileOf(A);
    expect(profile.eligible).toBe(false);
    expect(profile.online).toBe(false);

    await requestRide(ctx, P);
    const dash = await dashboard(ctx, A);
    expect(dash.offer).toBeNull();
    const again = await goOnline(ctx, A);
    expect(again.status).toBe(403);
    expect(again.json.error.code).toBe("DRIVER_APPROVAL_EXPIRED");
    expect((await postLocation(ctx, A, fix(100))).status).toBe(403);
  });

  it("sweeps an online driver whose approval lapsed without waiting for a heartbeat", async () => {
    const id = await readyApplicant(A, { insurance: day(3) });
    await verifier();
    await approveAll(OPS, id);
    expect((await goOnline(ctx, A)).status).toBe(200);
    advanceClock(ctx, 5 * DAY);
    await sweep(ctx.deps);
    const { rows } = await db.query(
      "SELECT online, latitude FROM mobility.driver_profiles WHERE id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ online: false, latitude: null });
  });

  it("re-matches the passenger when the driver is suspended before pickup", async () => {
    await onlineDriver(ctx, A, 300);
    const { rideId } = await requestRide(ctx, P);
    await registerDevice(ctx, P, "ExponentPushToken[passenger]");
    await assign(ctx, A, rideId);
    await onlineDriver(ctx, B, 900);
    await verifier();
    const profileId = (await profileOf(A)).id;
    const d = (await detail(OPS, profileId)).json.data as AdminDriverDetail;
    expect(d.activeRide?.id).toBe(rideId);
    const res = await decide(OPS, profileId, {
      action: "suspend",
      reason: "Safety concern under investigation",
      applicantMessage: "Your account is suspended while we review a report.",
      expectedVersion: d.version,
    });
    expect(res.status).toBe(200);

    const { rows } = await db.query(
      "SELECT status, driver_profile_id, rematch_count, needs_review, review_reason FROM mobility.rides WHERE id = $1",
      [rideId],
    );
    expect(["requested", "offered"]).toContain(rows[0].status);
    expect(rows[0].driver_profile_id).toBeNull();
    expect(rows[0].rematch_count).toBe(1);
    expect(rows[0].needs_review).toBe(true);
    expect(rows[0].review_reason).toBe("driver_ineligible_during_trip");
    expect(
      ctx.push.sent.some((m) =>
        String(m.body).includes("Your driver can't complete this ride"),
      ),
    ).toBe(true);

    const suspended = await profileOf(A);
    expect(suspended.status).toBe("suspended");
    expect(suspended.online).toBe(false);
    expect((await goOnline(ctx, A)).status).toBe(403);
    await sweep(ctx.deps);
    expect((await dashboard(ctx, B)).offer?.rideId).toBe(rideId);
  });

  it("lets a suspended driver finish a trip already under way and flags it for operators", async () => {
    await onlineDriver(ctx, A, 300);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    await drive(ctx, A, rideId, "in_progress");
    await verifier();
    const profileId = (await profileOf(A)).id;
    const d = (await detail(OPS, profileId)).json.data as AdminDriverDetail;
    expect(
      (
        await decide(OPS, profileId, {
          action: "suspend",
          reason: "Document fraud suspected",
          applicantMessage: "Your account is suspended pending review.",
          expectedVersion: d.version,
        })
      ).status,
    ).toBe(200);

    const { rows } = await db.query(
      "SELECT status, needs_review, review_reason FROM mobility.rides WHERE id = $1",
      [rideId],
    );
    expect(rows[0]).toEqual({
      status: "in_progress",
      needs_review: true,
      review_reason: "driver_ineligible_during_trip",
    });
    const loc = await postLocation(ctx, A, fix(50, { at: ctx.clock.now }));
    expect(loc.status).toBe(200);
    expect(loc.json.data.sharing).toBe(true);
    await sweep(ctx.deps);
    expect((await setStatus(ctx, A, rideId, "completed")).status).toBe(200);
    await sweep(ctx.deps);
    const after = await profileOf(A);
    expect(after.online).toBe(false);
    expect((await postLocation(ctx, A, fix(50))).status).toBe(403);
    expect(
      (
        await call(ctx, setAvailability, {
          user: A,
          body: { online: false },
        })
      ).status,
    ).toBe(200);
  });

  it("reinstates a suspended driver only with a recorded reason", async () => {
    const id = await readyApplicant(A);
    await verifier();
    const approved = await approveAll(OPS, id);
    const s = await decide(OPS, id, {
      action: "suspend",
      reason: "Complaint review",
      applicantMessage: "Suspended while we review a complaint.",
      expectedVersion: approved.version,
    });
    const suspended = s.json.data as AdminDriverDetail;
    const noReason = await decide(OPS, id, {
      action: "reinstate",
      reason: "",
      expectedVersion: suspended.version,
    });
    expect(noReason.status).toBe(400);
    const back = await decide(OPS, id, {
      action: "reinstate",
      reason: "Complaint not upheld",
      expectedVersion: suspended.version,
    });
    expect(back.status).toBe(200);
    expect((await profileOf(A)).eligible).toBe(true);
  });

  it("requires going offline before an approved driver reopens their application", async () => {
    await onlineDriver(ctx, A);
    const res = await reopen(A);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("GO_OFFLINE_FIRST");
    await call(ctx, setAvailability, { user: A, body: { online: false } });
    expect((await reopen(A)).status).toBe(200);
    const profile = await profileOf(A);
    expect(profile.status).toBe("draft");
    expect(profile.documentsWaived).toBe(false);
    expect((await goOnline(ctx, A)).status).toBe(403);
  });
});

describe("passenger privacy", () => {
  it("shows the passenger only the vehicle details needed to find the car", async () => {
    const id = await readyApplicant(A, {}, "Dee");
    await verifier();
    await approveAll(OPS, id);
    expect((await goOnline(ctx, A, 300)).status).toBe(200);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    const res = await viewRide(ctx, P, rideId);
    const view = res.json.data as RideView;
    expect(view.driver).toEqual({
      name: "Dee",
      vehicle: "Toyota Prius",
      color: "Silver",
      plate: "SF 4821",
      seats: 4,
    });
    const body = JSON.stringify(res.json);
    for (const secret of [
      "driver-documents/",
      "Documents checked by eye",
      "driving_license",
      "expiresOn",
      "user_driver",
    ]) {
      expect(body).not.toContain(secret);
    }
  });
});

describe("CLI recovery tool", () => {
  it("only approves with an explicit, audited document waiver", async () => {
    await apply(ctx, A);
    await expect(
      admin.setDriverStatus(ctx.db, A, "approved", { reason: "local dev" }),
    ).rejects.toThrow(/waive-documents/);
    await expect(
      admin.setDriverStatus(ctx.db, A, "approved", { waiveDocuments: true }),
    ).rejects.toThrow(/reason/);
    const row = await admin.setDriverStatus(ctx.db, A, "approved", {
      waiveDocuments: true,
      reason: "local dev",
    });
    await admin.auditDriverStatus(
      ctx.db,
      "tester",
      row.id,
      row.status,
      "local dev",
    );
    const profile = await profileOf(A);
    expect(profile.documentsWaived).toBe(true);
    expect(profile.eligible).toBe(true);
    const { rows } = await db.query(
      "SELECT actor, action FROM mobility.driver_review_events WHERE driver_profile_id = $1 AND actor = 'cli'",
      [row.id],
    );
    expect(rows).toEqual([{ actor: "cli", action: "approved_with_waiver" }]);
    await verifier();
    const d = (await detail(OPS, row.id)).json.data as AdminDriverDetail;
    expect(d.waiverNote).toContain("CLI override");
  });

  it("won't suspend a driver mid-ride from the CLI", async () => {
    await onlineDriver(ctx, A, 300);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    await expect(
      admin.setDriverStatus(ctx.db, A, "suspended", { reason: "test" }),
    ).rejects.toThrow(/active ride/);
  });
});

describe("storage signing", () => {
  it("matches the AWS Signature Version 4 presigned URL example", () => {
    const signed = presignS3(
      {
        bucket: "examplebucket",
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        endpoint: null,
        forcePathStyle: false,
      },
      {
        method: "GET",
        key: "test.txt",
        expiresSeconds: 86400,
        now: new Date("2013-05-24T00:00:00Z"),
      },
    );
    expect(signed.url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("signs the content type and length of an upload", () => {
    const signed = presignS3(
      {
        bucket: "docs",
        region: "auto",
        accessKeyId: "key",
        secretAccessKey: "secret",
        endpoint: "https://account.r2.cloudflarestorage.com",
        forcePathStyle: true,
      },
      {
        method: "PUT",
        key: "driver-documents/p/1",
        expiresSeconds: 300,
        now: new Date("2026-01-01T00:00:00Z"),
        headers: { "content-type": "application/pdf", "content-length": "400" },
      },
    );
    expect(
      signed.url.startsWith(
        "https://account.r2.cloudflarestorage.com/docs/driver-documents/p/1?",
      ),
    ).toBe(true);
    expect(signed.url).toContain(
      "X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost",
    );
    expect(signed.headers).toEqual({
      "content-type": "application/pdf",
      "content-length": "400",
    });
  });
});
