import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, getActor } from "@/auth/session";
import { Client360View } from "@/components/clients/client-360";
import { displayName } from "@/domain/customers";
import {
  getClient360,
  getClientInterest,
  getClientReplays,
  getClientSignals,
} from "@/services/client-service";
import { getCatalogue } from "@/services/preference-service";
import { documentsEnabled, listDocuments } from "@/services/document-service";
import { leadsForClient } from "@/services/lead-service";
import { travelDocumentsForScreen, tripsForClient } from "@/services/tern-service";
import { listStaff } from "@/services/user-service";
import type { ItineraryDay } from "@/domain/trips";
import { ternConfigured } from "@/lib/tern";

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
  const canAssign = can(actor, "lead.assign");
  const docsOn = documentsEnabled();

  const [catalogue, interest, replays, signals, leads, staff, trips, documents] = await Promise.all([
    getCatalogue(),
    getClientInterest(id),
    getClientReplays(id),
    getClientSignals(id),
    leadsForClient(id),
    // Only fetched for somebody who may hand a lead over; everyone else has
    // nothing to pick from and no reason to read the staff list.
    canAssign ? listStaff() : Promise.resolve([]),
    tripsForClient(id),
    // Storage is optional; with it off the card never shows, so skip the read.
    docsOn ? listDocuments(id) : Promise.resolve([]),
  ]);

  // Kind, nationality, expiry and last four only; never the sealed number.
  const travelDocuments = travelDocumentsForScreen(record.customer.travelDocuments);

  return (
    <Client360View
      record={record}
      catalogue={Object.fromEntries(catalogue)}
      interest={interest}
      replays={replays}
      signals={signals}
      leads={leads}
      trips={trips.map((trip) => ({
        id: trip.id,
        title: trip.title,
        status: trip.status,
        startsOn: trip.startsOn,
        endsOn: trip.endsOn,
        datesText: trip.datesText,
        partySize: trip.partySize,
        currency: trip.currency,
        travelers: trip.travelers as { name: string; prefix: string | null; primary: boolean; customerId: string | null }[],
        itinerary: trip.itinerary as ItineraryDay[],
        flags: trip.flags,
        own: trip.customerId === id,
      }))}
      travelDocuments={travelDocuments}
      ternEnabled={ternConfigured()}
      documents={documents}
      documentsEnabled={docsOn}
      staff={staff
        .filter((member) => member.role === "rm" || member.role === "manager")
        .map((member) => ({ id: member.id, name: member.name }))}
      permissions={{
        canEdit: can(actor, "client.update"),
        canArchive: can(actor, "client.archive"),
        canLogInteraction: can(actor, "interaction.create"),
        canManageMilestones: can(actor, "milestone.manage"),
        canUpdatePreferences: can(actor, "preference.update"),
        canUseAi: can(actor, "ai.use"),
        canWorkLeads: can(actor, "lead.work"),
        canAssignLeads: canAssign,
        canRevealDocuments: can(actor, "travel_document.reveal"),
        canManageDocuments: can(actor, "document.manage"),
      }}
    />
  );
}
