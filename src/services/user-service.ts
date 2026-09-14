import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, isNotNull, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { ROLE_LABELS } from "@/auth/permissions";
import { requireCapability } from "@/auth/session";
import { db } from "@/db";
import { accounts, users, verifications } from "@/db/schema";
import { requiredText, uuidv7 } from "@/domain/shared";
import {
  INVITATION_DAYS,
  isStaffEmail,
  staffEmailSchema,
  staffPasswordSchema,
} from "@/domain/staff";
import { sendEmail, staffInvitationEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { DomainError } from "./client-service";

/**
 * Staff accounts: listing, adding, inviting and roles.
 *
 * An invited colleague is an ordinary `app_user` row with `email_verified`
 * false and no password, so an invitation needs no table of its own. The link's
 * token is kept as a SHA-256 in Better Auth's `app_verification` table. Using
 * the link sets the password and verifies the address; an account nobody sets
 * up within INVITATION_DAYS is deleted by `purgeExpiredInvitations`.
 */

export const ROLES = ["admin", "manager", "rm", "viewer"] as const;
type Role = (typeof ROLES)[number];
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const INVITATION_MS = INVITATION_DAYS * 24 * 60 * 60 * 1000;
const INVITE_PREFIX = "staff-invite:";
/** 256 random bits, URL-safe: 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Joins a user to their password, when they have set one. */
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
    /** Set while the person has not used their invitation: when it lapses. */
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
  role: z.enum(ROLES),
  password: staffPasswordSchema,
});

export type CreateStaffInput = z.input<typeof createStaffSchema>;

/**
 * Creates a colleague's account with an initial password.
 *
 * The fallback to an invitation, for someone who cannot receive email yet: the
 * administrator passes the password on privately and the colleague changes it
 * from the user menu. Better Auth owns the hash format, so its hasher makes it.
 */
export async function createStaffUser(input: CreateStaffInput) {
  await requireCapability("user.manage");
  const data = createStaffSchema.parse(input);
  await purgeExpiredInvitations();
  await assertEmailFree(data.email);

  const context = await auth.$context;
  const hash = await context.password.hash(data.password);
  const id = uuidv7();

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id,
      name: data.name,
      email: data.email,
      emailVerified: true,
      role: data.role,
    });
    await tx.insert(accounts).values({
      id: uuidv7(),
      userId: id,
      accountId: id,
      providerId: "credential",
      password: hash,
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
  role: z.enum(ROLES),
});

export type InviteStaffInput = z.input<typeof inviteSchema>;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Replaces any earlier link for this person with a new one, and returns it. */
async function issueInviteToken(tx: Tx, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await tx
    .delete(verifications)
    .where(
      and(
        eq(verifications.value, userId),
        like(verifications.identifier, `${INVITE_PREFIX}%`),
      ),
    );
  await tx.insert(verifications).values({
    id: uuidv7(),
    identifier: `${INVITE_PREFIX}${hashToken(token)}`,
    value: userId,
    expiresAt: new Date(Date.now() + INVITATION_MS),
  });
  return token;
}

async function sendInvitation(
  user: { name: string; email: string; role: Role },
  token: string,
  invitedBy: string,
) {
  const origin = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const message = staffInvitationEmail({
    name: user.name,
    invitedBy,
    roleLabel: ROLE_LABELS[user.role],
    link: `${origin}/invite/${token}`,
  });
  await sendEmail({ to: user.email, category: "staff-invitation", ...message });
}

/** Deletes an invited account and its link. Never touches one with a password. */
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
          sql`not exists (select 1 from app_account a where a.user_id = ${userId} and a.provider_id = 'credential')`,
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
  const removed = await db.execute(sql`
    delete from app_user u
    where u.email_verified = false
      and u.created_at < now() - make_interval(days => ${INVITATION_DAYS}::int)
      and not exists (
        select 1 from app_account a
        where a.user_id = u.id and a.provider_id = 'credential'
      )
    returning u.id
  `);
  await db.execute(sql`
    delete from app_verification v
    where v.identifier like ${`${INVITE_PREFIX}%`}
      and (v.expires_at < now() or not exists (select 1 from app_user u where u.id = v.value))
  `);

  if (removed.length > 0) {
    logger.info("staff.invitations_lapsed", { count: removed.length });
  }
  return removed.length;
}

/**
 * Invites a colleague: creates their account unverified and without a password,
 * and emails them a link to set one. If the email cannot be sent, nothing is kept.
 */
export async function inviteStaff(input: InviteStaffInput) {
  const actor = await requireCapability("user.manage");
  const data = inviteSchema.parse(input);
  await purgeExpiredInvitations();
  await assertEmailFree(data.email);

  const id = uuidv7();
  const token = await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id,
      name: data.name,
      email: data.email,
      emailVerified: false,
      role: data.role,
    });
    return issueInviteToken(tx, id);
  });

  try {
    await sendInvitation(data, token, actor.name);
  } catch (error) {
    logger.error("invitation.send_failed", error, { userId: id });
    await removeInvitedUser(id);
    throw new DomainError(
      "The invitation email could not be sent, so nothing was saved. Try again.",
    );
  }

  return { id, email: data.email };
}

/** Sends a new link and restarts the two days. The previous link stops working. */
export async function resendInvitation(userId: string) {
  const actor = await requireCapability("user.manage");
  const user = await findInvitedUser(userId);

  const token = await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ createdAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    return issueInviteToken(tx, user.id);
  });

  try {
    await sendInvitation(user, token, actor.name);
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

/**
 * What the invitation page shows, or null when the link does not work. Public on
 * purpose: the person following it has no session, and the token is the
 * credential.
 */
export async function findInvitationByToken(
  token: string,
): Promise<{ name: string; email: string } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  await purgeExpiredInvitations();

  const [row] = await db
    .select({
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      expiresAt: verifications.expiresAt,
      credentialId: accounts.id,
    })
    .from(verifications)
    .innerJoin(users, eq(users.id, verifications.value))
    .leftJoin(accounts, credential)
    .where(eq(verifications.identifier, `${INVITE_PREFIX}${hashToken(token)}`));

  if (
    !row ||
    row.emailVerified ||
    row.credentialId ||
    row.expiresAt.getTime() <= Date.now()
  ) {
    return null;
  }
  return { name: row.name, email: row.email };
}

const acceptSchema = z.object({
  token: z.string().max(200),
  password: staffPasswordSchema,
});

function invitationNoLongerWorks() {
  return new DomainError(
    "This invitation link no longer works. It may have lapsed or already been used. Sign in if you have set your password, or ask a Vara5 administrator to invite you again.",
  );
}

/**
 * Sets the invited colleague's password and verifies their address. Public,
 * like the lookup. Both rows are locked, so two submissions of one link cannot
 * both succeed and a purge running at the same moment waits.
 */
export async function acceptInvitation(input: z.input<typeof acceptSchema>) {
  const data = acceptSchema.parse(input);
  if (!TOKEN_PATTERN.test(data.token)) throw invitationNoLongerWorks();

  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(verifications)
      .where(eq(verifications.identifier, `${INVITE_PREFIX}${hashToken(data.token)}`))
      .for("update");
    if (!invite || invite.expiresAt.getTime() <= Date.now()) {
      throw invitationNoLongerWorks();
    }

    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, invite.value))
      .for("update");
    if (!user || user.emailVerified || !isStaffEmail(user.email)) {
      throw invitationNoLongerWorks();
    }

    const existingPassword = await tx.query.accounts.findFirst({
      where: and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")),
    });
    if (existingPassword) throw invitationNoLongerWorks();

    const context = await auth.$context;
    const hash = await context.password.hash(data.password);

    await tx.insert(accounts).values({
      id: uuidv7(),
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: hash,
    });
    // Following the emailed link proves the address.
    await tx
      .update(users)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await tx.delete(verifications).where(eq(verifications.id, invite.id));

    return { id: user.id, email: user.email };
  });
}
