import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { requireCapability } from "@/auth/session";
import { db } from "@/db";
import { customers, interactions, users } from "@/db/schema";
import {
  INTERACTION_TYPES,
  INTERACTION_TYPE_LABELS,
  recordInteractionSchema,
  type RecordInteractionInput,
} from "@/domain/engagement";
import { logActivity } from "./activity-service";
import { DomainError } from "./client-service";

export {
  INTERACTION_TYPES,
  INTERACTION_TYPE_LABELS,
  recordInteractionSchema,
  type RecordInteractionInput,
};

/**
 * Records a touchpoint and advances the client's "Last Interaction".
 *
 * The denormalised column is only moved forward, so back-filling an older
 * conversation never makes a client look staler than they are.
 */
export async function recordInteraction(input: RecordInteractionInput) {
  const actor = await requireCapability("interaction.create");
  const data = recordInteractionSchema.parse(input);

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, data.customerId),
  });
  if (!customer) throw new DomainError("Client not found");

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(interactions)
      .values({
        customerId: data.customerId,
        householdId: customer.householdId,
        type: data.type,
        summary: data.summary,
        details: data.details,
        occurredAt: data.occurredAt,
        loggedBy: actor.id,
      })
      .returning();

    /**
     * Only ever moves forward, computed in SQL so two people logging at once
     * cannot clobber each other.
     *
     * The timestamp is bound as an ISO string with an explicit cast: a JS Date
     * interpolated into a raw expression inside `.set()` cannot be bound by the
     * driver, because Drizzle applies the column's type hint to it.
     */
    const occurredAtIso = data.occurredAt.toISOString();
    await tx
      .update(customers)
      .set({
        lastInteractionAt: sql`greatest(
          coalesce(${customers.lastInteractionAt}, ${occurredAtIso}::timestamptz),
          ${occurredAtIso}::timestamptz
        )`,
      })
      .where(eq(customers.id, data.customerId));

    /*
     * Contact logged against a client answers whatever they were waiting on.
     *
     * This is the honest signal: the desk writes a call down after it happens,
     * and asking somebody to press a second button to say what they have just
     * recorded is how a queue stops matching reality.
     */
    const { acknowledgeLeadsFor } = await import("./lead-service");
    await acknowledgeLeadsFor(tx, data.customerId, actor.id);

    await logActivity(
      {
        actor,
        entityType: "interaction",
        entityId: created.id,
        action: "interaction_logged",
        customerId: data.customerId,
        householdId: customer.householdId,
        summary: `${INTERACTION_TYPE_LABELS[data.type]} logged: ${data.summary}`,
      },
      tx,
    );

    return created;
  });
}

export async function listInteractions(customerId: string, limit = 50) {
  await requireCapability("client.read");
  return db
    .select({
      id: interactions.id,
      type: interactions.type,
      summary: interactions.summary,
      details: interactions.details,
      occurredAt: interactions.occurredAt,
      loggedByName: users.name,
    })
    .from(interactions)
    .leftJoin(users, eq(interactions.loggedBy, users.id))
    .where(eq(interactions.customerId, customerId))
    .orderBy(desc(interactions.occurredAt))
    .limit(limit);
}
