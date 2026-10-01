import { sections } from "@/lib/i18n/sections";
import {
  type DocumentKind,
  type DocumentStatus,
  type DocumentUploadTicket,
  documentContentTypes,
  type DriverApplicationStatus,
  driverApplicationStatuses,
  type DriverDocumentView,
  VERIFICATION_RULES,
} from "@/shared/contracts";

export const DOCUMENT_LABELS: Record<DocumentKind, string> =
  sections.driver.en.documents.kind;

const STATUS_TEXT = sections.driver.en.status;

export const APPLICATION_STATUS = Object.fromEntries(
  driverApplicationStatuses.map((status) => [
    status,
    {
      title: STATUS_TEXT[`${status}_title`],
      body: STATUS_TEXT[`${status}_body`],
    },
  ]),
) as Record<DriverApplicationStatus, { title: string; body: string }>;

export const DOCUMENT_STATUS: Record<DocumentStatus, string> =
  sections.driver.en.documents.status;

export class UploadError extends Error {
  constructor(
    public code: "STORAGE_REFUSED" | "UPLOAD_FAILED",
    message: string,
  ) {
    super(message);
  }
}

export function needsExpiry(kind: DocumentKind) {
  return VERIFICATION_RULES.expiryRequired.includes(kind);
}

export function currentDocument(
  documents: DriverDocumentView[],
  kind: DocumentKind,
) {
  const mine = documents.filter((d) => d.kind === kind);
  return (
    mine.find(
      (d) =>
        d.status === "uploaded" ||
        d.status === "rejected" ||
        d.status === "pending_upload",
    ) ??
    mine.find((d) => d.status === "accepted") ??
    null
  );
}

export function guessContentType(name: string, mimeType?: string | null) {
  const given = (mimeType ?? "").toLowerCase();
  if ((documentContentTypes as readonly string[]).includes(given)) return given;
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "pdf") return "application/pdf";
  return null;
}

export function checkFile(
  name: string,
  mimeType: string | null | undefined,
  size: number | null | undefined,
):
  | {
      ok: true;
      contentType: (typeof documentContentTypes)[number];
      size: number;
    }
  | { ok: false; reason: "badType" | "empty" | "tooLarge" } {
  const contentType = guessContentType(name, mimeType);
  if (!contentType) {
    return { ok: false, reason: "badType" };
  }
  if (!size || size < VERIFICATION_RULES.minBytes) {
    return { ok: false, reason: "empty" };
  }
  if (size > VERIFICATION_RULES.maxBytes) {
    return { ok: false, reason: "tooLarge" };
  }
  return {
    ok: true,
    contentType: contentType as (typeof documentContentTypes)[number],
    size,
  };
}

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export interface PickedFile {
  uri: string;
  name: string;
  contentType: string;
  blob?: Blob | null;
}

export function uploadRequest(
  ticket: DocumentUploadTicket,
  file: PickedFile,
  blob: Blob | null,
): { url: string; init: RequestInit } {
  const target = ticket.upload;
  if (target.method === "POST") {
    const form = new FormData();
    for (const [name, value] of Object.entries(target.fields)) {
      form.append(name, value);
    }
    if (blob) form.append("file", blob, file.name);
    else
      form.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.contentType,
      } as unknown as Blob);
    return { url: target.url, init: { method: "POST", body: form } };
  }
  const headers = { ...target.headers };
  delete headers["content-length"];
  return {
    url: target.url,
    init: { method: "PUT", headers, body: blob },
  };
}

export async function uploadToStorage(
  ticket: DocumentUploadTicket,
  file: PickedFile,
  send: typeof fetch = fetch,
) {
  const blob =
    file.blob ??
    (ticket.upload.method === "PUT"
      ? await (await send(file.uri)).blob()
      : null);
  const { url, init } = uploadRequest(ticket, file, blob);
  const res = await send(url, init);
  if (!res.ok) {
    const refused = res.status === 400 || res.status === 403;
    throw new UploadError(
      refused ? "STORAGE_REFUSED" : "UPLOAD_FAILED",
      refused
        ? sections.driver.en.documents.storageRefused
        : sections.driver.en.documents.uploadFailed,
    );
  }
}
