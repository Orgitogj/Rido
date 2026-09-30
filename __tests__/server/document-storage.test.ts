import { createHmac } from "node:crypto";

import { sweep } from "../../server/rides";
import {
  completeDocumentUpload,
  reopenDriverApplication,
  requestDocumentUpload,
  submitDriverApplication,
} from "../../server/routes/driver";
import {
  accessDriverDocument,
  decideDriverApplication,
  getDriverApplication,
} from "../../server/routes/verification";
import {
  presignPost,
  s3Storage,
  type S3Config,
  storageFromEnv,
} from "../../server/storage";
import {
  processStorageDeletions,
  purgeDriverDocuments,
} from "../../server/verification";

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
  dashboard,
  makeOperator,
} from "./scenario";

import type {
  AdminDriverDetail,
  DocumentKind,
  DocumentUploadTicket,
  DriverProfileView,
} from "../../shared/contracts";

const db = testDb();
let ctx: TestContext;

beforeEach(async () => {
  await resetDb(db);
  ctx = createContext(db);
});
afterEach(async () => {
  await assertInvariants(ctx);
  const { rows } = await db.query<{ storage_key: string; status: string }>(
    "SELECT storage_key, status FROM mobility.driver_documents WHERE storage_key IS NOT NULL",
  );
  for (const r of rows) {
    expect({
      key: r.storage_key,
      stored: ctx.storage.objects.has(r.storage_key),
    }).toEqual({ key: r.storage_key, stored: true });
  }
  const { rows: doomed } = await db.query(
    `SELECT s.key FROM mobility.storage_deletions s
       JOIN mobility.driver_documents d ON d.storage_key = s.key`,
  );
  expect(doomed).toEqual([]);
});
afterAll(() => db.end());

const A = "user_driver_a";
const OPS = "user_operator";
const DAY = 24 * 3600;

const pad = (head: number[], size = 400) => {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return bytes;
};
const PDF = pad([0x25, 0x50, 0x44, 0x46, 0x2d]);
const OTHER_PDF = pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x39, 0x39]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);

const day = (offset: number) =>
  new Date(ctx.clock.now.getTime() + offset * DAY * 1000)
    .toISOString()
    .slice(0, 10);

async function ticket(
  kind: DocumentKind = "identity",
  contentType = "application/pdf",
  sizeBytes = PDF.length,
) {
  const res = await call(ctx, requestDocumentUpload, {
    user: A,
    body: {
      kind,
      contentType,
      sizeBytes,
      expiresOn: kind === "identity" ? null : day(200),
    },
  });
  expect(res.status).toBe(201);
  return res.json.data as DocumentUploadTicket;
}

const complete = (id: string) =>
  call(ctx, completeDocumentUpload, {
    method: "POST",
    user: A,
    params: { id },
  });

const uploadKeyOf = (t: DocumentUploadTicket) =>
  t.upload.method === "POST"
    ? t.upload.fields.key
    : new URL(t.upload.url).pathname.replace(/^\/put\//, "");

async function row(id: string) {
  const { rows } = await db.query<{
    status: string;
    storage_key: string | null;
    upload_key: string | null;
  }>(
    "SELECT status, storage_key, upload_key FROM mobility.driver_documents WHERE id = $1",
    [id],
  );
  return rows[0];
}

async function profileOf() {
  return (await dashboard(ctx, A)).profile as DriverProfileView;
}

describe("upload keys cannot touch reviewed files", () => {
  it("reusing an upload link after confirmation doesn't change the reviewed file", async () => {
    await apply(ctx, A);
    const t = await ticket();
    ctx.storage.upload(t.upload, PDF, "application/pdf");
    expect((await complete(t.document.id)).status).toBe(200);
    const stored = await row(t.document.id);
    expect(stored.storage_key).not.toBe(stored.upload_key);
    expect(stored.storage_key).toMatch(/^driver-documents\/files\//);
    expect(stored.upload_key).toMatch(/^driver-documents\/uploads\//);
    expect(ctx.storage.objects.has(uploadKeyOf(t))).toBe(false);

    ctx.storage.upload(t.upload, OTHER_PDF, "application/pdf");
    expect((await complete(t.document.id)).status).toBe(200);
    expect(ctx.storage.objects.get(stored.storage_key!)!.bytes).toEqual(PDF);

    for (const kind of [
      "driving_license",
      "vehicle_registration",
      "insurance",
    ] as const) {
      const other = await ticket(kind);
      ctx.storage.upload(other.upload, PDF, "application/pdf");
      expect((await complete(other.document.id)).status).toBe(200);
    }
    expect(
      (await call(ctx, submitDriverApplication, { method: "POST", user: A }))
        .status,
    ).toBe(200);
    await makeOperator(ctx, OPS, "view,verify");
    const profileId = (await profileOf()).id;
    const access = await adminPost(
      ctx,
      OPS,
      accessDriverDocument,
      { id: profileId, documentId: t.document.id },
      {},
    );
    expect(ctx.storage.fetchView(access.json.data.url)).toEqual(PDF);

    advanceClock(ctx, 300 + 600 + 1);
    await sweep(ctx.deps);
    expect(ctx.storage.objects.has(uploadKeyOf(t))).toBe(false);
    expect(ctx.storage.objects.get(stored.storage_key!)!.bytes).toEqual(PDF);
  });

  it("removes a file re-uploaded through a link after the first try was rejected", async () => {
    await apply(ctx, A);
    const t = await ticket();
    ctx.storage.upload(t.upload, JPEG, "application/pdf");
    const rejected = await complete(t.document.id);
    expect(rejected.status).toBe(422);
    expect(ctx.storage.objects.has(uploadKeyOf(t))).toBe(false);

    ctx.storage.upload(t.upload, PDF, "application/pdf");
    expect((await complete(t.document.id)).status).toBe(409);
    expect(ctx.storage.objects.has(uploadKeyOf(t))).toBe(true);

    advanceClock(ctx, 300 + 600 + 1);
    await sweep(ctx.deps);
    expect(ctx.storage.objects.has(uploadKeyOf(t))).toBe(false);
    expect((await row(t.document.id)).status).toBe("deleted");
  });

  it("refuses a file that changes between the check and the copy, then accepts a clean retry", async () => {
    await apply(ctx, A);
    const t = await ticket();
    ctx.storage.upload(t.upload, PDF, "application/pdf");
    ctx.storage.hooks.beforeCopy = () => {
      ctx.storage.upload(t.upload, OTHER_PDF, "application/pdf");
    };
    const res = await complete(t.document.id);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("UPLOAD_CHANGED");
    expect((await row(t.document.id)).status).toBe("pending_upload");
    expect(
      [...ctx.storage.objects.keys()].some((k) => k.includes("/files/")),
    ).toBe(false);

    ctx.storage.hooks = {};
    const retry = await complete(t.document.id);
    expect(retry.status).toBe(200);
    const stored = await row(t.document.id);
    expect(ctx.storage.objects.get(stored.storage_key!)!.bytes).toEqual(
      OTHER_PDF,
    );
  });

  it("refuses a file that changes between the size check and the content check", async () => {
    await apply(ctx, A);
    const t = await ticket();
    ctx.storage.upload(t.upload, PDF, "application/pdf");
    ctx.storage.hooks.afterHead = (key) => {
      if (key === uploadKeyOf(t))
        ctx.storage.upload(t.upload, JPEG, "application/pdf");
    };
    const res = await complete(t.document.id);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("UPLOAD_CHANGED");
    ctx.storage.hooks = {};
    expect((await complete(t.document.id)).status).toBe(422);
  });

  it("catches a size mismatch after upload when the bucket only has a PUT link", async () => {
    ctx.storage.uploadMethod = "PUT";
    await apply(ctx, A);
    const t = await ticket();
    expect(t.upload.method).toBe("PUT");
    const oversized = pad([0x25, 0x50, 0x44, 0x46, 0x2d], 11 * 1024 * 1024);
    ctx.storage.upload(t.upload, oversized, "application/pdf");
    const res = await complete(t.document.id);
    expect(res.status).toBe(422);
    expect(ctx.storage.objects.has(uploadKeyOf(t))).toBe(false);
    expect((await profileOf()).documents).toEqual([]);
  });
});

describe("replacement and cleanup never remove the current file", () => {
  it("a replacement started during confirmation wins, and the orphaned copy is removed", async () => {
    await apply(ctx, A);
    const t = await ticket();
    ctx.storage.upload(t.upload, PDF, "application/pdf");
    let second: DocumentUploadTicket | null = null;
    ctx.storage.hooks.beforeCopy = async () => {
      ctx.storage.hooks = {};
      second = await ticket();
    };
    const res = await complete(t.document.id);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("UPLOAD_CLOSED");
    expect((await row(t.document.id)).status).toBe("deleted");
    await processStorageDeletions({
      db: ctx.db,
      storage: ctx.storage,
      now: ctx.deps.now,
    });
    expect(
      [...ctx.storage.objects.keys()].some((k) => k.includes("/files/")),
    ).toBe(false);

    ctx.storage.upload(second!.upload, PDF, "application/pdf");
    expect((await complete(second!.document.id)).status).toBe(200);
  });

  it("cleanup of an abandoned upload that is being confirmed doesn't leave a live row without a file", async () => {
    await apply(ctx, A);
    const t = await ticket();
    ctx.storage.upload(t.upload, PDF, "application/pdf");
    advanceClock(ctx, 25 * 3600);
    ctx.storage.hooks.beforeCopy = async () => {
      ctx.storage.hooks = {};
      expect(await purgeDriverDocuments(ctx.deps)).toBe(1);
    };
    const res = await complete(t.document.id);
    expect(res.status).toBe(409);
    expect((await row(t.document.id)).status).toBe("deleted");
    await sweep(ctx.deps);
    expect(
      [...ctx.storage.objects.keys()].some((k) => k.includes("/files/")),
    ).toBe(false);
  });

  it("a deletion job that runs during confirmation makes the confirmation fail instead of pointing at a missing file", async () => {
    await apply(ctx, A);
    const t = await ticket();
    ctx.storage.upload(t.upload, PDF, "application/pdf");
    ctx.storage.hooks.afterHead = async (key) => {
      if (!key.includes("/files/")) return;
      ctx.storage.hooks = {};
      advanceClock(ctx, 2 * 3600);
      await processStorageDeletions({
        db: ctx.db,
        storage: ctx.storage,
        now: ctx.deps.now,
      });
    };
    const res = await complete(t.document.id);
    expect(res.status).toBe(409);
    expect((await row(t.document.id)).status).toBe("pending_upload");
  });

  it("the deletion worker skips any key that belongs to a live document", async () => {
    await apply(ctx, A);
    const t = await ticket();
    ctx.storage.upload(t.upload, PDF, "application/pdf");
    await complete(t.document.id);
    const { storage_key } = await row(t.document.id);
    await db.query(
      "INSERT INTO mobility.storage_deletions (key, not_before, created_at) VALUES ($1, $2, $2)",
      [storage_key, ctx.clock.now],
    );
    await processStorageDeletions({
      db: ctx.db,
      storage: ctx.storage,
      now: ctx.deps.now,
    });
    expect(ctx.storage.objects.has(storage_key!)).toBe(true);
    const { rows } = await db.query(
      "SELECT 1 FROM mobility.storage_deletions WHERE key = $1",
      [storage_key],
    );
    expect(rows).toEqual([]);
  });

  it("a reopened application keeps its files even if cleanup was due", async () => {
    await apply(ctx, A);
    for (const kind of [
      "identity",
      "driving_license",
      "vehicle_registration",
      "insurance",
    ] as const) {
      const t = await ticket(kind);
      ctx.storage.upload(t.upload, PDF, "application/pdf");
      expect((await complete(t.document.id)).status).toBe(200);
    }
    await call(ctx, submitDriverApplication, { method: "POST", user: A });
    await makeOperator(ctx, OPS, "view,verify");
    const profileId = (await profileOf()).id;
    const d = (
      await adminGet(ctx, OPS, getDriverApplication, {
        params: { id: profileId },
      })
    ).json.data as AdminDriverDetail;
    await adminPost(
      ctx,
      OPS,
      decideDriverApplication,
      { id: profileId },
      {
        action: "reject",
        reason: "Not eligible",
        applicantMessage: "We can't approve this application.",
        expectedVersion: d.version,
      },
    );
    advanceClock(ctx, 91 * DAY);
    const results = await Promise.all([
      call(ctx, reopenDriverApplication, { method: "POST", user: A }),
      purgeDriverDocuments(ctx.deps),
    ]);
    expect(results[0].status).toBe(200);
    const docs = await db.query<{ status: string }>(
      "SELECT status FROM mobility.driver_documents WHERE driver_profile_id = $1",
      [profileId],
    );
    const statuses = new Set(docs.rows.map((r) => r.status));
    expect(
      [...statuses].every((s) => s === "deleted" || s === "uploaded"),
    ).toBe(true);
  });
});

describe("view links", () => {
  it("stop working once a replaced file is purged, and are not issued for replaced files", async () => {
    await apply(ctx, A);
    const first = await ticket();
    ctx.storage.upload(first.upload, PDF, "application/pdf");
    await complete(first.document.id);
    await makeOperator(ctx, OPS, "view,verify");
    const profileId = (await profileOf()).id;
    const link = await adminPost(
      ctx,
      OPS,
      accessDriverDocument,
      { id: profileId, documentId: first.document.id },
      {},
    );
    expect(ctx.storage.fetchView(link.json.data.url)).toEqual(PDF);

    const second = await ticket();
    ctx.storage.upload(second.upload, OTHER_PDF, "application/pdf");
    await complete(second.document.id);
    const again = await adminPost(
      ctx,
      OPS,
      accessDriverDocument,
      { id: profileId, documentId: first.document.id },
      {},
    );
    expect(again.status).toBe(404);

    advanceClock(ctx, 31 * DAY);
    await sweep(ctx.deps);
    expect(ctx.storage.fetchView(link.json.data.url)).toBeNull();
  });
});

const config: S3Config = {
  bucket: "docs",
  region: "eu-central-1",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret-example",
  endpoint: null,
  forcePathStyle: false,
};

const derive = (secret: string, dayStamp: string, region: string) =>
  ["aws4_request"].reduce(
    (key, part) => createHmac("sha256", key).update(part).digest(),
    [dayStamp, region, "s3"].reduce<Buffer>(
      (key, part) => createHmac("sha256", key).update(part).digest(),
      Buffer.from(`AWS4${secret}`),
    ),
  );

describe("signed upload policy", () => {
  it("limits a POST upload to one key, one content type and the exact declared size", () => {
    const now = new Date("2026-03-01T10:00:00Z");
    const target = presignPost(config, {
      key: "driver-documents/uploads/p/1",
      contentType: "application/pdf",
      sizeBytes: 4321,
      expiresSeconds: 300,
      now,
    });
    expect(target.url).toBe("https://docs.s3.eu-central-1.amazonaws.com/");
    const policy = JSON.parse(
      Buffer.from(target.fields.policy, "base64").toString("utf8"),
    );
    expect(policy.expiration).toBe("2026-03-01T10:05:00.000Z");
    expect(policy.conditions).toEqual([
      { bucket: "docs" },
      ["eq", "$key", "driver-documents/uploads/p/1"],
      ["eq", "$Content-Type", "application/pdf"],
      ["content-length-range", 4321, 4321],
      { "x-amz-algorithm": "AWS4-HMAC-SHA256" },
      {
        "x-amz-credential": "AKIDEXAMPLE/20260301/eu-central-1/s3/aws4_request",
      },
      { "x-amz-date": "20260301T100000Z" },
    ]);
    expect(target.fields).toMatchObject({
      key: "driver-documents/uploads/p/1",
      "Content-Type": "application/pdf",
      "x-amz-date": "20260301T100000Z",
    });
    const expected = createHmac(
      "sha256",
      derive("secret-example", "20260301", "eu-central-1"),
    )
      .update(target.fields.policy)
      .digest("hex");
    expect(target.fields["x-amz-signature"]).toBe(expected);

    const pathStyle = presignPost(
      {
        ...config,
        endpoint: "http://127.0.0.1:9000",
        forcePathStyle: true,
      },
      {
        key: "k",
        contentType: "image/png",
        sizeBytes: 200,
        expiresSeconds: 300,
        now,
      },
    );
    expect(pathStyle.url).toBe("http://127.0.0.1:9000/docs/");
  });

  it("chooses POST by default and PUT only when configured", () => {
    const env = {
      DOCUMENT_STORAGE_BUCKET: "docs",
      DOCUMENT_STORAGE_ACCESS_KEY_ID: "id",
      DOCUMENT_STORAGE_SECRET_ACCESS_KEY: "secret",
    };
    expect(storageFromEnv(env)!.uploadMethod).toBe("POST");
    const put = storageFromEnv({
      ...env,
      DOCUMENT_STORAGE_UPLOAD_METHOD: "put",
    })!;
    expect(put.uploadMethod).toBe("PUT");
    const target = put.presignUpload(
      "k",
      "image/jpeg",
      500,
      300,
      new Date("2026-03-01T10:00:00Z"),
    );
    expect(target.method).toBe("PUT");
    expect(target.url).toContain(
      "X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost",
    );
    expect(() =>
      storageFromEnv({ ...env, DOCUMENT_STORAGE_UPLOAD_METHOD: "patch" }),
    ).toThrow(/post or put/);
  });
});

describe("storage client requests", () => {
  const recorder = (respond: (url: string, init: RequestInit) => Response) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init);
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };
  const now = new Date("2026-03-01T10:00:00Z");
  const signed = (url: string) =>
    new URL(url).searchParams.get("X-Amz-SignedHeaders")!.split(";");

  it("pins the copy to the verified version with signed copy headers", async () => {
    const { calls, fetchImpl } = recorder(
      () => new Response("<CopyObjectResult/>", { status: 200 }),
    );
    const storage = s3Storage(config, fetchImpl);
    expect(await storage.copy("uploads/a", "files/b", '"abc"', now)).toBe(true);
    expect(calls[0].init.method).toBe("PUT");
    expect(new URL(calls[0].url).pathname).toBe("/files/b");
    expect(signed(calls[0].url)).toEqual([
      "host",
      "x-amz-copy-source",
      "x-amz-copy-source-if-match",
      "x-amz-metadata-directive",
    ]);
    expect(calls[0].init.headers).toMatchObject({
      "x-amz-copy-source": "/docs/uploads/a",
      "x-amz-copy-source-if-match": '"abc"',
    });
  });

  it("treats a precondition failure, even inside a 200 response, as a changed file", async () => {
    const precondition = s3Storage(
      config,
      recorder(() => new Response("", { status: 412 })).fetchImpl,
    );
    expect(await precondition.copy("a", "b", '"x"', now)).toBe(false);
    const embedded = s3Storage(
      config,
      recorder(
        () =>
          new Response("<Error><Code>PreconditionFailed</Code></Error>", {
            status: 200,
          }),
      ).fetchImpl,
    );
    expect(await embedded.copy("a", "b", '"x"', now)).toBe(false);
    const broken = s3Storage(
      config,
      recorder(
        () =>
          new Response("<Error><Code>InternalError</Code></Error>", {
            status: 200,
          }),
      ).fetchImpl,
    );
    await expect(broken.copy("a", "b", '"x"', now)).rejects.toThrow(/COPY/);
  });

  it("reads the start of the file only if it is still the checked version", async () => {
    const { calls, fetchImpl } = recorder(
      () => new Response(new Uint8Array([1, 2, 3]), { status: 206 }),
    );
    const storage = s3Storage(config, fetchImpl);
    expect(await storage.readStart("k", 8, '"e1"', now)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(signed(calls[0].url)).toContain("if-match");
    expect(calls[0].init.headers).toMatchObject({
      "if-match": '"e1"',
      range: "bytes=0-7",
    });
    const changed = s3Storage(
      config,
      recorder(() => new Response("", { status: 412 })).fetchImpl,
    );
    expect(await changed.readStart("k", 8, '"e1"', now)).toBeNull();
  });

  it("returns the object's ETag from HEAD", async () => {
    const storage = s3Storage(
      config,
      recorder(
        () =>
          new Response(null, {
            status: 200,
            headers: {
              "content-length": "400",
              "content-type": "application/pdf",
              etag: '"e9"',
            },
          }),
      ).fetchImpl,
    );
    expect(await storage.head("k", now)).toEqual({
      size: 400,
      contentType: "application/pdf",
      etag: '"e9"',
    });
  });
});
