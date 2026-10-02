import { type DocumentStorage, matchesSignature } from "./storage";

import type { Database, SqlClient } from "./db";

export async function scheduleStorageDeletion(
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

export type PromoteResult =
  | { outcome: "promoted"; etag: string | null }
  | { outcome: "not_found" | "changed" | "rejected" };

export async function promoteUpload(
  deps: { db: Database; storage: DocumentStorage },
  file: {
    uploadKey: string;
    finalKey: string;
    contentType: string;
    sizeBytes: number;
    maxBytes: number;
    reservationSeconds: number;
  },
  now: Date,
): Promise<PromoteResult> {
  const { storage } = deps;
  const matches = (o: { size: number; contentType: string | null }) =>
    o.size === file.sizeBytes &&
    o.size <= file.maxBytes &&
    (o.contentType ?? "").split(";")[0].trim() === file.contentType;

  const stored = await storage.head(file.uploadKey, now);
  if (!stored) return { outcome: "not_found" };
  if (!stored.etag) return { outcome: "changed" };
  if (!matches(stored)) return { outcome: "rejected" };
  const start = await storage.readStart(file.uploadKey, 8, stored.etag, now);
  if (!start) return { outcome: "changed" };
  if (!matchesSignature(file.contentType, start)) {
    return { outcome: "rejected" };
  }
  await scheduleStorageDeletion(
    deps.db,
    file.finalKey,
    new Date(now.getTime() + file.reservationSeconds * 1000),
    now,
  );
  if (!(await storage.copy(file.uploadKey, file.finalKey, stored.etag, now))) {
    return { outcome: "changed" };
  }
  const copied = await storage.head(file.finalKey, now);
  if (!copied || !matches(copied)) return { outcome: "changed" };
  return { outcome: "promoted", etag: copied.etag };
}
