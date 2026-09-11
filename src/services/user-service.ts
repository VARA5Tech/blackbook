import "server-only";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { requiredText } from "@/domain/shared";
import { requireCapability } from "@/auth/session";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";
import { DomainError } from "./client-service";

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
    .where(eq(users.banned, false))
    .orderBy(asc(users.name));
}

export async function listAllUsers() {
  await requireCapability("user.manage");
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      banned: users.banned,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.name));
}

export const ROLES = ["admin", "manager", "rm", "viewer"] as const;

export const createStaffSchema = z.object({
  name: requiredText("Name", 100),
  email: z.email("Enter a valid email address"),
  role: z.enum(ROLES),
  password: z
    .string()
    .min(12, "Use at least 12 characters")
    .max(200, "That is too long"),
});

export type CreateStaffInput = z.input<typeof createStaffSchema>;

/**
 * Creates a colleague's account with an initial password.
 *
 * There is no invitation email yet, because nothing sends mail: the
 * administrator sets a password and passes it on, and the colleague changes it.
 * Better Auth owns the hashing, which is why this cannot be done with SQL.
 */
export async function createStaffUser(input: CreateStaffInput) {
  await requireCapability("user.manage");
  const data = createStaffSchema.parse(input);
  const email = data.email.toLowerCase();

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) {
    throw new DomainError("Someone already has that email address.");
  }

  const context = await auth.$context;
  const hash = await context.password.hash(data.password);
  const id = randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id,
      name: data.name,
      email,
      emailVerified: true,
      role: data.role,
    });
    await tx.insert(accounts).values({
      id: randomUUID(),
      userId: id,
      accountId: id,
      providerId: "credential",
      password: hash,
    });
  });

  return { id };
}

/** Changes a colleague's role. An administrator cannot demote themselves. */
export async function setUserRole(userId: string, role: (typeof ROLES)[number]) {
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
