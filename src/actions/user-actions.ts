"use server";

import { revalidatePath } from "next/cache";
import {
  acceptInvitation,
  createStaffUser,
  inviteStaff,
  resendInvitation,
  revokeInvitation,
  setUserRole,
  type CreateStaffInput,
  type InviteStaffInput,
  type ROLES,
} from "@/services/user-service";
import { run } from "./action-result";

const TEAM_PATH = "/settings/users";

export async function createStaffUserAction(input: CreateStaffInput) {
  const result = await run(() => createStaffUser(input));
  if (result.ok) revalidatePath(TEAM_PATH);
  return result.ok ? { ok: true as const, data: undefined } : result;
}

export async function setUserRoleAction(
  userId: string,
  role: (typeof ROLES)[number],
) {
  const result = await run(() => setUserRole(userId, role));
  if (result.ok) revalidatePath(TEAM_PATH);
  return result.ok ? { ok: true as const, data: undefined } : result;
}

export async function inviteStaffAction(input: InviteStaffInput) {
  const result = await run(() => inviteStaff(input));
  if (result.ok) revalidatePath(TEAM_PATH);
  return result.ok ? { ok: true as const, data: { email: result.data.email } } : result;
}

export async function resendInvitationAction(userId: string) {
  const result = await run(() => resendInvitation(userId));
  if (result.ok) revalidatePath(TEAM_PATH);
  return result.ok ? { ok: true as const, data: undefined } : result;
}

export async function revokeInvitationAction(userId: string) {
  const result = await run(() => revokeInvitation(userId));
  if (result.ok) revalidatePath(TEAM_PATH);
  return result.ok ? { ok: true as const, data: undefined } : result;
}

/** Called signed out, from the invitation page. The token is the credential. */
export async function acceptInvitationAction(token: string, password: string) {
  const result = await run(() => acceptInvitation({ token, password }));
  return result.ok ? { ok: true as const, data: undefined } : result;
}
