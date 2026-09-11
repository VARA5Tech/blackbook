import type { UserRole } from "@/db/schema";

/**
 * Capability-based authorization.
 *
 * Services ask "can this actor do X?", never "is this actor an admin?".
 * Adding a role later means editing one table here instead of hunting for
 * scattered role checks.
 */
export const CAPABILITIES = [
  "client.read",
  "client.create",
  "client.update",
  "client.archive",
  /**
   * Permanently destroying a client, separate from archiving it.
   *
   * Twenty CRM draws the same line, between soft-deleting a record and
   * destroying it. Archiving is routine and reversible; erasure is neither, and
   * is the action a data-erasure request actually requires. Keeping them as one
   * capability would have meant every manager could destroy a client.
   */
  "client.destroy",
  "client.reassign_rm",
  "household.manage",
  "preference.update",
  "preference_option.create",
  "milestone.manage",
  "interaction.create",
  "task.manage",
  "user.manage",
  "ai.use",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const VIEWER: Capability[] = ["client.read", "ai.use"];

const RM: Capability[] = [
  ...VIEWER,
  "client.create",
  "client.update",
  "household.manage",
  "preference.update",
  "preference_option.create",
  "milestone.manage",
  "interaction.create",
  "task.manage",
];

const MANAGER: Capability[] = [...RM, "client.archive", "client.reassign_rm"];

const ADMIN: Capability[] = [...MANAGER, "user.manage", "client.destroy"];

const ROLE_CAPABILITIES: Record<UserRole, readonly Capability[]> = {
  viewer: VIEWER,
  rm: RM,
  manager: MANAGER,
  admin: ADMIN,
};

export function roleCan(role: UserRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function capabilitiesFor(role: UserRole): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  manager: "Manager",
  rm: "Relationship Manager",
  viewer: "Viewer",
};
