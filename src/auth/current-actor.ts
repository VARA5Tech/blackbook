import { headers } from "next/headers";
import { auth } from "@/auth";
import type { UserRole } from "@/db/schema";

/** The authenticated actor every service call is performed on behalf of. */
export type Actor = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

/**
 * The one place the request context is read.
 *
 * Isolated in its own module so the capability logic in `session.ts` can be
 * exercised by tests against a real database without a live HTTP request. Tests
 * substitute this resolver; everything above it, including every authorization
 * check, runs exactly as it does in production.
 */
export async function readActorFromRequest(): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: (session.user as { role?: UserRole }).role ?? "viewer",
  };
}
