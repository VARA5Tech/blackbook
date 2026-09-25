import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers, documents } from "@/db/schema";
import { requireCapability } from "@/auth/session";
import { uuidSchema } from "@/domain/shared";
import { logger } from "@/lib/logger";
import {
  deleteObject,
  objectExists,
  signedDownload,
  signedUpload,
  storageConfigured,
  StorageError,
} from "@/lib/storage";
import { logActivity } from "./activity-service";
import { DomainError } from "./client-service";

/**
 * Files kept beside a client: scans, itineraries, whatever the desk attaches.
 *
 * The bytes never touch the Next server. Uploading is two steps — Blackbook
 * mints a short-lived signed URL and writes a pending record, the browser puts
 * the file straight to storage, then a confirm marks the record stored. A
 * download is one signed URL the browser follows. The server only ever holds
 * the key and the metadata.
 *
 * Optional: with storage unconfigured `documentsEnabled()` is false and the
 * document card never appears.
 */

export const documentsEnabled = storageConfigured;

/** A safe object key: the client's id namespaces it, a random id keeps it unique. */
function keyFor(customerId: string, filename: string): string {
  const ext = filename.includes(".") ? "." + filename.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) : "";
  return `clients/${customerId}/${crypto.randomUUID()}${ext}`;
}

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB: a scan or a PDF, not a video.

const requestSchema = z.object({
  customerId: uuidSchema,
  tripId: uuidSchema.optional(),
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().min(1).max(MAX_BYTES),
  kind: z.string().trim().max(40).optional(),
});

/**
 * Start an upload: a signed URL to PUT the file to, and a pending record.
 *
 * The record is written first, so a file in storage always has a row that
 * knows what it is. If the browser never confirms, the row stays pending and
 * is swept; it never shows as a real document.
 */
export async function requestDocumentUpload(input: z.input<typeof requestSchema>) {
  const actor = await requireCapability("document.manage");
  if (!storageConfigured()) throw new DomainError("Document storage is not set up.");
  const data = requestSchema.parse(input);

  const client = await db.query.customers.findFirst({ where: eq(customers.id, data.customerId), columns: { id: true } });
  if (!client) throw new DomainError("Client not found.");

  const storageKey = keyFor(data.customerId, data.filename);
  const [row] = await db
    .insert(documents)
    .values({
      customerId: data.customerId,
      tripId: data.tripId ?? null,
      storageKey,
      filename: data.filename,
      contentType: data.contentType,
      sizeBytes: data.sizeBytes,
      kind: data.kind ?? null,
      source: "upload",
      createdBy: actor.id,
    })
    .returning({ id: documents.id });

  const uploadUrl = await signedUpload(storageKey, data.contentType);
  return { documentId: row.id, uploadUrl };
}

/**
 * Confirm the browser's upload landed, and make the document real.
 *
 * Reads the object back rather than trusting the browser: a row is marked
 * stored only when the file is actually there, and the size is taken from
 * storage, not from what was claimed.
 */
export async function confirmDocumentUpload(input: { documentId: string }) {
  const actor = await requireCapability("document.manage");
  const id = uuidSchema.parse(input.documentId);

  const doc = await db.query.documents.findFirst({ where: eq(documents.id, id) });
  if (!doc) throw new DomainError("That document record is gone.");
  if (doc.storedAt) return { ok: true as const };

  const head = await objectExists(doc.storageKey);
  if (!head.ok) {
    // The upload did not land. Drop the pending row so nothing dangles.
    await db.delete(documents).where(eq(documents.id, id));
    throw new DomainError("The upload did not complete. Try again.");
  }

  await db
    .update(documents)
    .set({ storedAt: new Date(), sizeBytes: head.size ?? doc.sizeBytes })
    .where(eq(documents.id, id));

  await logActivity({
    actor,
    entityType: "customer",
    entityId: doc.customerId,
    action: "created",
    customerId: doc.customerId,
    summary: `Document added: ${doc.filename}`,
  });
  return { ok: true as const };
}

/** A client's stored documents, newest first. Pending uploads are not shown. */
export async function listDocuments(customerId: string) {
  await requireCapability("client.read");
  const id = uuidSchema.parse(customerId);
  return db
    .select({
      id: documents.id,
      filename: documents.filename,
      contentType: documents.contentType,
      sizeBytes: documents.sizeBytes,
      kind: documents.kind,
      source: documents.source,
      tripId: documents.tripId,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(eq(documents.customerId, id), isNotNull(documents.storedAt)))
    .orderBy(desc(documents.createdAt));
}

/** A short-lived URL to download one document, saved under its real filename. */
export async function getDocumentDownloadUrl(input: { documentId: string }) {
  await requireCapability("client.read");
  const id = uuidSchema.parse(input.documentId);
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, id) });
  if (!doc || !doc.storedAt) throw new DomainError("That document is not available.");
  return signedDownload(doc.storageKey, doc.filename);
}

export async function deleteDocument(input: { documentId: string }) {
  const actor = await requireCapability("document.manage");
  const id = uuidSchema.parse(input.documentId);
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, id) });
  if (!doc) return { ok: true as const };

  try {
    await deleteObject(doc.storageKey);
  } catch (error) {
    // The row goes whether or not the object could be reached; a document the
    // desk deleted must not linger on screen because storage was briefly down.
    if (error instanceof StorageError) logger.warn("document.object_delete_failed", { documentId: id });
    else throw error;
  }
  await db.delete(documents).where(eq(documents.id, id));

  await logActivity({
    actor,
    entityType: "customer",
    entityId: doc.customerId,
    action: "archived",
    customerId: doc.customerId,
    summary: `Document removed: ${doc.filename}`,
  });
  return { ok: true as const };
}
