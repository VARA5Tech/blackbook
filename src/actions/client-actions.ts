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
