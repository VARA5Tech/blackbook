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
  /**
   * Attaching a file to a client or a trip, and removing one. A document is a
   * scan or an itinerary the desk keeps beside the record; managing them is the
   * same reach a curator has over a note or a task.
   */
  "document.manage",
  /**
   * Working a lead: acknowledging it, moving it through its phases, dropping
   * it. Any curator may work one, which is the same reach they have over a
   * task; who it belongs to is a separate question.
   */
  "lead.work",
  /**
   * Handing a lead to a curator. A lead nobody owns is escalated rather than
   * left to be picked up, so somebody has to be able to give it an owner, and
   * that is the manager's job rather than the curator's own choice.
   */
  "lead.assign",
  "user.manage",
  /**
   * Opening a sealed passport or secure travel number.
   *
   * Everyone who can read a client sees that a passport exists, its
   * nationality, its expiry and its last four characters — which is what the
   * desk needs week to week. The number itself is for the few who book with
   * it, and every reveal is written to the trail.
   */
  "travel_document.reveal",
  "ai.use",
  /**
   * Reading how the members' site is performing across every client, rather
   * than one client's own activity, which `client.read` already covers.
   *
   * Separate because it is a different question. A relationship manager needs
   * to know what their client has been reading; who is browsing across the
   * whole book, which journeys convert and which are ignored is a commercial
   * picture, and it belongs to whoever runs the desk.
   */
  "analytics.read",
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
  "document.manage",
  "lead.work",
];

const MANAGER: Capability[] = [
  ...RM,
  "client.archive",
  "client.reassign_rm",
  "lead.assign",
  "analytics.read",
];

const ADMIN: Capability[] = [...MANAGER, "user.manage", "client.destroy", "travel_document.reveal"];

/**
 * An owner of the firm, who reaches everything an administrator does.
 *
 * What separates the two is not what they may do but what happens to them.
 * A founder is outside the working rota: no client, lead or task is assigned
 * to one, and none of the chasing mail is addressed to one. They read and edit
 * the book; they are not the desk that answers it.
 *
 * Both halves of that are enforced elsewhere and neither is a capability:
 * `listStaff` is the list work is handed out from and leaves founders out of
 * it, and every notification picks its recipients by role, so a role nobody
 * names is a role nobody mails.
 */
const FOUNDER: Capability[] = [...ADMIN];

const ROLE_CAPABILITIES: Record<UserRole, readonly Capability[]> = {
  viewer: VIEWER,
  rm: RM,
  manager: MANAGER,
  admin: ADMIN,
  founder: FOUNDER,
};

export function roleCan(role: UserRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function capabilitiesFor(role: UserRole): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

/**
 * What each role is called on screen.
 *
 * The stored values are untouched. `rm` is written into `app_user.role`, into
 * `customer.primary_rm_id` and into every audit row already on the trail, and
 * renaming the enum would mean rewriting all three to change a word nobody
 * stores. The label is the word people read; the value is the word the database
 * keeps.
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  manager: "Manager",
  rm: "Curator",
  viewer: "Viewer",
  founder: "Founder",
};

/**
 * Roles that are somebody's job at the desk, as opposed to somebody's standing
 * in the firm.
 *
 * Work is handed to these and chased with these. A founder is neither, which
 * is the whole of the difference: they hold every capability an administrator
 * does, and no client, lead or task is ever theirs.
 */
export const DESK_ROLES = ["admin", "manager", "rm", "viewer"] as const satisfies
  readonly UserRole[];

export const isDeskRole = (role: UserRole): boolean =>
  (DESK_ROLES as readonly UserRole[]).includes(role);

/**
 * The roles somebody can actually be given.
 *
 * `viewer` is retired: it could read every client and do nothing with them,
 * which turned out to describe nobody at the desk. It stays in the enum because
 * the value may still sit on an old row, and it still grants what it always
 * granted, but nothing offers it any more.
 */
export const ASSIGNABLE_ROLES = [
  "admin",
  "manager",
  "rm",
  "founder",
] as const satisfies readonly UserRole[];

/** A role somebody can be given, as opposed to one they may still hold. */
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
