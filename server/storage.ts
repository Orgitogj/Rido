import { createHash, createHmac } from "node:crypto";

export interface PresignedRequest {
  url: string;
  method: "PUT" | "GET" | "HEAD" | "DELETE";
  headers: Record<string, string>;
  expiresAt: Date;
}

export type UploadMethod = "POST" | "PUT";

export type UploadTarget =
  | {
      method: "POST";
      url: string;
      fields: Record<string, string>;
      expiresAt: Date;
    }
  | {
      method: "PUT";
      url: string;
      headers: Record<string, string>;
      expiresAt: Date;
    };

export interface StoredObject {
  size: number;
  contentType: string | null;
  etag: string | null;
}

export interface DocumentStorage {
  uploadMethod: UploadMethod;
  presignUpload(
    key: string,
    contentType: string,
    sizeBytes: number,
    expiresSeconds: number,
    now: Date,
  ): UploadTarget;
  presignDownload(
    key: string,
    expiresSeconds: number,
    now: Date,
    downloadName: string,
  ): PresignedRequest;
  head(key: string, now: Date): Promise<StoredObject | null>;
  readStart(
    key: string,
    bytes: number,
    etag: string,
    now: Date,
  ): Promise<Uint8Array | null>;
  copy(from: string, to: string, etag: string, now: Date): Promise<boolean>;
  remove(key: string, now: Date): Promise<void>;
}

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string | null;
  forcePathStyle: boolean;
  uploadMethod?: UploadMethod;
}

const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const encodePath = (path: string) => path.split("/").map(encode).join("/");

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const hmac = (key: Buffer | string, value: string) =>
  createHmac("sha256", key).update(value).digest();

export function amzDate(now: Date) {
  const iso = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return { stamp: iso, day: iso.slice(0, 8) };
}

function signingKey(config: S3Config, day: string) {
  return hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), config.region), "s3"),
    "aws4_request",
  );
}

function location(config: S3Config) {
  if (config.endpoint) {
    const url = new URL(config.endpoint);
    const host = config.forcePathStyle
      ? url.host
      : `${config.bucket}.${url.host}`;
    return {
      host,
      origin: `${url.protocol}//${host}`,
      prefix: config.forcePathStyle ? `/${config.bucket}` : "",
    };
  }
  const regional =
    config.region === "us-east-1"
      ? "s3.amazonaws.com"
      : `s3.${config.region}.amazonaws.com`;
  const host = config.forcePathStyle
    ? regional
    : `${config.bucket}.${regional}`;
  return {
    host,
    origin: `https://${host}`,
    prefix: config.forcePathStyle ? `/${config.bucket}` : "",
  };
}

export function presignS3(
  config: S3Config,
  input: {
    method: PresignedRequest["method"];
    key: string;
    expiresSeconds: number;
    now: Date;
    headers?: Record<string, string>;
    query?: Record<string, string>;
  },
): PresignedRequest {
  const { stamp, day } = amzDate(input.now);
  const { host, origin, prefix } = location(config);
  const path = `${prefix}/${encodePath(input.key)}`;
  const signedHeaders: Record<string, string> = { host };
  for (const [k, v] of Object.entries(input.headers ?? {})) {
    signedHeaders[k.toLowerCase()] = v;
  }
  const headerNames = Object.keys(signedHeaders).sort();
  const scope = `${day}/${config.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    ...(input.query ?? {}),
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": headerNames.join(";"),
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encode(k)}=${encode(query[k])}`)
    .join("&");
  const canonicalHeaders = headerNames
    .map((h) => `${h}:${String(signedHeaders[h]).trim()}\n`)
    .join("");
  const canonicalRequest = [
    input.method,
    path,
    canonicalQuery,
    canonicalHeaders,
    headerNames.join(";"),
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    sha256(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(config, day))
    .update(stringToSign)
    .digest("hex");
  return {
    url: `${origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    method: input.method,
    headers: { ...(input.headers ?? {}) },
    expiresAt: new Date(input.now.getTime() + input.expiresSeconds * 1000),
  };
}

export function presignPost(
  config: S3Config,
  input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresSeconds: number;
    now: Date;
  },
): Extract<UploadTarget, { method: "POST" }> {
  const { stamp, day } = amzDate(input.now);
  const { origin, prefix } = location(config);
  const credential = `${config.accessKeyId}/${day}/${config.region}/s3/aws4_request`;
  const expiresAt = new Date(input.now.getTime() + input.expiresSeconds * 1000);
  const policy = Buffer.from(
    JSON.stringify({
      expiration: expiresAt.toISOString(),
      conditions: [
        { bucket: config.bucket },
        ["eq", "$key", input.key],
        ["eq", "$Content-Type", input.contentType],
        ["content-length-range", input.sizeBytes, input.sizeBytes],
        { "x-amz-algorithm": "AWS4-HMAC-SHA256" },
        { "x-amz-credential": credential },
        { "x-amz-date": stamp },
      ],
    }),
  ).toString("base64");
  return {
    method: "POST",
    url: `${origin}${prefix}/`,
    fields: {
      key: input.key,
      "Content-Type": input.contentType,
      "x-amz-algorithm": "AWS4-HMAC-SHA256",
      "x-amz-credential": credential,
      "x-amz-date": stamp,
      policy,
      "x-amz-signature": createHmac("sha256", signingKey(config, day))
        .update(policy)
        .digest("hex"),
    },
    expiresAt,
  };
}

export function s3Storage(
  config: S3Config,
  fetchImpl: typeof fetch = fetch,
): DocumentStorage {
  const send = async (
    request: PresignedRequest,
    extra: Record<string, string> = {},
  ) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      return await fetchImpl(request.url, {
        method: request.method,
        headers: { ...request.headers, ...extra },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  const uploadMethod = config.uploadMethod ?? "POST";
  return {
    uploadMethod,
    presignUpload(key, contentType, sizeBytes, expiresSeconds, now) {
      if (uploadMethod === "POST") {
        return presignPost(config, {
          key,
          contentType,
          sizeBytes,
          expiresSeconds,
          now,
        });
      }
      const signed = presignS3(config, {
        method: "PUT",
        key,
        expiresSeconds,
        now,
        headers: {
          "content-type": contentType,
          "content-length": String(sizeBytes),
        },
      });
      return {
        method: "PUT",
        url: signed.url,
        headers: signed.headers,
        expiresAt: signed.expiresAt,
      };
    },
    presignDownload(key, expiresSeconds, now, downloadName) {
      return presignS3(config, {
        method: "GET",
        key,
        expiresSeconds,
        now,
        query: {
          "response-content-disposition": `inline; filename="${downloadName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
          "response-cache-control": "no-store",
        },
      });
    },
    async head(key, now) {
      const res = await send(
        presignS3(config, { method: "HEAD", key, expiresSeconds: 60, now }),
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Storage HEAD failed (${res.status})`);
      return {
        size: Number(res.headers.get("content-length") ?? -1),
        contentType: res.headers.get("content-type"),
        etag: res.headers.get("etag"),
      };
    },
    async readStart(key, bytes, etag, now) {
      const res = await send(
        presignS3(config, {
          method: "GET",
          key,
          expiresSeconds: 60,
          now,
          headers: { "if-match": etag },
        }),
        { range: `bytes=0-${bytes - 1}` },
      );
      if (res.status === 412 || res.status === 404) return null;
      if (!res.ok) throw new Error(`Storage GET failed (${res.status})`);
      return new Uint8Array(await res.arrayBuffer()).slice(0, bytes);
    },
    async copy(from, to, etag, now) {
      const res = await send(
        presignS3(config, {
          method: "PUT",
          key: to,
          expiresSeconds: 60,
          now,
          headers: {
            "x-amz-copy-source": `/${config.bucket}/${encodePath(from)}`,
            "x-amz-copy-source-if-match": etag,
            "x-amz-metadata-directive": "COPY",
          },
        }),
      );
      if (res.status === 412 || res.status === 404) return false;
      const body = await res.text();
      if (!res.ok || body.includes("<Error>")) {
        if (/PreconditionFailed|NoSuchKey/.test(body)) return false;
        throw new Error(`Storage COPY failed (${res.status})`);
      }
      return true;
    },
    async remove(key, now) {
      const res = await send(
        presignS3(config, { method: "DELETE", key, expiresSeconds: 60, now }),
      );
      if (!res.ok && res.status !== 404) {
        throw new Error(`Storage DELETE failed (${res.status})`);
      }
    },
  };
}

export function storageFromEnv(
  env: Record<string, string | undefined> = process.env,
) {
  const bucket = env.DOCUMENT_STORAGE_BUCKET?.trim();
  const accessKeyId = env.DOCUMENT_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.DOCUMENT_STORAGE_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  const method = env.DOCUMENT_STORAGE_UPLOAD_METHOD?.trim().toUpperCase();
  if (method && method !== "POST" && method !== "PUT") {
    throw new Error("DOCUMENT_STORAGE_UPLOAD_METHOD must be post or put");
  }
  return s3Storage({
    bucket,
    accessKeyId,
    secretAccessKey,
    region: env.DOCUMENT_STORAGE_REGION?.trim() || "us-east-1",
    endpoint: env.DOCUMENT_STORAGE_ENDPOINT?.trim() || null,
    forcePathStyle: env.DOCUMENT_STORAGE_FORCE_PATH_STYLE === "true",
    uploadMethod: (method as UploadMethod | undefined) ?? "POST",
  });
}

const SIGNATURES: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d],
};

export function matchesSignature(contentType: string, start: Uint8Array) {
  const expected = SIGNATURES[contentType];
  return (
    !!expected &&
    start.length >= expected.length &&
    expected.every((b, i) => start[i] === b)
  );
}
