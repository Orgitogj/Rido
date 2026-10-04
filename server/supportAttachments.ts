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
