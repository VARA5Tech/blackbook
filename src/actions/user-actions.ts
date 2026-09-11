"use server";

import { revalidatePath } from "next/cache";
import {
  createStaffUser,
  setUserRole,
  type CreateStaffInput,
  type ROLES,
} from "@/services/user-service";
import { run } from "./action-result";

export async function createStaffUserAction(input: CreateStaffInput) {
  const result = await run(() => createStaffUser(input));
  if (result.ok) revalidatePath("/settings/users");
  return result.ok ? { ok: true as const, data: undefined } : result;
}

export async function setUserRoleAction(
  userId: string,
  role: (typeof ROLES)[number],
) {
  const result = await run(() => setUserRole(userId, role));
  if (result.ok) revalidatePath("/settings/users");
  return result.ok ? { ok: true as const, data: undefined } : result;
}
