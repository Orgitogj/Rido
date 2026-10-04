import { randomUUID } from "node:crypto";

import {
  SUPPORT_RULES,
  type SupportAttachmentAccess,
  type SupportAttachmentTicket,
  type SupportAttachmentType,
  type SupportAttachmentView,
} from "../shared/account";

import { type Database, type SqlClient, transaction } from "./db";
import { ApiError, notFound } from "./errors";
import { audit, type OperatorRow } from "./operators";
import { promoteUpload, scheduleStorageDeletion } from "./uploads";

import type { DocumentStorage } from "./storage";

interface AttachmentRow {
  id: string;
  user_id: string;
  support_request_id: string | null;
  support_message_id: string | null;
  status: "pending_upload" | "ready" | "attached" | "deleted";
  upload_key: string | null;
  storage_key: string | null;
  content_type: SupportAttachmentType;
  size_bytes: number;
  created_at: Date;
}

interface AttachmentDeps {
  db: Database;
  storage: DocumentStorage | null;
  now: () => Date;
}

const columns = (p = "") =>
  `${p}id, ${p}user_id, ${p}support_request_id,
   ${p}support_message_id::text AS support_message_id, ${p}status, ${p}upload_key,
   ${p}storage_key, ${p}content_type, ${p}size_bytes, ${p}created_at`;
const COLUMNS = columns();

const requireStorage = (storage: DocumentStorage | null) => {
  if (!storage) {
    throw new ApiError(
      503,
      "STORAGE_NOT_CONFIGURED",
      "Attachments aren't available on this server yet. You can still send your message without one.",
    );
  }
  return storage;
};

const view = (a: AttachmentRow): SupportAttachmentView => ({
  id: a.id,
  contentType: a.content_type,
  sizeBytes: a.size_bytes,
  createdAt: new Date(a.created_at).toISOString(),
});

const secondsAfter = (d: Date, seconds: number) =>
  new Date(d.getTime() + seconds * 1000);

export async function requestAttachmentUpload(
  deps: AttachmentDeps,
  userId: string,
  input: { contentType: SupportAttachmentType; sizeBytes: number },
): Promise<SupportAttachmentTicket> {
  const storage = requireStorage(deps.storage);
  const now = deps.now();
  const expiresAt = secondsAfter(now, SUPPORT_RULES.attachmentUploadUrlSeconds);
  const row = await transaction(deps.db, async (tx) => {
    await tx.query("SELECT 1 FROM mobility.users WHERE id = $1 FOR UPDATE", [
      userId,
    ]);
    const { rows: open } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM mobility.support_attachments
        WHERE user_id = $1 AND status IN ('pending_upload', 'ready')`,
      [userId],
    );
    if (open[0].n >= SUPPORT_RULES.pendingAttachmentsPerUser) {
      throw new ApiError(
        409,
        "ATTACHMENT_LIMIT",
        "Remove an unsent attachment before adding another.",
      );
    }
    const uploadKey = `support-attachments/uploads/${userId}/${randomUUID()}`;
    const { rows } = await tx.query<AttachmentRow>(
      `INSERT INTO mobility.support_attachments
         (user_id, upload_key, upload_expires_at, content_type, size_bytes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
      [userId, uploadKey, expiresAt, input.contentType, input.sizeBytes, now],
    );
    await scheduleStorageDeletion(
      tx,
      uploadKey,
      secondsAfter(expiresAt, SUPPORT_RULES.attachmentUploadKeyGraceSeconds),
      now,
    );
    return rows[0];
  });
  const target = storage.presignUpload(
    row.upload_key!,
    row.content_type,
    row.size_bytes,
    SUPPORT_RULES.attachmentUploadUrlSeconds,
    now,
  );
  return {
    attachment: { ...view(row), status: "pending_upload" },
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

async function ownAttachment(db: SqlClient, userId: string, id: string) {
  const { rows } = await db.query<AttachmentRow>(
    `SELECT ${COLUMNS} FROM mobility.support_attachments WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!rows[0] || rows[0].status === "deleted") throw notFound("Attachment");
  return rows[0];
}

export async function completeAttachmentUpload(
  deps: AttachmentDeps,
  userId: string,
  attachmentId: string,
): Promise<SupportAttachmentView & { status: "ready" }> {
  const storage = requireStorage(deps.storage);
  const now = deps.now();
  const row = await ownAttachment(deps.db, userId, attachmentId);
  if (row.status === "ready" || row.status === "attached") {
    return { ...view(row), status: "ready" };
  }
  const uploadKey = row.upload_key!;
  const finalKey = `support-attachments/files/${userId}/${randomUUID()}`;
  const result = await promoteUpload(
    { db: deps.db, storage },
    {
      uploadKey,
      finalKey,
      contentType: row.content_type,
      sizeBytes: row.size_bytes,
      maxBytes: SUPPORT_RULES.attachmentMaxBytes,
      reservationSeconds: SUPPORT_RULES.attachmentReservationSeconds,
    },
    now,
  );
  if (result.outcome === "not_found") {
    throw new ApiError(
      409,
      "UPLOAD_NOT_FOUND",
      "We didn't receive the file. Try uploading it again.",
    );
  }
  if (result.outcome === "changed") {
    throw new ApiError(
      409,
      "UPLOAD_CHANGED",
      "The file changed while we were checking it. Upload it again.",
    );
  }
  if (result.outcome === "rejected") {
    await deps.db.query(
      `UPDATE mobility.support_attachments
          SET status = 'deleted', deleted_at = $2, upload_key = NULL
        WHERE id = $1 AND status = 'pending_upload'`,
      [row.id, now],
    );
    await storage.remove(uploadKey, now).catch(() => undefined);
    throw new ApiError(
      422,
      "FILE_REJECTED",
      "That file isn't a readable JPEG or PNG of the expected size. Choose it again.",
    );
  }
  const etag = "etag" in result ? result.etag : null;
  const updated = await transaction(deps.db, async (tx) => {
    const reservation = await tx.query(
      "DELETE FROM mobility.storage_deletions WHERE key = $1 RETURNING key",
      [finalKey],
    );
    if (!reservation.rows.length) return null;
    const { rows } = await tx.query<AttachmentRow>(
      `UPDATE mobility.support_attachments
          SET status = 'ready', storage_key = $2, etag = $3, uploaded_at = $4,
              upload_key = NULL, upload_expires_at = NULL
        WHERE id = $1 AND status = 'pending_upload'
        RETURNING ${COLUMNS}`,
      [row.id, finalKey, etag, now],
    );
    if (!rows[0]) {
      await scheduleStorageDeletion(tx, finalKey, now, now);
      return null;
    }
    return rows[0];
  });
  await storage.remove(uploadKey, now).catch(() => undefined);
  if (!updated) {
    throw new ApiError(
      409,
      "UPLOAD_CLOSED",
      "This upload was removed or expired. Add the image again.",
    );
  }
  return { ...view(updated), status: "ready" };
}

export async function removeAttachment(
  deps: AttachmentDeps,
  userId: string,
  attachmentId: string,
) {
  const now = deps.now();
  await transaction(deps.db, async (tx) => {
    const { rows } = await tx.query<AttachmentRow>(
      `SELECT ${COLUMNS} FROM mobility.support_attachments
        WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [attachmentId, userId],
    );
    const row = rows[0];
    if (!row) throw notFound("Attachment");
    if (row.status === "deleted") return;
    if (row.status === "attached") {
      throw new ApiError(
        409,
        "ATTACHMENT_SENT",
        "An attachment that was already sent can't be removed.",
      );
    }
    for (const key of [row.upload_key, row.storage_key]) {
      if (key) await scheduleStorageDeletion(tx, key, now, now);
    }
    await tx.query(
      `UPDATE mobility.support_attachments
          SET status = 'deleted', deleted_at = $2, storage_key = NULL, upload_key = NULL
        WHERE id = $1`,
      [row.id, now],
    );
  });
}

export async function attachToRequest(
  tx: SqlClient,
  userId: string,
  requestId: string,
  messageId: string | null,
  ids: string[],
) {
  if (!ids.length) return;
  const { rows: existing } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM mobility.support_attachments
      WHERE support_request_id = $1 AND status = 'attached'`,
    [requestId],
  );
  if (existing[0].n + ids.length > SUPPORT_RULES.attachmentsPerRequest) {
    throw new ApiError(
      409,
      "ATTACHMENT_LIMIT",
      `A request can have up to ${SUPPORT_RULES.attachmentsPerRequest} attachments.`,
    );
  }
  const { rows } = await tx.query(
    `UPDATE mobility.support_attachments
        SET status = 'attached', support_request_id = $3, support_message_id = $4::bigint
      WHERE id = ANY($1::uuid[]) AND user_id = $2 AND status = 'ready'
      RETURNING id`,
    [ids, userId, requestId, messageId],
  );
  if (rows.length !== ids.length) {
    throw new ApiError(
      409,
      "ATTACHMENT_NOT_READY",
      "One of the attachments isn't available. Remove it and add it again.",
    );
  }
}

export async function attachmentsOf(db: SqlClient, requestId: string) {
  const { rows } = await db.query<AttachmentRow>(
    `SELECT ${COLUMNS} FROM mobility.support_attachments
      WHERE support_request_id = $1 AND status = 'attached'
      ORDER BY created_at, id`,
    [requestId],
  );
  const byMessage = new Map<string | null, SupportAttachmentView[]>();
  for (const a of rows) {
    const list = byMessage.get(a.support_message_id) ?? [];
    list.push(view(a));
    byMessage.set(a.support_message_id, list);
  }
  return {
    count: rows.length,
    initial: byMessage.get(null) ?? [],
    forMessage: (id: string) => byMessage.get(id) ?? [],
    all: rows.map((a) => ({ ...view(a), messageId: a.support_message_id })),
  };
}

async function signedView(
  deps: AttachmentDeps,
  row: AttachmentRow,
): Promise<SupportAttachmentAccess> {
  const storage = requireStorage(deps.storage);
  const signed = storage.presignDownload(
    row.storage_key!,
    SUPPORT_RULES.attachmentViewUrlSeconds,
    deps.now(),
    `attachment.${row.content_type === "image/png" ? "png" : "jpg"}`,
  );
  return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
}

export async function attachmentAccessForUser(
  deps: AttachmentDeps,
  userId: string,
  requestId: string,
  attachmentId: string,
) {
  const { rows } = await deps.db.query<AttachmentRow>(
    `SELECT ${columns("a.")}
       FROM mobility.support_attachments a
       JOIN mobility.support_requests s ON s.id = a.support_request_id
      WHERE a.id = $1 AND a.support_request_id = $2 AND s.user_id = $3
        AND a.user_id = $3 AND a.status = 'attached'`,
    [attachmentId, requestId, userId],
  );
  if (!rows[0]) throw notFound("Attachment");
  return signedView(deps, rows[0]);
}

export async function attachmentAccessForOperator(
  deps: AttachmentDeps,
  operator: OperatorRow,
  requestId: string,
  attachmentId: string,
) {
  const { rows } = await deps.db.query<AttachmentRow>(
    `SELECT ${COLUMNS} FROM mobility.support_attachments
      WHERE id = $1 AND support_request_id = $2 AND status = 'attached'`,
    [attachmentId, requestId],
  );
  const row = rows[0];
  await audit(deps.db, {
    operator,
    action: "support_attachment_access",
    targetType: "support_request",
    targetId: requestId,
    result: row ? "succeeded" : "failed",
    detail: row
      ? {
          attachmentId,
          expiresInSeconds: SUPPORT_RULES.attachmentViewUrlSeconds,
        }
      : { attachmentId, error: "not_available" },
  });
  if (!row) throw notFound("Attachment");
  return signedView(deps, row);
}

export async function purgeSupportAttachments(
  deps: { db: Database; now: () => Date },
  limit = 100,
) {
  const now = deps.now();
  const { rows } = await deps.db.query<{ n: number }>(
    `WITH due AS (
       SELECT a.id, a.storage_key, a.upload_key
         FROM mobility.support_attachments a
         LEFT JOIN mobility.support_requests s ON s.id = a.support_request_id
        WHERE a.status <> 'deleted'
          AND ((a.status IN ('pending_upload', 'ready') AND a.created_at <= $2)
            OR (a.delete_after IS NOT NULL AND a.delete_after <= $1)
            OR (a.status = 'attached' AND s.status = 'resolved' AND s.resolved_at <= $3))
        ORDER BY a.created_at LIMIT $4
        FOR UPDATE OF a SKIP LOCKED
     ), gone AS (
       UPDATE mobility.support_attachments a
          SET status = 'deleted', deleted_at = $1, storage_key = NULL, upload_key = NULL
         FROM due WHERE a.id = due.id
       RETURNING a.id
     ), queued AS (
       INSERT INTO mobility.storage_deletions (key, not_before, created_at)
       SELECT k.key, $1, $1
         FROM due JOIN gone ON gone.id = due.id
         CROSS JOIN LATERAL (VALUES (due.storage_key), (due.upload_key)) AS k(key)
        WHERE k.key IS NOT NULL
       ON CONFLICT (key) DO UPDATE SET not_before = LEAST(storage_deletions.not_before, EXCLUDED.not_before)
       RETURNING key
     )
     SELECT (SELECT count(*)::int FROM gone) AS n`,
    [
      now,
      new Date(
        now.getTime() - SUPPORT_RULES.abandonedAttachmentHours * 3600 * 1000,
      ),
      new Date(
        now.getTime() -
          SUPPORT_RULES.attachmentRetentionDays * 24 * 3600 * 1000,
      ),
      limit,
    ],
  );
  return rows[0]?.n ?? 0;
}
