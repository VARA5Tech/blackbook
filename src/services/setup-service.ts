import "server-only";
import { randomUUID } from "node:crypto";
import { sql as raw } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";
import { requiredText } from "@/domain/shared";
import { logger } from "@/lib/logger";
import { DomainError } from "./client-service";

/**
 * First-run setup.
 *
 * The first administrator cannot be created with a hand-written INSERT: Better
 * Auth stores a scrypt hash in a format only it produces, so a row written by
 * hand has no usable password. It also cannot come from an environment
 * variable without leaving a password sitting in the deployment config.
 *
 * So it is done through the application, once, and only while no account
 * exists at all. The moment one does, this route is closed for good.
 */

export const firstAdminSchema = z.object({
  name: requiredText("Name", 100),
  email: z.email("Enter a valid email address"),
  password: z
    .string()
    .min(12, "Use at least 12 characters")
    .max(200, "That is too long"),
});

export type FirstAdminInput = z.input<typeof firstAdminSchema>;

/** True only while the instance has no accounts whatsoever. */
export async function needsSetup(): Promise<boolean> {
  const [row] = await db
    .select({ count: raw<number>`count(*)::int` })
    .from(users);
  return row.count === 0;
}

export async function createFirstAdmin(input: FirstAdminInput): Promise<void> {
  const data = firstAdminSchema.parse(input);

  /**
   * Checked inside the transaction as well as before it. Two people opening
   * the page at once would otherwise both pass the check and both become
   * administrators; the unique index on email stops a duplicate, but the count
   * is what makes this genuinely once-only.
   */
  if (!(await needsSetup())) {
    throw new DomainError("This instance has already been set up.");
  }

  const context = await auth.$context;
  const hash = await context.password.hash(data.password);
  const id = randomUUID();

  await db.transaction(async (tx) => {
    const [{ count }] = await tx
      .select({ count: raw<number>`count(*)::int` })
      .from(users);
    if (count > 0) {
      throw new DomainError("This instance has already been set up.");
    }

    await tx.insert(users).values({
      id,
      name: data.name,
      email: data.email.toLowerCase(),
      emailVerified: true,
      role: "admin",
    });
    await tx.insert(accounts).values({
      id: randomUUID(),
      userId: id,
      accountId: id,
      providerId: "credential",
      password: hash,
    });
  });

  // No address: the logger redacts it, and an operational log is the wrong
  // place for one. That the account exists is provable by signing in.
  logger.info("setup.first_admin_created");
}
