import {
  type DocumentKind,
  type DocumentStatus,
  type DocumentUploadTicket,
  documentContentTypes,
  type DriverApplicationStatus,
  type DriverDocumentView,
  VERIFICATION_RULES,
} from "@/shared/contracts";

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  identity: "Proof of identity",
  driving_license: "Driving licence",
  vehicle_registration: "Vehicle registration",
  insurance: "Vehicle insurance",
};

export const APPLICATION_STATUS: Record<
  DriverApplicationStatus,
  { title: string; body: string }
> = {
  draft: {
    title: "Draft",
    body: "Finish your details and upload each document, then submit for review.",
  },
  submitted: {
    title: "Submitted for review",
    body: "An operator will review your details and documents. You can't edit them while they're being reviewed.",
  },
  changes_requested: {
    title: "Changes requested",
    body: "An operator asked for changes. Update what's listed below and submit again.",
  },
  approved: {
    title: "Approved",
    body: "You can go online and receive ride requests.",
  },
  rejected: {
    title: "Not approved",
    body: "Your application wasn't approved. You can start a new application.",
  },
  suspended: {
    title: "Suspended",
    body: "You can't go online. Contact support if you think this is a mistake.",
  },
};

export const DOCUMENT_STATUS: Record<DocumentStatus, string> = {
  pending_upload: "Upload not finished",
  uploaded: "Waiting for review",
  accepted: "Accepted",
  rejected: "Rejected",
  replaced: "Replaced",
  invalid: "Invalid file",
  deleted: "Deleted",
};

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
  | { ok: false; message: string } {
  const contentType = guessContentType(name, mimeType);
  if (!contentType) {
    return { ok: false, message: "Use a JPEG, PNG, or PDF file." };
  }
  if (!size || size < VERIFICATION_RULES.minBytes) {
    return { ok: false, message: "That file looks empty." };
  }
  if (size > VERIFICATION_RULES.maxBytes) {
    return { ok: false, message: "Files must be 10 MB or smaller." };
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
    throw new Error(
      res.status === 400 || res.status === 403
        ? "The storage service refused this file. Check that it is the size and type you chose, then try again."
        : `Upload failed (${res.status}). Try again.`,
    );
  }
}
