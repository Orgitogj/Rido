export type UploadTarget =
  | {
      method: "POST";
      url: string;
      fields: Record<string, string>;
      expiresAt: string;
    }
  | {
      method: "PUT";
      url: string;
      headers: Record<string, string>;
      expiresAt: string;
    };

export interface LocalFile {
  uri: string;
  name: string;
  contentType: string;
  blob?: Blob | null;
}

export class UploadFailure extends Error {
  constructor(
    public code: "STORAGE_REFUSED" | "UPLOAD_FAILED" | "UPLOAD_ABORTED",
    public status: number,
  ) {
    super(code);
  }
}

export type DraftProblem =
  | "badType"
  | "empty"
  | "tooLarge"
  | "limit"
  | "unavailable"
  | "refused"
  | "rejected"
  | "failed";

export function problemFromError(e: unknown): DraftProblem {
  if (e instanceof UploadFailure) {
    return e.code === "STORAGE_REFUSED" ? "refused" : "failed";
  }
  const code =
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code: unknown }).code)
      : "";
  if (code === "STORAGE_NOT_CONFIGURED") return "unavailable";
  if (code === "ATTACHMENT_LIMIT") return "limit";
  if (code === "FILE_REJECTED") return "rejected";
  return "failed";
}

export function uploadBody(
  target: UploadTarget,
  file: LocalFile,
  blob: Blob | null,
): { headers: Record<string, string>; body: FormData | Blob | null } {
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
    return { headers: {}, body: form };
  }
  const headers = { ...target.headers };
  delete headers["content-length"];
  return { headers, body: blob };
}

export function uploadWithProgress(
  target: UploadTarget,
  file: LocalFile,
  onProgress: (fraction: number) => void,
  signal?: { aborted: boolean; onAbort?: () => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = (blob: Blob | null) => {
      const { headers, body } = uploadBody(target, file, blob);
      const xhr = new XMLHttpRequest();
      xhr.open(target.method, target.url);
      for (const [name, value] of Object.entries(headers)) {
        xhr.setRequestHeader(name, value);
      }
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.min(1, event.loaded / event.total));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(1);
          resolve();
        } else {
          reject(
            new UploadFailure(
              xhr.status === 400 || xhr.status === 403
                ? "STORAGE_REFUSED"
                : "UPLOAD_FAILED",
              xhr.status,
            ),
          );
        }
      };
      xhr.onerror = () => reject(new UploadFailure("UPLOAD_FAILED", 0));
      xhr.onabort = () => reject(new UploadFailure("UPLOAD_ABORTED", 0));
      if (signal) {
        signal.onAbort = () => xhr.abort();
        if (signal.aborted) {
          xhr.abort();
          return;
        }
      }
      xhr.send(body as never);
    };
    if (file.blob) start(file.blob);
    else if (target.method === "PUT") {
      fetch(file.uri)
        .then((res) => res.blob())
        .then(start)
        .catch(() => reject(new UploadFailure("UPLOAD_FAILED", 0)));
    } else start(null);
  });
}

export function checkImage(
  name: string,
  mimeType: string | null | undefined,
  size: number | null | undefined,
  limits: { minBytes: number; maxBytes: number },
):
  | { ok: true; contentType: "image/jpeg" | "image/png"; size: number }
  | { ok: false; reason: "badType" | "empty" | "tooLarge" } {
  const given = (mimeType ?? "").toLowerCase();
  const ext = name.toLowerCase().split(".").pop();
  const contentType =
    given === "image/jpeg" || given === "image/jpg"
      ? "image/jpeg"
      : given === "image/png"
        ? "image/png"
        : given
          ? null
          : ext === "jpg" || ext === "jpeg"
            ? "image/jpeg"
            : ext === "png"
              ? "image/png"
              : null;
  if (!contentType) return { ok: false, reason: "badType" };
  if (!size || size < limits.minBytes) return { ok: false, reason: "empty" };
  if (size > limits.maxBytes) return { ok: false, reason: "tooLarge" };
  return { ok: true, contentType, size };
}
