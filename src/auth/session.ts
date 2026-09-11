import { cache } from "react";
import { readActorFromRequest, type Actor } from "@/auth/current-actor";
import { type Capability, roleCan } from "@/auth/permissions";

export type { Actor };

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(public readonly capability: Capability) {
    super(`Missing capability: ${capability}`);
    this.name = "ForbiddenError";
  }
}

/**
 * Deduplicated per request: several server components on one page can each ask
 * for the session without producing several database reads.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  return readActorFromRequest();
});

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

/** Loads the actor and asserts one capability. The standard service entry point. */
export async function requireCapability(
  capability: Capability,
): Promise<Actor> {
  const actor = await requireActor();
  assertCan(actor, capability);
  return actor;
}

export function can(actor: Actor, capability: Capability): boolean {
  return roleCan(actor.role, capability);
}

export function assertCan(actor: Actor, capability: Capability): void {
  if (!roleCan(actor.role, capability)) throw new ForbiddenError(capability);
}
