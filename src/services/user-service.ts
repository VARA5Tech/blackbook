import "server-only";
import { and, asc, eq, isNotNull, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/auth/permissions";
import { requireCapability } from "@/auth/session";
import { db } from "@/db";
import { accounts, users, verifications } from "@/db/schema";
import { requiredText, uuidv7 } from "@/domain/shared";
import {
  INVITATION_DAYS,
  staffEmailSchema,
} from "@/domain/staff";
import { sendEmail, staffInvitationEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { DomainError } from "./client-service";

/**
 * Staff accounts: listing, adding, inviting and roles.
 *
 * An invited colleague is an ordinary `app_user` row with `email_verified`
 * false, so an invitation needs no table of its own and no token: the
 * token is kept as a SHA-256 in Better Auth's `app_verification` table. Using
 * first code proves the address; an account nobody signs in to
 * up within INVITATION_DAYS is deleted by `purgeExpiredInvitations`.
 */

/**
 * Every role the column can hold, including the retired one.
 *
 * Kept whole because it is the type of a role read back off an existing row,
 * and an old account may still carry `viewer`. What may be *written* is
 * narrower: the schemas below validate against `ASSIGNABLE_ROLES`, so the
 * retired value drains as people are moved off it rather than spreading.
 */
export const ROLES = ["admin", "manager", "rm", "viewer"] as const;
type Role = (typeof ROLES)[number];

const INVITATION_MS = INVITATION_DAYS * 24 * 60 * 60 * 1000;
const INVITE_PREFIX = "staff-invite:";

/** Nobody has a password any more; this is what proves that stays true. */
const credential = and(
  eq(accounts.userId, users.id),
  eq(accounts.providerId, "credential"),
);

/** Staff who can be set as a relationship manager, for pickers and filters. */
export async function listStaff() {
  await requireCapability("client.read");
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .leftJoin(accounts, credential)
    // Someone invited but not set up yet is not staff yet.
    .where(
      and(
        eq(users.banned, false),
        or(eq(users.emailVerified, true), isNotNull(accounts.id)),
      ),
    )
    .orderBy(asc(users.name));
}

export async function listAllUsers() {
  await requireCapability("user.manage");
  await purgeExpiredInvitations();

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      banned: users.banned,
      createdAt: users.createdAt,
      emailVerified: users.emailVerified,
      credentialId: accounts.id,
    })
    .from(users)
    .leftJoin(accounts, credential)
    .orderBy(asc(users.name));

  return rows.map(({ emailVerified, credentialId, ...user }) => ({
    ...user,
    /**
     * Set while the person has not signed in yet: when the account lapses.
     *
     * `emailVerified` is the whole signal now. It used to be paired with "and
     * has no password", which no longer distinguishes anybody, because nobody
     * has one. Signing in with a code is what proves the address and clears
     * this.
     */
    inviteExpiresAt:
      !emailVerified && credentialId === null
        ? new Date(user.createdAt.getTime() + INVITATION_MS)
        : null,
  }));
}

async function assertEmailFree(email: string) {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) {
    throw new DomainError(
      "Someone already has an account or an open invitation with that email address.",
    );
  }
}

export const createStaffSchema = z.object({
  name: requiredText("Name", 100),
  // Only @vara5.com, completed from a bare name. Enforced here, not in the form.
  email: staffEmailSchema,
  role: z.enum(ASSIGNABLE_ROLES),
});

export type CreateStaffInput = z.input<typeof createStaffSchema>;

/**
 * Creates a colleague's account directly, already verified.
 *
 * The ordinary route is an invitation. This exists for the account somebody
 * needs to exist now, without waiting for them to open an email: there is no
 * password to hand over, so the only difference is that this one is verified
 * from the start and never lapses.
 */
export async function createStaffUser(input: CreateStaffInput) {
  await requireCapability("user.manage");
  const data = createStaffSchema.parse(input);
  await purgeExpiredInvitations();
  await assertEmailFree(data.email);

  const id = uuidv7();

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id,
      name: data.name,
      email: data.email,
      emailVerified: true,
      role: data.role,
    });
  });

  return { id };
}

/** Changes a colleague's role. An administrator cannot demote themselves. */
export async function setUserRole(userId: string, role: Role) {
  const actor = await requireCapability("user.manage");

  if (userId === actor.id && role !== "admin") {
    throw new DomainError(
      "You cannot remove your own administrator access. Ask another administrator.",
    );
  }

  const [updated] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) throw new DomainError("That account no longer exists.");
  return updated;
}

/* ------------------------------------------------------------ invitations */

const inviteSchema = z.object({
  name: requiredText("Name", 100),
  email: staffEmailSchema,
  role: z.enum(ASSIGNABLE_ROLES),
});

export type InviteStaffInput = z.input<typeof inviteSchema>;


/**
 * Tells somebody an account exists for them.
 *
 * No link, because there is nothing for one to do: there is no password to set,
 * and a link that signed somebody in would be a credential sitting in a mailbox
 * that a scanner or a forwarded thread could spend. They go to Blackbook and
 * ask it for a code, as they will every time after this one.
 */
async function sendInvitation(
  user: { name: string; email: string; role: Role },
  invitedBy: string,
) {
  const origin = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const message = staffInvitationEmail({
    name: user.name,
    invitedBy,
    roleLabel: ROLE_LABELS[user.role],
    signInUrl: `${origin}/sign-in`,
  });
  await sendEmail({ to: user.email, category: "staff-invitation", ...message });
}

/** Deletes an account nobody has signed in to. Never touches a verified one. */
async function removeInvitedUser(userId: string) {
  await db.transaction(async (tx) => {
    await tx
      .delete(verifications)
      .where(
        and(
          eq(verifications.value, userId),
          like(verifications.identifier, `${INVITE_PREFIX}%`),
        ),
      );
    await tx
      .delete(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.emailVerified, false),
          sql`not exists (select 1 from ${accounts} a where a.user_id = ${userId} and a.provider_id = 'credential')`,
        ),
      );
  });
}

async function findInvitedUser(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      emailVerified: users.emailVerified,
      credentialId: accounts.id,
    })
    .from(users)
    .leftJoin(accounts, credential)
    .where(eq(users.id, userId));

  if (!user || user.emailVerified || user.credentialId) {
    throw new DomainError("That invitation was already used, withdrawn or has lapsed.");
  }
  return user;
}

/**
 * Deletes invited accounts nobody set up within INVITATION_DAYS, and any link
 * that has lapsed or lost its account. Runs whenever Team is opened, an
 * invitation is sent or a link is followed, and on boot, so nothing needs a
 * scheduler. Safe to run any number of times.
 */
export async function purgeExpiredInvitations(): Promise<number> {
  // The table objects render schema-qualified, so these never depend on the
  // connection's search path finding the identity schema.
  const removed = await db.execute(sql`
    delete from ${users} u
    where u.email_verified = false
      and u.created_at < now() - make_interval(days => ${INVITATION_DAYS}::int)
      and not exists (
        select 1 from ${accounts} a
        where a.user_id = u.id and a.provider_id = 'credential'
      )
    returning u.id
  `);
  await db.execute(sql`
    delete from ${verifications} v
    where v.identifier like ${`${INVITE_PREFIX}%`}
      and (v.expires_at < now() or not exists (select 1 from ${users} u where u.id = v.value))
  `);

  if (removed.length > 0) {
    logger.info("staff.invitations_lapsed", { count: removed.length });
  }
  return removed.length;
}

/**
 * Invites a colleague: creates their account unverified,
 * and emails them a link to set one. If the email cannot be sent, nothing is kept.
 */
export async function inviteStaff(input: InviteStaffInput) {
  const actor = await requireCapability("user.manage");
  const data = inviteSchema.parse(input);
  await purgeExpiredInvitations();
  await assertEmailFree(data.email);

  const id = uuidv7();
  await db.insert(users).values({
    id,
    name: data.name,
    email: data.email,
    emailVerified: false,
    role: data.role,
  });

  try {
    await sendInvitation(data, actor.name);
  } catch (error) {
    logger.error("invitation.send_failed", error, { userId: id });
    await removeInvitedUser(id);
    throw new DomainError(
      "The invitation email could not be sent, so nothing was saved. Try again.",
    );
  }

  return { id, email: data.email };
}

/** Sends the note again and restarts the window before the account lapses. */
export async function resendInvitation(userId: string) {
  const actor = await requireCapability("user.manage");
  const user = await findInvitedUser(userId);

  await db
    .update(users)
    .set({ createdAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  try {
    await sendInvitation(user, actor.name);
  } catch (error) {
    logger.error("invitation.send_failed", error, { userId: user.id });
    throw new DomainError(
      "The invitation email could not be sent. The earlier link no longer works, so try again.",
    );
  }

  return { email: user.email };
}

/** Withdraws an invitation by deleting the account nobody has set up. */
export async function revokeInvitation(userId: string) {
  await requireCapability("user.manage");
  const user = await findInvitedUser(userId);
  await removeInvitedUser(user.id);
  return { email: user.email };
}
