import { randomUUID } from "node:crypto";

import {
  type AdminDriverDetail,
  type AdminDriverItem,
  type DocumentKind,
  documentKinds,
  type DocumentStatus,
  type DocumentUploadTicket,
  type DriverApplicationStatus,
  type DriverDocumentView,
  type DriverProfileView,
  type RatingSummary,
  type RequirementView,
  type RideStatus,
  VERIFICATION_RULES,
} from "../shared/contracts";

import { removeDriverForRematch } from "./cancellation";
import { type Database, type SqlClient, transaction } from "./db";
import { eligibleDriverSql } from "./eligibility";
import { ApiError, notFound } from "./errors";
import { ASSIGNED_STATUSES, lockRide, PRE_PICKUP_STATUSES } from "./lifecycle";
import { clearDriverLocation } from "./location";
import {
  deliverPending,
  enqueueNotification,
  type PushGateway,
} from "./notifications";
import { NOTIFY } from "./notificationText";
import { audit, type OperatorRow } from "./operators";
import { flagRideReview } from "./review";
import { type DocumentStorage, matchesSignature } from "./storage";

const DAY_MS = 24 * 3600 * 1000;
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
const maskAccount = (clerkId: string) => `user_…${clerkId.slice(-4)}`;

export interface ProfileRow {
  id: string;
  user_id: string;
  status: DriverApplicationStatus;
  display_name: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_plate: string;
  vehicle_seats: number;
  vehicle_color: string | null;
  vehicle_year: number | null;
  online: boolean;
  review_version: number;
  submitted_at: Date | null;
  approved_at: Date | null;
  approval_expires_at: Date | null;
  rejected_at: Date | null;
  applicant_message: string | null;
  documents_waived: boolean;
  waiver_note: string | null;
  updated_at: Date;
}

export interface DocumentRow {
  id: string;
  driver_profile_id: string;
  kind: DocumentKind;
  status: DocumentStatus;
  storage_key: string | null;
  upload_key: string | null;
  upload_expires_at: Date | null;
  etag: string | null;
  content_type: string;
  size_bytes: number;
  expires_on: string | Date | null;
  uploaded_at: Date | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  delete_after: Date | null;
  created_at: Date;
}

const KIND_LABEL: Record<DocumentKind, string> = {
  identity: "Proof of identity",
  driving_license: "Driving licence",
  vehicle_registration: "Vehicle registration",
  insurance: "Vehicle insurance",
};

const dayOf = (value: string | Date | null) =>
  value === null
    ? null
    : typeof value === "string"
      ? value.slice(0, 10)
      : [
          value.getFullYear(),
          String(value.getMonth() + 1).padStart(2, "0"),
          String(value.getDate()).padStart(2, "0"),
        ].join("-");

const today = (now: Date) => now.toISOString().slice(0, 10);

export const documentExpired = (doc: DocumentRow, now: Date) => {
  const day = dayOf(doc.expires_on);
  return day !== null && day < today(now);
};

export function driverEligibility(
  profile: Pick<ProfileRow, "status" | "approval_expires_at">,
  now: Date,
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const messages: Record<DriverApplicationStatus, string | null> = {
    draft: "Finish and submit your application.",
    submitted: "Your application is waiting for review.",
    changes_requested:
      "Your application needs changes before it can be reviewed again.",
    approved: null,
    rejected: "Your application was not approved.",
    suspended: "Your driver account is suspended.",
  };
  const status = messages[profile.status];
  if (status) reasons.push(status);
  if (
    profile.status === "approved" &&
    profile.approval_expires_at &&
    new Date(profile.approval_expires_at).getTime() <= now.getTime()
  ) {
    reasons.push(
      "One of your documents has expired. Upload a renewed document to drive again.",
    );
  }
  return { eligible: reasons.length === 0, reasons };
}

const usable = (doc: DocumentRow, now: Date) =>
  (doc.status === "uploaded" || doc.status === "accepted") &&
  !documentExpired(doc, now) &&
  (!VERIFICATION_RULES.expiryRequired.includes(doc.kind) ||
    doc.expires_on !== null);

export function requirementsFor(
  profile: ProfileRow,
  docs: DocumentRow[],
  now: Date,
): RequirementView[] {
  const vehicle = Boolean(
    profile.vehicle_make &&
    profile.vehicle_model &&
    profile.vehicle_plate &&
    profile.vehicle_color,
  );
  return [
    {
      key: "vehicle",
      label: "Vehicle make, model, color and plate",
      met: vehicle,
    },
    ...documentKinds.map((kind) => ({
      key: kind,
      label: KIND_LABEL[kind],
      met:
        profile.documents_waived ||
        docs.some((d) => d.kind === kind && usable(d, now)),
    })),
  ];
}

const docView = (d: DocumentRow): DriverDocumentView => ({
  id: d.id,
  kind: d.kind,
  status: d.status,
  contentType: d.content_type,
  sizeBytes: d.size_bytes,
  expiresOn: dayOf(d.expires_on),
  uploadedAt: iso(d.uploaded_at),
  reviewNote:
    d.status === "rejected" || d.status === "deleted" ? d.review_note : null,
});

const VISIBLE: DocumentStatus[] = [
  "pending_upload",
  "uploaded",
  "accepted",
  "rejected",
];

export async function profileDocuments(db: SqlClient, profileId: string) {
  const { rows } = await db.query<DocumentRow>(
    "SELECT * FROM mobility.driver_documents WHERE driver_profile_id = $1 ORDER BY created_at",
    [profileId],
  );
  return rows;
}

export function applicantView(
  profile: ProfileRow,
  docs: DocumentRow[],
  rating: RatingSummary,
  now: Date,
): DriverProfileView {
  const requirements = requirementsFor(profile, docs, now);
  const { eligible, reasons } = driverEligibility(profile, now);
  const editable =
    profile.status === "draft" || profile.status === "changes_requested";
  return {
    id: profile.id,
    status: profile.status,
    displayName: profile.display_name,
    vehicleMake: profile.vehicle_make,
    vehicleModel: profile.vehicle_model,
    vehiclePlate: profile.vehicle_plate,
    vehicleSeats: profile.vehicle_seats,
    vehicleColor: profile.vehicle_color,
    vehicleYear: profile.vehicle_year,
    online: profile.online,
    rating,
    applicantMessage: profile.applicant_message,
    approvalExpiresAt: iso(profile.approval_expires_at),
    documentsWaived: profile.documents_waived,
    documents: docs.filter((d) => VISIBLE.includes(d.status)).map(docView),
    requirements,
    eligible,
    ineligibleReasons: reasons,
    canEdit: editable,
    canSubmit: editable && requirements.every((r) => r.met),
    canReopen: profile.status === "approved" || profile.status === "rejected",
  };
}

async function event(
  tx: SqlClient,
  e: {
    profileId: string;
    actor: "applicant" | "operator" | "system" | "cli";
    operatorId?: string | null;
    action: string;
    from?: string | null;
    to?: string | null;
    reason?: string | null;
    applicantMessage?: string | null;
    documentId?: string | null;
    now: Date;
  },
) {
  await tx.query(
    `INSERT INTO mobility.driver_review_events
       (driver_profile_id, actor, operator_id, action, from_status, to_status,
        reason, applicant_message, document_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      e.profileId,
      e.actor,
      e.operatorId ?? null,
      e.action,
      e.from ?? null,
      e.to ?? null,
      e.reason ?? null,
      e.applicantMessage ?? null,
      e.documentId ?? null,
      e.now,
    ],
  );
}

async function lockProfileByUser(tx: SqlClient, userId: string) {
  const { rows } = await tx.query<ProfileRow>(
    "SELECT * FROM mobility.driver_profiles WHERE user_id = $1 FOR UPDATE",
    [userId],
  );
  return rows[0] ?? null;
}

export async function saveApplication(
  deps: { db: Database; now: () => Date },
  userId: string,
  input: {
    displayName: string;
    vehicleMake: string;
    vehicleModel: string;
    vehiclePlate: string;
    vehicleSeats: number;
    vehicleColor: string;
    vehicleYear?: number | null;
  },
): Promise<{ created: boolean }> {
  const now = deps.now();
  return transaction(deps.db, async (tx) => {
    const existing = await lockProfileByUser(tx, userId);
    const values = [
      input.displayName,
      input.vehicleMake,
      input.vehicleModel,
      input.vehiclePlate.toUpperCase(),
      input.vehicleSeats,
      input.vehicleColor,
      input.vehicleYear ?? null,
    ];
    if (!existing) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO mobility.driver_profiles
           (user_id, display_name, vehicle_make, vehicle_model, vehicle_plate,
            vehicle_seats, vehicle_color, vehicle_year, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft') RETURNING id`,
        [userId, ...values],
      );
      await event(tx, {
        profileId: rows[0].id,
        actor: "applicant",
        action: "created",
        to: "draft",
        now,
      });
      return { created: true };
    }
    if (
      existing.status !== "draft" &&
      existing.status !== "changes_requested"
    ) {
      throw new ApiError(
        409,
        "PROFILE_LOCKED",
        existing.status === "approved" || existing.status === "rejected"
          ? "Start an update to change your details; it will be reviewed again."
          : "Your application can't be edited right now.",
      );
    }
    await tx.query(
      `UPDATE mobility.driver_profiles
          SET display_name = $2, vehicle_make = $3, vehicle_model = $4, vehicle_plate = $5,
              vehicle_seats = $6, vehicle_color = $7, vehicle_year = $8,
              review_version = review_version + 1, updated_at = now()
        WHERE id = $1`,
      [existing.id, ...values],
    );
    return { created: false };
  });
}

export async function submitApplication(
  deps: { db: Database; now: () => Date },
  userId: string,
) {
  const now = deps.now();
  await transaction(deps.db, async (tx) => {
    const profile = await lockProfileByUser(tx, userId);
    if (!profile)
      throw new ApiError(403, "NOT_A_DRIVER", "Start an application first.");
    if (profile.status !== "draft" && profile.status !== "changes_requested") {
      throw new ApiError(
        409,
        "INVALID_TRANSITION",
        "This application can't be submitted now.",
      );
    }
    const missing = requirementsFor(
      profile,
      await profileDocuments(tx, profile.id),
      now,
    )
      .filter((r) => !r.met)
      .map((r) => r.label);
    if (missing.length) {
      throw new ApiError(
        409,
        "REQUIREMENTS_MISSING",
        `Still needed: ${missing.join(", ")}.`,
      );
    }
    await tx.query(
      `UPDATE mobility.driver_profiles
          SET status = 'submitted', submitted_at = $2, applicant_message = NULL,
              review_version = review_version + 1, updated_at = now()
        WHERE id = $1`,
      [profile.id, now],
    );
    await event(tx, {
      profileId: profile.id,
      actor: "applicant",
      action: "submitted",
      from: profile.status,
      to: "submitted",
      now,
    });
  });
}

export async function reopenApplication(
  deps: { db: Database; now: () => Date },
  userId: string,
) {
  const now = deps.now();
  await transaction(deps.db, async (tx) => {
    const profile = await lockProfileByUser(tx, userId);
    if (!profile)
      throw new ApiError(403, "NOT_A_DRIVER", "Start an application first.");
    if (profile.status !== "approved" && profile.status !== "rejected") {
      throw new ApiError(409, "INVALID_TRANSITION", "Nothing to reopen.");
    }
    if (profile.status === "approved") {
      const busy = await tx.query(
        "SELECT 1 FROM mobility.rides WHERE driver_profile_id = $1 AND status = ANY($2::text[])",
        [profile.id, ASSIGNED_STATUSES],
      );
      if (profile.online || busy.rows.length) {
        throw new ApiError(
          409,
          "GO_OFFLINE_FIRST",
          "Go offline and finish any ride before updating your details.",
        );
      }
    }
    await tx.query(
      `UPDATE mobility.driver_profiles
          SET status = 'draft', approved_at = NULL, approved_by = NULL,
              approval_expires_at = NULL, rejected_at = NULL, applicant_message = NULL,
              documents_waived = false, waiver_note = NULL,
              review_version = review_version + 1, updated_at = now()
        WHERE id = $1`,
      [profile.id],
    );
    await tx.query(
      `UPDATE mobility.driver_documents SET delete_after = NULL, updated_at = $2
        WHERE driver_profile_id = $1 AND status IN ('uploaded', 'accepted', 'rejected')`,
      [profile.id, now],
    );
    await event(tx, {
      profileId: profile.id,
      actor: "applicant",
      action: "reopened",
      from: profile.status,
      to: "draft",
      now,
    });
  });
}

const requireStorage = (storage: DocumentStorage | null) => {
  if (!storage) {
    throw new ApiError(
      503,
      "STORAGE_NOT_CONFIGURED",
      "Document uploads aren't configured on this server yet.",
    );
  }
  return storage;
};

const secondsAfter = (d: Date, seconds: number) =>
  new Date(d.getTime() + seconds * 1000);

async function scheduleDeletion(
  db: SqlClient,
  key: string,
  notBefore: Date,
  now: Date,
) {
  await db.query(
    `INSERT INTO mobility.storage_deletions (key, not_before, created_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET not_before = LEAST(storage_deletions.not_before, EXCLUDED.not_before)`,
    [key, notBefore, now],
  );
}

export async function requestUpload(
  deps: { db: Database; storage: DocumentStorage | null; now: () => Date },
  userId: string,
  input: {
    kind: DocumentKind;
    contentType: string;
    sizeBytes: number;
    expiresOn?: string | null;
  },
): Promise<DocumentUploadTicket> {
  const storage = requireStorage(deps.storage);
  const now = deps.now();
  const expiresOn = input.expiresOn ?? null;
  if (VERIFICATION_RULES.expiryRequired.includes(input.kind) && !expiresOn) {
    throw new ApiError(
      400,
      "EXPIRY_REQUIRED",
      "Enter the expiry date shown on the document.",
    );
  }
  if (expiresOn && expiresOn < today(now)) {
    throw new ApiError(
      400,
      "DOCUMENT_EXPIRED",
      "This document has already expired.",
    );
  }
  const uploadExpiresAt = secondsAfter(
    now,
    VERIFICATION_RULES.uploadUrlSeconds,
  );
  const doc = await transaction(deps.db, async (tx) => {
    const profile = await lockProfileByUser(tx, userId);
    if (!profile)
      throw new ApiError(403, "NOT_A_DRIVER", "Start an application first.");
    if (
      !["draft", "changes_requested", "approved", "suspended"].includes(
        profile.status,
      )
    ) {
      throw new ApiError(
        409,
        "PROFILE_LOCKED",
        "Documents can't be changed while your application is in review.",
      );
    }
    await tx.query(
      `UPDATE mobility.driver_documents
          SET status = 'deleted', deleted_at = $3, updated_at = $3
        WHERE driver_profile_id = $1 AND kind = $2 AND status = 'pending_upload'`,
      [profile.id, input.kind, now],
    );
    await tx.query(
      `UPDATE mobility.driver_documents
          SET status = 'replaced', updated_at = $3,
              delete_after = $3::timestamptz + make_interval(days => $4)
        WHERE driver_profile_id = $1 AND kind = $2
          AND status IN ('uploaded', 'rejected')`,
      [profile.id, input.kind, now, VERIFICATION_RULES.replacedRetentionDays],
    );
    const uploadKey = `driver-documents/uploads/${profile.id}/${randomUUID()}`;
    const { rows } = await tx.query<DocumentRow>(
      `INSERT INTO mobility.driver_documents
         (driver_profile_id, kind, upload_key, upload_expires_at, content_type,
          size_bytes, expires_on, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING *`,
      [
        profile.id,
        input.kind,
        uploadKey,
        uploadExpiresAt,
        input.contentType,
        input.sizeBytes,
        expiresOn,
        now,
      ],
    );
    await scheduleDeletion(
      tx,
      uploadKey,
      secondsAfter(uploadExpiresAt, VERIFICATION_RULES.uploadKeyGraceSeconds),
      now,
    );
    return rows[0];
  });
  const target = storage.presignUpload(
    doc.upload_key!,
    doc.content_type,
    doc.size_bytes,
    VERIFICATION_RULES.uploadUrlSeconds,
    now,
  );
  return {
    document: docView(doc),
    upload:
      target.method === "POST"
        ? {
            method: "POST",
            url: target.url,
            fields: target.fields,
            expiresAt: target.expiresAt.toISOString(),
          }
        : {
            method: "PUT",
            url: target.url,
            headers: target.headers,
            expiresAt: target.expiresAt.toISOString(),
          },
  };
}

const REJECTED_NOTE =
  "The file was not a readable JPEG, PNG or PDF of the declared size.";

export async function completeUpload(
  deps: { db: Database; storage: DocumentStorage | null; now: () => Date },
  userId: string,
  documentId: string,
): Promise<DriverDocumentView> {
  const storage = requireStorage(deps.storage);
  const now = deps.now();
  const { rows } = await deps.db.query<DocumentRow>(
    `SELECT d.* FROM mobility.driver_documents d
       JOIN mobility.driver_profiles dp ON dp.id = d.driver_profile_id
      WHERE d.id = $1 AND dp.user_id = $2`,
    [documentId, userId],
  );
  const doc = rows[0];
  if (!doc) throw notFound("Document");
  if (doc.status !== "pending_upload") {
    if (doc.status === "uploaded" || doc.status === "accepted")
      return docView(doc);
    throw new ApiError(
      409,
      "UPLOAD_CLOSED",
      "Start a new upload for this document.",
    );
  }
  const uploadKey = doc.upload_key!;
  const changed = () =>
    new ApiError(
      409,
      "UPLOAD_CHANGED",
      "The file changed while we were checking it. Upload it again.",
    );
  const reject = async () => {
    await deps.db.query(
      `UPDATE mobility.driver_documents
          SET status = 'deleted', deleted_at = $2, updated_at = $2, review_note = $3
        WHERE id = $1 AND status = 'pending_upload'`,
      [doc.id, now, REJECTED_NOTE],
    );
    await storage.remove(uploadKey, now).catch(() => undefined);
    return new ApiError(
      422,
      "FILE_REJECTED",
      "That file isn't a readable JPEG, PNG or PDF of the expected size. Upload it again.",
    );
  };
  const matches = (o: { size: number; contentType: string | null }) =>
    o.size === doc.size_bytes &&
    o.size <= VERIFICATION_RULES.maxBytes &&
    (o.contentType ?? "").split(";")[0].trim() === doc.content_type;

  const stored = await storage.head(uploadKey, now);
  if (!stored) {
    throw new ApiError(
      409,
      "UPLOAD_NOT_FOUND",
      "We didn't receive the file. Try uploading it again.",
    );
  }
  if (!stored.etag) throw changed();
  if (!matches(stored)) throw await reject();
  const start = await storage.readStart(uploadKey, 8, stored.etag, now);
  if (!start) throw changed();
  if (!matchesSignature(doc.content_type, start)) throw await reject();

  const finalKey = `driver-documents/files/${doc.driver_profile_id}/${randomUUID()}`;
  await scheduleDeletion(
    deps.db,
    finalKey,
    secondsAfter(now, VERIFICATION_RULES.finalKeyReservationSeconds),
    now,
  );
  if (!(await storage.copy(uploadKey, finalKey, stored.etag, now))) {
    throw changed();
  }
  const copied = await storage.head(finalKey, now);
  if (!copied || !matches(copied)) throw changed();

  const updated = await transaction(deps.db, async (tx) => {
    const reservation = await tx.query(
      "DELETE FROM mobility.storage_deletions WHERE key = $1 RETURNING key",
      [finalKey],
    );
    if (!reservation.rows.length) return null;
    const { rows: done } = await tx.query<DocumentRow>(
      `UPDATE mobility.driver_documents
          SET status = 'uploaded', storage_key = $2, etag = $3,
              uploaded_at = $4, updated_at = $4
        WHERE id = $1 AND status = 'pending_upload' RETURNING *`,
      [doc.id, finalKey, copied.etag, now],
    );
    if (!done[0]) {
      await scheduleDeletion(tx, finalKey, now, now);
      return null;
    }
    await event(tx, {
      profileId: doc.driver_profile_id,
      actor: "applicant",
      action: "document_uploaded",
      documentId: doc.id,
      now,
    });
    return done[0];
  });
  await storage.remove(uploadKey, now).catch(() => undefined);
  if (!updated) {
    throw new ApiError(
      409,
      "UPLOAD_CLOSED",
      "This upload was replaced or expired. Start a new upload for this document.",
    );
  }
  return docView(updated);
}

const ADMIN_SQL = `
  SELECT dp.*, u.clerk_id,
         (SELECT count(*)::int FROM mobility.driver_documents d
           WHERE d.driver_profile_id = dp.id AND d.status = 'uploaded') AS pending_documents
    FROM mobility.driver_profiles dp
    JOIN mobility.users u ON u.id = dp.user_id`;

type AdminProfileRow = ProfileRow & {
  clerk_id: string;
  pending_documents: number;
};

const adminItem = (p: AdminProfileRow, now: Date): AdminDriverItem => ({
  id: p.id,
  displayName: p.display_name,
  status: p.status,
  vehicle: `${p.vehicle_color ? `${p.vehicle_color} ` : ""}${p.vehicle_make} ${p.vehicle_model}`,
  plate: p.vehicle_plate,
  submittedAt: iso(p.submitted_at),
  approvalExpiresAt: iso(p.approval_expires_at),
  documentsWaived: p.documents_waived,
  version: p.review_version,
  eligible: driverEligibility(p, now).eligible,
  updatedAt: iso(p.updated_at)!,
});

export async function listApplications(
  db: SqlClient,
  q: {
    status: DriverApplicationStatus | "all" | "needs_review";
    cursor: [string, string] | null;
    limit: number;
  },
  now: Date,
) {
  const { rows } = await db.query<AdminProfileRow>(
    `${ADMIN_SQL}
      WHERE ($1::text = 'all'
             OR ($1::text = 'needs_review' AND (dp.status = 'submitted'
                 OR (dp.status IN ('approved', 'suspended') AND EXISTS (
                      SELECT 1 FROM mobility.driver_documents d
                       WHERE d.driver_profile_id = dp.id AND d.status = 'uploaded'))))
             OR dp.status = $1::text)
        AND ($2::timestamptz IS NULL OR (dp.updated_at, dp.id) < ($2::timestamptz, $3::uuid))
      ORDER BY dp.updated_at DESC, dp.id DESC
      LIMIT $4`,
    [q.status, q.cursor?.[0] ?? null, q.cursor?.[1] ?? null, q.limit + 1],
  );
  return rows.map((row) => ({ row, item: adminItem(row, now) }));
}

async function loadAdminProfile(db: SqlClient, profileId: string) {
  const { rows } = await db.query<AdminProfileRow>(
    `${ADMIN_SQL} WHERE dp.id = $1`,
    [profileId],
  );
  if (!rows[0]) throw notFound("Driver");
  return rows[0];
}

export async function applicationDetail(
  db: SqlClient,
  profileId: string,
  operator: OperatorRow,
  now: Date,
): Promise<AdminDriverDetail> {
  const p = await loadAdminProfile(db, profileId);
  const docs = await profileDocuments(db, profileId);
  const [ride, history, reviewers] = await Promise.all([
    db.query<{ id: string; status: RideStatus }>(
      `SELECT id, status FROM mobility.rides
        WHERE driver_profile_id = $1 AND status = ANY($2::text[]) LIMIT 1`,
      [profileId, ASSIGNED_STATUSES],
    ),
    db.query<{
      action: string;
      actor: string;
      operator: string | null;
      from_status: string | null;
      to_status: string | null;
      reason: string | null;
      applicant_message: string | null;
      created_at: Date;
    }>(
      `SELECT e.action, e.actor, o.display_name AS operator, e.from_status, e.to_status,
              e.reason, e.applicant_message, e.created_at
         FROM mobility.driver_review_events e
         LEFT JOIN mobility.operators o ON o.id = e.operator_id
        WHERE e.driver_profile_id = $1 ORDER BY e.id`,
      [profileId],
    ),
    db.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM mobility.operators",
    ),
  ]);
  const names = new Map(reviewers.rows.map((r) => [r.id, r.display_name]));
  const eligibility = driverEligibility(p, now);
  return {
    ...adminItem(p, now),
    account: maskAccount(p.clerk_id),
    vehicleMake: p.vehicle_make,
    vehicleModel: p.vehicle_model,
    vehicleColor: p.vehicle_color,
    vehicleYear: p.vehicle_year,
    vehicleSeats: p.vehicle_seats,
    online: p.online,
    applicantMessage: p.applicant_message,
    waiverNote: p.waiver_note,
    ineligibleReasons: eligibility.reasons,
    requirements: requirementsFor(p, docs, now),
    ownApplication: p.user_id === operator.user_id,
    activeRide: ride.rows[0] ?? null,
    documents: docs
      .filter((d) => d.status !== "pending_upload")
      .map((d) => ({
        ...docView(d),
        reviewNote: d.review_note,
        reviewedAt: iso(d.reviewed_at),
        reviewedBy: d.reviewed_by ? (names.get(d.reviewed_by) ?? null) : null,
      })),
    history: history.rows.map((h) => ({
      action: h.action,
      actor: h.actor,
      operator: h.operator,
      fromStatus: h.from_status,
      toStatus: h.to_status,
      reason: h.reason,
      applicantMessage: h.applicant_message,
      createdAt: iso(h.created_at)!,
    })),
  };
}

export async function documentAccess(
  deps: { db: Database; storage: DocumentStorage | null; now: () => Date },
  operator: OperatorRow,
  profileId: string,
  documentId: string,
) {
  const storage = requireStorage(deps.storage);
  const now = deps.now();
  const { rows } = await deps.db.query<DocumentRow>(
    "SELECT * FROM mobility.driver_documents WHERE id = $1 AND driver_profile_id = $2",
    [documentId, profileId],
  );
  const doc = rows[0];
  if (
    !doc ||
    !doc.storage_key ||
    !["uploaded", "accepted", "rejected"].includes(doc.status)
  ) {
    await audit(deps.db, {
      operator,
      action: "driver_document_access",
      targetType: "driver_profile",
      targetId: profileId,
      result: "failed",
      detail: { documentId, error: "not_available" },
    });
    throw notFound("Document");
  }
  const extension =
    doc.content_type === "application/pdf"
      ? "pdf"
      : doc.content_type === "image/png"
        ? "png"
        : "jpg";
  const signed = storage.presignDownload(
    doc.storage_key,
    VERIFICATION_RULES.viewUrlSeconds,
    now,
    `${doc.kind}.${extension}`,
  );
  await audit(deps.db, {
    operator,
    action: "driver_document_access",
    targetType: "driver_profile",
    targetId: profileId,
    result: "succeeded",
    detail: {
      documentId,
      kind: doc.kind,
      expiresInSeconds: VERIFICATION_RULES.viewUrlSeconds,
    },
  });
  return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
}

class Refusal {
  constructor(readonly error: readonly [number, string, string]) {}
}

type Decision =
  "approve" | "request_changes" | "reject" | "suspend" | "reinstate";

const FROM: Record<Decision, DriverApplicationStatus[]> = {
  approve: ["submitted", "approved"],
  request_changes: ["submitted"],
  reject: ["submitted", "changes_requested"],
  suspend: ["approved"],
  reinstate: ["suspended"],
};

const TO: Record<Decision, DriverApplicationStatus> = {
  approve: "approved",
  request_changes: "changes_requested",
  reject: "rejected",
  suspend: "suspended",
  reinstate: "approved",
};

export async function decideApplication(
  deps: {
    db: Database;
    push?: PushGateway | null;
    now: () => Date;
  },
  profileId: string,
  operator: OperatorRow,
  input: {
    action: Decision;
    reason: string;
    applicantMessage?: string;
    expectedVersion: number;
    documents: {
      documentId: string;
      decision: "accept" | "reject";
      note?: string;
    }[];
  },
) {
  const now = deps.now();
  const fail = async (
    status: number,
    code: string,
    message: string,
    detail = {},
  ) => {
    await audit(deps.db, {
      operator,
      action: `driver_${input.action}`,
      targetType: "driver_profile",
      targetId: profileId,
      reason: input.reason,
      result: status === 403 ? "denied" : "failed",
      detail: { error: code, ...detail },
    });
    throw new ApiError(status, code, message);
  };

  const decideInTx = async (tx: SqlClient) => {
    const { rows } = await tx.query<ProfileRow>(
      "SELECT * FROM mobility.driver_profiles WHERE id = $1 FOR UPDATE",
      [profileId],
    );
    const profile = rows[0];
    if (!profile)
      return { error: [404, "NOT_FOUND", "Driver not found."] as const };
    if (profile.user_id === operator.user_id) {
      return {
        error: [
          403,
          "CANNOT_REVIEW_OWN_APPLICATION",
          "You can't review your own driver application.",
        ] as const,
      };
    }
    if (profile.review_version !== input.expectedVersion) {
      return {
        error: [
          409,
          "VERSION_CONFLICT",
          "This application changed since you opened it. Reload and review again.",
        ] as const,
      };
    }
    if (!FROM[input.action].includes(profile.status)) {
      return {
        error: [
          409,
          "INVALID_TRANSITION",
          `A ${profile.status.replace("_", " ")} application can't be handled with "${input.action.replace("_", " ")}".`,
        ] as const,
      };
    }
    const docs = await profileDocuments(tx, profileId);
    for (const d of input.documents) {
      const doc = docs.find((x) => x.id === d.documentId);
      if (!doc || !["uploaded", "accepted"].includes(doc.status)) {
        return {
          error: [
            409,
            "DOCUMENT_UNAVAILABLE",
            "One of the documents changed. Reload and review again.",
          ] as const,
        };
      }
      if (d.decision === "accept" && doc.status === "uploaded") {
        await tx.query(
          `UPDATE mobility.driver_documents
              SET status = 'replaced', updated_at = $3,
                  delete_after = $3::timestamptz + make_interval(days => $4)
            WHERE driver_profile_id = $1 AND kind = $2 AND status = 'accepted'`,
          [profileId, doc.kind, now, VERIFICATION_RULES.replacedRetentionDays],
        );
      }
      await tx.query(
        `UPDATE mobility.driver_documents
            SET status = $2, reviewed_by = $3, reviewed_at = $4, review_note = $5, updated_at = $4
          WHERE id = $1`,
        [
          doc.id,
          d.decision === "accept" ? "accepted" : "rejected",
          operator.id,
          now,
          d.note ?? null,
        ],
      );
      await event(tx, {
        profileId,
        actor: "operator",
        operatorId: operator.id,
        action:
          d.decision === "accept" ? "document_accepted" : "document_rejected",
        documentId: doc.id,
        applicantMessage: d.note ?? null,
        now,
      });
    }

    let approvalExpiresAt: Date | null = profile.approval_expires_at;
    let waived = profile.documents_waived;
    if (input.action === "approve" || input.action === "reinstate") {
      const current = await profileDocuments(tx, profileId);
      const accepted = current.filter(
        (d) => d.status === "accepted" && !documentExpired(d, now),
      );
      const missing = documentKinds.filter(
        (kind) =>
          !accepted.some(
            (d) =>
              d.kind === kind &&
              (!VERIFICATION_RULES.expiryRequired.includes(kind) ||
                d.expires_on !== null),
          ),
      );
      const vehicleOk = requirementsFor(profile, current, now)[0].met;
      if (
        !vehicleOk ||
        (missing.length &&
          !(input.action === "reinstate" && profile.documents_waived))
      ) {
        return {
          error: [
            409,
            "REQUIREMENTS_MISSING",
            `Accept a valid ${missing.map((k) => KIND_LABEL[k].toLowerCase()).join(", ") || "vehicle description"} before approving.`,
          ] as const,
        };
      }
      if (!missing.length) {
        waived = false;
        const expiries = accepted
          .filter((d) => VERIFICATION_RULES.expiryRequired.includes(d.kind))
          .map(
            (d) =>
              new Date(`${dayOf(d.expires_on)}T00:00:00.000Z`).getTime() +
              DAY_MS,
          );
        approvalExpiresAt = expiries.length
          ? new Date(Math.min(...expiries))
          : null;
      }
    }

    const to = TO[input.action];
    const set: string[] = [
      "status = $2",
      "review_version = review_version + 1",
      "updated_at = now()",
      "applicant_message = $3",
    ];
    const values: unknown[] = [profileId, to, input.applicantMessage ?? null];
    if (input.action === "approve" || input.action === "reinstate") {
      values.push(now, operator.id, approvalExpiresAt, waived);
      set.push(
        `approved_at = $${values.length - 3}`,
        `approved_by = $${values.length - 2}`,
        `approval_expires_at = $${values.length - 1}`,
        `documents_waived = $${values.length}`,
        `waiver_note = CASE WHEN $${values.length}::boolean THEN waiver_note ELSE NULL END`,
      );
    }
    if (input.action === "reject") {
      values.push(now);
      set.push(`rejected_at = $${values.length}`);
      await tx.query(
        `UPDATE mobility.driver_documents
            SET delete_after = $2::timestamptz + make_interval(days => $3), updated_at = $2
          WHERE driver_profile_id = $1 AND status <> 'deleted'`,
        [profileId, now, VERIFICATION_RULES.rejectedApplicationRetentionDays],
      );
    }
    if (input.action === "suspend") set.push("online = false");
    await tx.query(
      `UPDATE mobility.driver_profiles SET ${set.join(", ")} WHERE id = $1`,
      values,
    );
    await event(tx, {
      profileId,
      actor: "operator",
      operatorId: operator.id,
      action: input.action,
      from: profile.status,
      to,
      reason: input.reason,
      applicantMessage: input.applicantMessage ?? null,
      now,
    });
    await enqueueNotification(
      tx,
      {
        userId: profile.user_id,
        rideId: null,
        kind: "application_update",
        dedupeKey: `application:${profileId}:${profile.review_version + 1}:${input.action}`,
        ...NOTIFY.application(input.action),
        target: "/driver",
      },
      now,
    );
    return { from: profile.status, to };
  };
  const outcome = await transaction(deps.db, async (tx) => {
    const result = await decideInTx(tx);
    if ("error" in result && result.error) throw new Refusal(result.error);
    return result;
  }).catch((e: unknown) => {
    if (e instanceof Refusal) return { error: e.error };
    throw e;
  });

  if ("error" in outcome && outcome.error) {
    const [status, code, message] = outcome.error;
    return fail(status, code, message);
  }
  await audit(deps.db, {
    operator,
    action: `driver_${input.action}`,
    targetType: "driver_profile",
    targetId: profileId,
    reason: input.reason,
    result: "succeeded",
    detail: {
      fromStatus: outcome.from,
      toStatus: outcome.to,
      documents: input.documents.map((d) => ({
        id: d.documentId,
        decision: d.decision,
      })),
    },
  });
  if (input.action === "suspend") {
    await handleIneligibleDriver(deps, profileId, "driver_suspended");
  }
  await deliverPending(deps).catch(() => undefined);
}

export async function handleIneligibleDriver(
  deps: { db: Database; push?: PushGateway | null; now: () => Date },
  profileId: string,
  reason: "driver_suspended" | "approval_expired",
) {
  const now = deps.now();
  const { rows: active } = await deps.db.query<{ id: string }>(
    `SELECT id FROM mobility.rides
      WHERE driver_profile_id = $1 AND status = ANY($2::text[]) LIMIT 1`,
    [profileId, ASSIGNED_STATUSES],
  );
  if (active[0]) {
    await transaction(deps.db, async (tx) => {
      const ride = await lockRide(tx, active[0].id);
      if (!ride || ride.driver_profile_id !== profileId) return;
      if (PRE_PICKUP_STATUSES.includes(ride.status)) {
        await removeDriverForRematch(tx, ride, now, reason);
        await flagRideReview(tx, ride.id, "driver_ineligible_during_trip");
      } else if (
        ride.status === "in_progress" &&
        !(
          ride.needs_review &&
          ride.review_reason === "driver_ineligible_during_trip"
        )
      ) {
        await flagRideReview(tx, ride.id, "driver_ineligible_during_trip");
      }
    });
    await deliverPending(deps).catch(() => undefined);
  }
  await deps.db.query(
    "UPDATE mobility.ride_offers SET status = 'withdrawn', responded_at = $2 WHERE driver_profile_id = $1 AND status = 'pending'",
    [profileId, now],
  );
  const { rows: stillBusy } = await deps.db.query(
    "SELECT 1 FROM mobility.rides WHERE driver_profile_id = $1 AND status = ANY($2::text[])",
    [profileId, ASSIGNED_STATUSES],
  );
  if (!stillBusy.length) {
    await deps.db.query(
      "UPDATE mobility.driver_profiles SET online = false, updated_at = now() WHERE id = $1",
      [profileId],
    );
    await clearDriverLocation(deps.db, profileId);
  }
}

export async function enforceDriverEligibility(
  deps: { db: Database; push?: PushGateway | null; now: () => Date },
  limit = 50,
) {
  const now = deps.now();
  const { rows } = await deps.db.query<{ id: string }>(
    `SELECT dp.id FROM mobility.driver_profiles dp
      WHERE NOT ${eligibleDriverSql("dp", "$1::timestamptz")}
        AND (dp.online OR EXISTS (
              SELECT 1 FROM mobility.rides r
               WHERE r.driver_profile_id = dp.id AND r.status = ANY($2::text[])
                 AND NOT (r.status = 'in_progress' AND r.needs_review
                          AND r.review_reason = 'driver_ineligible_during_trip')))
      LIMIT $3`,
    [now, ASSIGNED_STATUSES, limit],
  );
  for (const { id } of rows) {
    const { rows: p } = await deps.db.query<{ status: string }>(
      "SELECT status FROM mobility.driver_profiles WHERE id = $1",
      [id],
    );
    await handleIneligibleDriver(
      deps,
      id,
      p[0]?.status === "suspended" ? "driver_suspended" : "approval_expired",
    );
  }
  return rows.length;
}

export async function purgeDriverDocuments(
  deps: { db: Database; storage?: DocumentStorage | null; now: () => Date },
  limit = 50,
) {
  if (!deps.storage) return 0;
  const now = deps.now();
  const abandonedBefore = new Date(
    now.getTime() - VERIFICATION_RULES.abandonedUploadHours * 3600 * 1000,
  );
  const due = `d.status <> 'deleted'
        AND ((d.delete_after IS NOT NULL AND d.delete_after <= $1)
             OR (d.status = 'pending_upload' AND d.created_at <= $2))`;
  const { rows } = await deps.db.query<{ documents: number }>(
    `WITH due AS (
       SELECT d.id, d.storage_key FROM mobility.driver_documents d
        WHERE ${due}
        ORDER BY d.created_at LIMIT $3
        FOR UPDATE SKIP LOCKED
     ), gone AS (
       UPDATE mobility.driver_documents d
          SET status = 'deleted', storage_key = NULL, deleted_at = $1, updated_at = $1
         FROM due WHERE d.id = due.id AND ${due}
       RETURNING d.id
     ), queued AS (
       INSERT INTO mobility.storage_deletions (key, not_before, created_at)
       SELECT due.storage_key, $1, $1 FROM due
         JOIN gone ON gone.id = due.id
        WHERE due.storage_key IS NOT NULL
       ON CONFLICT (key) DO UPDATE SET not_before = LEAST(storage_deletions.not_before, EXCLUDED.not_before)
       RETURNING key
     )
     SELECT (SELECT count(*)::int FROM gone) AS documents`,
    [now, abandonedBefore, limit],
  );
  await processStorageDeletions(
    { db: deps.db, storage: deps.storage, now: deps.now },
    limit,
  );
  return rows[0]?.documents ?? 0;
}

export async function processStorageDeletions(
  deps: { db: Database; storage: DocumentStorage; now: () => Date },
  limit = 50,
) {
  const now = deps.now();
  let removed = 0;
  for (let i = 0; i < limit; i++) {
    const outcome = await transaction(deps.db, async (tx) => {
      const { rows } = await tx.query<{ key: string; attempts: number }>(
        `SELECT key, attempts FROM mobility.storage_deletions
          WHERE not_before <= $1 ORDER BY not_before LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [now],
      );
      const job = rows[0];
      if (!job) return "empty";
      const live = await tx.query(
        "SELECT 1 FROM mobility.driver_documents WHERE storage_key = $1",
        [job.key],
      );
      if (live.rows.length) {
        await tx.query(
          "DELETE FROM mobility.storage_deletions WHERE key = $1",
          [job.key],
        );
        return "skipped";
      }
      try {
        await deps.storage.remove(job.key, now);
      } catch (e) {
        await tx.query(
          `UPDATE mobility.storage_deletions
              SET attempts = attempts + 1, last_error = $2,
                  not_before = $3::timestamptz + make_interval(secs => $4)
            WHERE key = $1`,
          [
            job.key,
            String(e instanceof Error ? e.message : e).slice(0, 200),
            now,
            Math.min(3600, 60 * 2 ** job.attempts),
          ],
        );
        return "failed";
      }
      await tx.query("DELETE FROM mobility.storage_deletions WHERE key = $1", [
        job.key,
      ]);
      return "removed";
    });
    if (outcome === "empty") break;
    if (outcome === "removed") removed++;
  }
  return removed;
}
