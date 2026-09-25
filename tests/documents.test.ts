import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Storage is replaced with mocks. The bytes never reach the Next server in
 * real life either — the browser talks to the bucket through a signed URL — so
 * here the question is only what the service records and asserts, not what the
 * bucket does. `StorageError` is kept real because the service branches on it.
 */
const store = vi.hoisted(() => ({
  signedUpload: vi.fn(async () => "https://bucket.example/upload?sig=1"),
  signedDownload: vi.fn(async () => "https://bucket.example/download?sig=1"),
  objectExists: vi.fn(
    async (): Promise<{ ok: boolean; size: number | null; contentType: string | null }> => ({
      ok: true,
      size: 2048,
      contentType: "application/pdf",
    }),
  ),
  deleteObject: vi.fn(async () => {}),
  storageConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  ...store,
}));

import { db } from "@/db";
import { activityLog, documents } from "@/db/schema";
import { createCustomer } from "@/services/client-service";
import {
  confirmDocumentUpload,
  deleteDocument,
  getDocumentDownloadUrl,
  listDocuments,
  requestDocumentUpload,
} from "@/services/document-service";
import { StorageError } from "@/lib/storage";
import { actingAs, resetData, seedCatalogue, seedStaff, type StaffFixtures } from "./helpers";

/** Runs request → browser PUT (mocked) → confirm, returning the document id. */
async function attach(customerId: string, filename = "Passport.pdf") {
  const requested = await requestDocumentUpload({ customerId, filename, contentType: "application/pdf", sizeBytes: 1000 });
  await confirmDocumentUpload({ documentId: requested.documentId });
  return requested.documentId;
}

describe("attaching documents to a client", () => {
  let staff: StaffFixtures;

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    store.signedUpload.mockClear();
    store.objectExists.mockClear();
    store.deleteObject.mockClear();
    store.storageConfigured.mockReturnValue(true);
  });

  it("mints an upload URL and writes a pending row that is not yet listed", async () => {
    actingAs(staff.rm);
    const client = await createCustomer({ firstName: "Meera", customerSince: "2026-01-01" });

    const requested = await requestDocumentUpload({
      customerId: client.id,
      filename: "Itinerary.pdf",
      contentType: "application/pdf",
      sizeBytes: 500,
    });

    expect(requested.uploadUrl).toContain("upload");
    expect(store.signedUpload).toHaveBeenCalledOnce();

    const pending = await db.query.documents.findFirst({ where: eq(documents.id, requested.documentId) });
    expect(pending?.storedAt).toBeNull();
    // Pending uploads are invisible until confirmed.
    expect(await listDocuments(client.id)).toHaveLength(0);
  });

  it("marks the document stored once the object is confirmed, and logs it", async () => {
    actingAs(staff.rm);
    const client = await createCustomer({ firstName: "Aryan", customerSince: "2026-01-01" });
    const id = await attach(client.id);

    const row = await db.query.documents.findFirst({ where: eq(documents.id, id) });
    expect(row?.storedAt).not.toBeNull();
    // The size is read back off storage, not trusted from the request.
    expect(row?.sizeBytes).toBe(2048);

    const listed = await listDocuments(client.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.filename).toBe("Passport.pdf");

    const logs = await db.select().from(activityLog).where(eq(activityLog.customerId, client.id));
    expect(logs.some((l) => l.summary?.includes("Document added: Passport.pdf"))).toBe(true);
  });

  it("drops the pending row and refuses when the upload never landed", async () => {
    actingAs(staff.rm);
    const client = await createCustomer({ firstName: "Goyal", customerSince: "2026-01-01" });
    const requested = await requestDocumentUpload({
      customerId: client.id,
      filename: "Visa.pdf",
      contentType: "application/pdf",
      sizeBytes: 400,
    });

    store.objectExists.mockResolvedValueOnce({ ok: false, size: null, contentType: null });
    await expect(confirmDocumentUpload({ documentId: requested.documentId })).rejects.toThrow(/did not complete/i);

    const gone = await db.query.documents.findFirst({ where: eq(documents.id, requested.documentId) });
    expect(gone).toBeUndefined();
  });

  it("gives a signed download URL for a stored document", async () => {
    actingAs(staff.rm);
    const client = await createCustomer({ firstName: "Nadia", customerSince: "2026-01-01" });
    const id = await attach(client.id);

    const url = await getDocumentDownloadUrl({ documentId: id });
    expect(url).toContain("download");
    expect(store.signedDownload).toHaveBeenCalledWith(expect.stringContaining(`clients/${client.id}/`), "Passport.pdf");
  });

  it("deletes the object and the row, and logs the removal", async () => {
    actingAs(staff.rm);
    const client = await createCustomer({ firstName: "Kabir", customerSince: "2026-01-01" });
    const id = await attach(client.id);

    await deleteDocument({ documentId: id });

    expect(store.deleteObject).toHaveBeenCalledOnce();
    expect(await listDocuments(client.id)).toHaveLength(0);
    const logs = await db.select().from(activityLog).where(eq(activityLog.customerId, client.id));
    expect(logs.some((l) => l.summary?.includes("Document removed"))).toBe(true);
  });

  it("removes the row even when storage cannot be reached", async () => {
    actingAs(staff.rm);
    const client = await createCustomer({ firstName: "Ismail", customerSince: "2026-01-01" });
    const id = await attach(client.id);

    store.deleteObject.mockRejectedValueOnce(new StorageError("bucket down"));
    await deleteDocument({ documentId: id });

    expect(await listDocuments(client.id)).toHaveLength(0);
  });

  it("refuses an upload from someone without document.manage", async () => {
    actingAs(staff.rm);
    const client = await createCustomer({ firstName: "Priya", customerSince: "2026-01-01" });

    actingAs(staff.viewer);
    await expect(
      requestDocumentUpload({ customerId: client.id, filename: "x.pdf", contentType: "application/pdf", sizeBytes: 100 }),
    ).rejects.toThrow();
  });

  it("refuses an upload when storage is not configured", async () => {
    actingAs(staff.rm);
    const client = await createCustomer({ firstName: "Rhea", customerSince: "2026-01-01" });

    store.storageConfigured.mockReturnValue(false);
    await expect(
      requestDocumentUpload({ customerId: client.id, filename: "x.pdf", contentType: "application/pdf", sizeBytes: 100 }),
    ).rejects.toThrow(/not set up/i);
  });

  it("rejects a file over the 25 MB ceiling", async () => {
    actingAs(staff.rm);
    const client = await createCustomer({ firstName: "Dev", customerSince: "2026-01-01" });
    await expect(
      requestDocumentUpload({
        customerId: client.id,
        filename: "big.mov",
        contentType: "video/quicktime",
        sizeBytes: 26 * 1024 * 1024,
      }),
    ).rejects.toThrow();
  });
});
