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
  getClientReplay,
  restoreCustomer,
  updateClientDna,
  updateCustomer,
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
 * Hands one recording to the player in the browser.
 *
 * A server action rather than a route, so the capability check stays in the
 * service layer where every other read already lives.
 */
export async function loadReplayAction(customerId: string, sessionId: string) {
  return run(() => getClientReplay(customerId, sessionId));
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
