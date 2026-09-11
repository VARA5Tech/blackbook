"use server";

import { revalidatePath } from "next/cache";
import type {
  CreateHouseholdInput,
  HouseholdMemberInput,
  UpdateHouseholdInput,
} from "@/domain/households";
import type { CreateMilestoneInput } from "@/domain/milestones";
import {
  addHouseholdMember,
  createHousehold,
  removeHouseholdMember,
  updateHousehold,
} from "@/services/household-service";
import {
  archiveMilestone,
  createMilestone,
} from "@/services/milestone-service";
import {
  recordInteraction,
  type RecordInteractionInput,
} from "@/services/interaction-service";
import {
  createPreferenceOption,
  setPreferences,
  updatePreferenceProfile,
  type PreferenceProfileInput,
  type SetPreferencesInput,
} from "@/services/preference-service";
import { run } from "./action-result";

/* ---------------- households ---------------- */

export async function createHouseholdAction(input: CreateHouseholdInput) {
  const result = await run(() => createHousehold(input));
  if (result.ok) revalidatePath("/households");
  return result.ok
    ? { ok: true as const, data: { id: result.data.id, ref: result.data.ref } }
    : result;
}

export async function updateHouseholdAction(input: UpdateHouseholdInput) {
  const result = await run(() => updateHousehold(input));
  if (result.ok) {
    revalidatePath(`/households/${input.id}`);
    revalidatePath("/households");
  }
  return result.ok ? { ok: true as const, data: undefined } : result;
}

export async function addHouseholdMemberAction(input: HouseholdMemberInput) {
  const result = await run(() => addHouseholdMember(input));
  if (result.ok) {
    revalidatePath(`/households/${input.householdId}`);
    revalidatePath(`/clients/${input.customerId}`);
  }
  return result.ok ? { ok: true as const, data: undefined } : result;
}

export async function removeHouseholdMemberAction(
  householdId: string,
  customerId: string,
) {
  const result = await run(() => removeHouseholdMember(householdId, customerId));
  if (result.ok) {
    revalidatePath(`/households/${householdId}`);
    revalidatePath(`/clients/${customerId}`);
  }
  return result.ok ? { ok: true as const, data: undefined } : result;
}

/* ---------------- milestones ---------------- */

export async function createMilestoneAction(input: CreateMilestoneInput) {
  const result = await run(() => createMilestone(input));
  if (result.ok) {
    if (input.customerId) revalidatePath(`/clients/${input.customerId}`);
    if (input.householdId) revalidatePath(`/households/${input.householdId}`);
    revalidatePath("/milestones");
    revalidatePath("/");
  }
  return result.ok ? { ok: true as const, data: undefined } : result;
}

export async function archiveMilestoneAction(id: string, customerId?: string) {
  const result = await run(() => archiveMilestone(id));
  if (result.ok) {
    if (customerId) revalidatePath(`/clients/${customerId}`);
    revalidatePath("/milestones");
    revalidatePath("/");
  }
  return result.ok ? { ok: true as const, data: undefined } : result;
}

/* ---------------- interactions ---------------- */

export async function recordInteractionAction(input: RecordInteractionInput) {
  const result = await run(() => recordInteraction(input));
  if (result.ok) {
    revalidatePath(`/clients/${input.customerId}`);
    revalidatePath("/activity");
    revalidatePath("/");
  }
  return result.ok ? { ok: true as const, data: undefined } : result;
}

/* ---------------- preferences ---------------- */

export async function setPreferencesAction(input: SetPreferencesInput) {
  const result = await run(() => setPreferences(input));
  if (result.ok) revalidatePath(`/clients/${input.customerId}`);
  return result.ok ? { ok: true as const, data: undefined } : result;
}

export async function updatePreferenceProfileAction(
  input: PreferenceProfileInput,
) {
  const result = await run(() => updatePreferenceProfile(input));
  if (result.ok) revalidatePath(`/clients/${input.customerId}`);
  return result.ok ? { ok: true as const, data: undefined } : result;
}

export async function createPreferenceOptionAction(input: {
  kind: string;
  label: string;
}) {
  const result = await run(() =>
    createPreferenceOption(input as Parameters<typeof createPreferenceOption>[0]),
  );
  return result.ok
    ? {
        ok: true as const,
        data: { id: result.data.id, label: result.data.label },
      }
    : result;
}
