import {
  checkImage,
  problemFromError,
  UploadFailure,
  uploadBody,
} from "@/lib/upload";

const limits = { minBytes: 100, maxBytes: 5_000_000 };

describe("attachment checks before upload", () => {
  it("accepts JPEG and PNG by declared type", () => {
    expect(checkImage("photo.bin", "image/jpeg", 2000, limits)).toEqual({
      ok: true,
      contentType: "image/jpeg",
      size: 2000,
    });
    expect(checkImage("photo.bin", "IMAGE/JPG", 2000, limits)).toEqual({
      ok: true,
      contentType: "image/jpeg",
      size: 2000,
    });
    expect(checkImage("photo.bin", "image/png", 2000, limits)).toEqual({
      ok: true,
      contentType: "image/png",
      size: 2000,
    });
  });

  it("falls back to the extension only when no type is given", () => {
    expect(checkImage("a.JPEG", null, 2000, limits)).toMatchObject({
      ok: true,
      contentType: "image/jpeg",
    });
    expect(checkImage("a.png", "", 2000, limits)).toMatchObject({
      ok: true,
      contentType: "image/png",
    });
    expect(checkImage("a.png", "application/pdf", 2000, limits)).toEqual({
      ok: false,
      reason: "badType",
    });
  });

  it("rejects other formats", () => {
    for (const [name, type] of [
      ["a.pdf", "application/pdf"],
      ["a.gif", "image/gif"],
      ["a.heic", "image/heic"],
      ["a.svg", "image/svg+xml"],
      ["noextension", null],
    ] as const) {
      expect(checkImage(name, type, 2000, limits)).toEqual({
        ok: false,
        reason: "badType",
      });
    }
  });

  it("rejects empty and oversized files", () => {
    expect(checkImage("a.png", "image/png", 0, limits)).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(checkImage("a.png", "image/png", null, limits)).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(checkImage("a.png", "image/png", 99, limits)).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(checkImage("a.png", "image/png", 5_000_001, limits)).toEqual({
      ok: false,
      reason: "tooLarge",
    });
    expect(checkImage("a.png", "image/png", 5_000_000, limits)).toMatchObject({
      ok: true,
    });
  });
});

describe("upload failure wording", () => {
  it("separates storage refusals from transfer failures", () => {
    expect(problemFromError(new UploadFailure("STORAGE_REFUSED", 403))).toBe(
      "refused",
    );
    expect(problemFromError(new UploadFailure("UPLOAD_FAILED", 500))).toBe(
      "failed",
    );
    expect(problemFromError(new UploadFailure("UPLOAD_ABORTED", 0))).toBe(
      "failed",
    );
  });

  it("maps server codes", () => {
    expect(problemFromError({ code: "STORAGE_NOT_CONFIGURED" })).toBe(
      "unavailable",
    );
    expect(problemFromError({ code: "ATTACHMENT_LIMIT" })).toBe("limit");
    expect(problemFromError({ code: "FILE_REJECTED" })).toBe("rejected");
    expect(problemFromError({ code: "INTERNAL_ERROR" })).toBe("failed");
    expect(problemFromError(null)).toBe("failed");
    expect(problemFromError("boom")).toBe("failed");
  });
});

describe("upload request body", () => {
  const file = {
    uri: "file:///photo.png",
    name: "photo.png",
    contentType: "image/png",
  };

  it("sends the signed headers for PUT targets without content-length", () => {
    const blob = new Blob(["x"]);
    const { headers, body } = uploadBody(
      {
        method: "PUT",
        url: "https://storage.test/put",
        headers: { "content-type": "image/png", "content-length": "1" },
        expiresAt: "2026-01-01T00:00:00.000Z",
      },
      file,
      blob,
    );
    expect(headers).toEqual({ "content-type": "image/png" });
    expect(body).toBe(blob);
  });

  it("puts the policy fields before the file for POST targets", () => {
    const { headers, body } = uploadBody(
      {
        method: "POST",
        url: "https://storage.test/post",
        fields: { key: "k", policy: "p" },
        expiresAt: "2026-01-01T00:00:00.000Z",
      },
      file,
      new Blob(["x"]),
    );
    expect(headers).toEqual({});
    const names = [...(body as FormData).keys()];
    expect(names).toEqual(["key", "policy", "file"]);
  });
});
