import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, getActor } from "@/auth/session";
import { Client360View } from "@/components/clients/client-360";
import { displayName } from "@/domain/customers";
import {
  getClient360,
  getClientInterest,
  getClientReplays,
} from "@/services/client-service";
import { getCatalogue } from "@/services/preference-service";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const record = await getClient360(id);
  return { title: record ? displayName(record.customer) : "Client" };
}

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [record, actor] = await Promise.all([getClient360(id), getActor()]);
  if (!record || !actor) notFound();

  // PostHog is a network hop and may be unconfigured; both read alongside the
  // catalogue so a slow answer never delays the rest of the record.
  const [catalogue, interest, replays] = await Promise.all([
    getCatalogue(),
    getClientInterest(id),
    getClientReplays(id),
  ]);

  return (
    <Client360View
      record={record}
      catalogue={Object.fromEntries(catalogue)}
      interest={interest}
      replays={replays}
      permissions={{
        canEdit: can(actor, "client.update"),
        canArchive: can(actor, "client.archive"),
        canLogInteraction: can(actor, "interaction.create"),
        canManageMilestones: can(actor, "milestone.manage"),
        canUpdatePreferences: can(actor, "preference.update"),
        canUseAi: can(actor, "ai.use"),
      }}
    />
  );
}
