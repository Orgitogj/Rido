import {
  APPLICATION_STATUS,
  checkFile,
  currentDocument,
  DOCUMENT_LABELS,
  isIsoDate,
  needsExpiry,
  uploadRequest,
  uploadToStorage,
} from "@/lib/driverVerification";
import {
  documentKinds,
  driverApplicationStatuses,
  type DriverDocumentView,
} from "@/shared/contracts";

const doc = (
  id: string,
  status: DriverDocumentView["status"],
): DriverDocumentView => ({
  id,
  kind: "insurance",
  status,
  contentType: "application/pdf",
  sizeBytes: 1000,
  expiresOn: "2030-01-01",
  uploadedAt: null,
  reviewNote: null,
});

describe("driver verification helpers", () => {
  it("labels every status and document kind without claiming automated checks", () => {
    for (const s of driverApplicationStatuses) {
      expect(APPLICATION_STATUS[s].title).toBeTruthy();
      expect(APPLICATION_STATUS[s].body).not.toMatch(/automatic/i);
    }
    for (const k of documentKinds) expect(DOCUMENT_LABELS[k]).toBeTruthy();
    expect(needsExpiry("identity")).toBe(false);
    expect(needsExpiry("insurance")).toBe(true);
  });

  it("checks type and size before asking for an upload", () => {
    expect(checkFile("scan.PDF", null, 5000)).toEqual({
      ok: true,
      contentType: "application/pdf",
      size: 5000,
    });
    expect(checkFile("photo", "image/png", 5000)).toMatchObject({
      ok: true,
      contentType: "image/png",
    });
    expect(checkFile("photo.heic", "image/heic", 5000).ok).toBe(false);
    expect(checkFile("scan.pdf", null, 20).ok).toBe(false);
    expect(checkFile("scan.pdf", null, 11 * 1024 * 1024).ok).toBe(false);
    expect(checkFile("scan.pdf", null, undefined).ok).toBe(false);
  });

  it("validates calendar dates", () => {
    expect(isIsoDate("2027-02-28")).toBe(true);
    expect(isIsoDate("2027-02-30")).toBe(false);
    expect(isIsoDate("28/02/2027")).toBe(false);
  });

  it("prefers the open upload over the accepted one", () => {
    expect(currentDocument([doc("a", "accepted")], "insurance")?.id).toBe("a");
    expect(
      currentDocument([doc("a", "accepted"), doc("b", "uploaded")], "insurance")
        ?.id,
    ).toBe("b");
    expect(currentDocument([doc("a", "accepted")], "identity")).toBeNull();
  });

  it("builds a POST form with the signed policy fields before the file", () => {
    const ticket = {
      document: doc("a", "pending_upload"),
      upload: {
        method: "POST" as const,
        url: "https://bucket.example/",
        fields: {
          key: "driver-documents/uploads/p/1",
          "Content-Type": "application/pdf",
          policy: "cG9saWN5",
          "x-amz-signature": "abc",
        },
        expiresAt: "2030-01-01T00:00:00Z",
      },
    };
    const blob = new Blob(["%PDF-"], { type: "application/pdf" });
    const web = uploadRequest(
      ticket,
      { uri: "blob:x", name: "scan.pdf", contentType: "application/pdf" },
      blob,
    );
    expect(web.url).toBe("https://bucket.example/");
    expect(web.init.method).toBe("POST");
    const form = web.init.body as FormData;
    const names = [...(form as unknown as Iterable<[string, unknown]>)].map(
      ([name]) => name,
    );
    expect(names).toEqual([
      "key",
      "Content-Type",
      "policy",
      "x-amz-signature",
      "file",
    ]);
    expect(web.init.headers).toBeUndefined();

    const append = jest.spyOn(FormData.prototype, "append");
    uploadRequest(
      ticket,
      {
        uri: "file:///cache/scan.pdf",
        name: "scan.pdf",
        contentType: "application/pdf",
      },
      null,
    );
    expect(append).toHaveBeenLastCalledWith("file", {
      uri: "file:///cache/scan.pdf",
      name: "scan.pdf",
      type: "application/pdf",
    });
    append.mockRestore();
  });

  it("sends a PUT with the signed type and lets the platform set the length", async () => {
    const send = jest.fn(async () => new Response(null, { status: 200 }));
    await uploadToStorage(
      {
        document: doc("a", "pending_upload"),
        upload: {
          method: "PUT",
          url: "https://storage.test/put/key",
          headers: {
            "content-type": "application/pdf",
            "content-length": "1000",
          },
          expiresAt: "2030-01-01T00:00:00Z",
        },
      },
      {
        uri: "blob:x",
        name: "scan.pdf",
        contentType: "application/pdf",
        blob: new Blob(["x"]),
      },
      send as unknown as typeof fetch,
    );
    expect(send).toHaveBeenCalledWith(
      "https://storage.test/put/key",
      expect.objectContaining({
        method: "PUT",
        headers: { "content-type": "application/pdf" },
      }),
    );
    const refused = jest.fn(async () => new Response(null, { status: 400 }));
    await expect(
      uploadToStorage(
        {
          document: doc("a", "pending_upload"),
          upload: {
            method: "POST",
            url: "https://bucket.example/",
            fields: {},
            expiresAt: "2030-01-01T00:00:00Z",
          },
        },
        {
          uri: "blob:x",
          name: "scan.pdf",
          contentType: "application/pdf",
          blob: new Blob(["x"]),
        },
        refused as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/refused this file/);
  });
});
