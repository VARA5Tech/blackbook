"use server";

import { revalidatePath } from "next/cache";
import type { ClientDnaInput } from "@/domain/customers";
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
} from "@/domain/customers";
import {
  archiveCustomer,
  createCustomer,
  closeClientReplay,
  getClientActivity,
  openClientReplay,
  reassignClients,
  restoreCustomer,
  updateClientDna,
  updateCustomer,
  type ReassignInput,
} from "@/services/client-service";
import type {
  AcknowledgeLeadInput,
  AdvanceLeadInput,
  AssignLeadInput,
  CreateLeadInput,
  RemarkLeadInput,
} from "@/domain/leads";
import {
  applyTernImport,
  populateTripFromTern,
  previewTernAgainst,
  previewTernClient,
  previewTernTrip,
  revealTravelDocument,
  searchTern,
  ternStatus,
  type TernImportInput,
} from "@/services/tern-service";
import {
  confirmDocumentUpload,
  deleteDocument,
  getDocumentDownloadUrl,
  requestDocumentUpload,
} from "@/services/document-service";
import { run } from "./action-result";

export async function createClientAction(input: CreateCustomerInput) {
  const result = await run(() => createCustomer(input));
  if (result.ok) {
    revalidatePath("/clients");
    revalidatePath("/");
  }
  return result.ok
    ? { ok: true as const, data: { id: result.data.id, ref: result.data.ref } }
    : result;
}

export async function updateClientAction(input: UpdateCustomerInput) {
  const result = await run(() => updateCustomer(input));
  if (result.ok) {
    revalidatePath(`/clients/${input.id}`);
    revalidatePath("/clients");
  }
  return result.ok ? { ok: true as const, data: undefined } : result;
}

export async function updateClientDnaAction(input: ClientDnaInput) {
  const result = await run(() => updateClientDna(input));
  if (result.ok) revalidatePath(`/clients/${input.customerId}`);
  return result.ok ? { ok: true as const, data: undefined } : result;
}

/**
 * Opens one recording, and closes it again.
 *
 * Server actions rather than routes, so the capability check stays in the
 * service layer where every other read already lives. The close path is also
 * reachable at `/api/replay/close`, which is the only shape `sendBeacon` can
 * use when a tab is shut mid-recording.
 */
export async function openReplayAction(customerId: string, sessionId: string) {
  return run(() => openClientReplay(customerId, sessionId));
}

/** Everything one client has done on the members' site, for the visits list. */
export async function clientActivityAction(customerId: string) {
  return run(() => getClientActivity(customerId));
}

export async function closeReplayAction(sessionId: string) {
  return run(async () => {
    await closeClientReplay(sessionId);
    return null;
  });
}

export async function archiveClientAction(customerId: string) {
  const result = await run(() => archiveCustomer(customerId));
  if (result.ok) {
    revalidatePath(`/clients/${customerId}`);
    revalidatePath("/clients");
  }
  return result.ok ? { ok: true as const, data: undefined } : result;
}

export async function restoreClientAction(customerId: string) {
  const result = await run(() => restoreCustomer(customerId));
  if (result.ok) {
    revalidatePath(`/clients/${customerId}`);
    revalidatePath("/clients");
  }
  return result.ok ? { ok: true as const, data: undefined } : result;
}

/**
 * Moves the selected clients to one relationship manager.
 *
 * Revalidates the list and each record it touched, so the rows the reader is
 * looking at show the new manager rather than the one they just changed.
 */
export async function reassignClientsAction(input: ReassignInput) {
  const result = await run(() => reassignClients(input));

  if (result.ok) {
    revalidatePath("/clients");
    for (const id of input.customerIds) revalidatePath(`/clients/${id}`);
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Leads                                                               */
/* ------------------------------------------------------------------ */

export async function acknowledgeLeadAction(input: AcknowledgeLeadInput) {
  const result = await run(async () => {
    const { acknowledgeLead } = await import("@/services/lead-service");
    return acknowledgeLead(input);
  });
  if (result.ok) revalidateLead();
  return result;
}

export async function advanceLeadAction(input: AdvanceLeadInput) {
  const result = await run(async () => {
    const { advanceLead } = await import("@/services/lead-service");
    return advanceLead(input);
  });
  if (result.ok) revalidateLead();
  return result;
}

export async function assignLeadAction(input: AssignLeadInput) {
  const result = await run(async () => {
    const { assignLead } = await import("@/services/lead-service");
    return assignLead(input);
  });
  if (result.ok) revalidateLead();
  return result;
}

export async function createLeadAction(input: CreateLeadInput) {
  const result = await run(async () => {
    const { createLead } = await import("@/services/lead-service");
    return createLead(input);
  });
  if (result.ok) revalidateLead();
  return result;
}

export async function remarkLeadAction(input: RemarkLeadInput) {
  const result = await run(async () => {
    const { remarkOnLead } = await import("@/services/lead-service");
    return remarkOnLead(input);
  });
  if (result.ok) revalidateLead();
  return result;
}

/**
 * A lead shows on the client, in the queue on the dashboard and in the task
 * list, so any change to one has to clear all three.
 */
function revalidateLead() {
  revalidatePath("/");
  revalidatePath("/clients", "layout");
  revalidatePath("/tasks");
}

/* ------------------------------------------------------------------ */
/* Tern                                                                */
/* ------------------------------------------------------------------ */

/**
 * Tern import runs from a page, a step at a time — search, preview, import,
 * then each trip in turn — so a client with twenty trips is never one request
 * that times out halfway, and the screen shows how far it has got.
 */
export async function ternStatusAction() {
  return run(() => ternStatus());
}

export async function searchTernAction(query: string) {
  return run(() => searchTern(query));
}

/** What an import would do, before anything is written. */
export async function previewTernClientAction(input: { ternId: string; customerId?: string }) {
  return run(() => previewTernClient(input));
}

/** The same preview, against a client the desk has just said is this person. */
export async function previewTernAgainstAction(input: { ternId: string; customerId: string }) {
  return run(() => previewTernAgainst(input));
}

/** One trip from Tern, shown and not stored: opening a trip in the preview. */
export async function previewTernTripAction(input: { ternId: string }) {
  return run(() => previewTernTrip(input));
}

/** Writes exactly what was ticked in the preview. Trips follow, a few at a time. */
export async function applyTernImportAction(input: TernImportInput) {
  const result = await run(() => applyTernImport(input));
  if (result.ok) revalidatePath("/clients");
  return result;
}

export async function populateTripFromTernAction(input: { ternId: string; customerId: string }) {
  return run(() => populateTripFromTern(input));
}

/** Called once after the last trip, so the page redraws once rather than per trip. */
export async function finishTernPopulateAction(customerId: string) {
  revalidatePath(`/clients/${customerId}`);
  return { ok: true as const, data: undefined };
}

export async function revealTravelDocumentAction(input: { customerId: string; index: number }) {
  return run(() => revealTravelDocument(input));
}

/* ------------------------------------------------------------------ */
/* Documents                                                          */
/* ------------------------------------------------------------------ */

/**
 * Upload is two steps: ask for a signed URL and a pending record, then confirm
 * once the browser has put the file to storage. The bytes never pass through
 * the server — only the key and the metadata do.
 */
export async function requestDocumentUploadAction(input: {
  customerId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  kind?: string;
  tripId?: string;
}) {
  return run(() => requestDocumentUpload(input));
}

export async function confirmDocumentUploadAction(input: { documentId: string; customerId: string }) {
  const result = await run(() => confirmDocumentUpload({ documentId: input.documentId }));
  if (result.ok) revalidatePath(`/clients/${input.customerId}`);
  return result;
}

export async function documentDownloadUrlAction(input: { documentId: string }) {
  return run(() => getDocumentDownloadUrl(input));
}

export async function deleteDocumentAction(input: { documentId: string; customerId: string }) {
  const result = await run(() => deleteDocument({ documentId: input.documentId }));
  if (result.ok) revalidatePath(`/clients/${input.customerId}`);
  return result;
}
