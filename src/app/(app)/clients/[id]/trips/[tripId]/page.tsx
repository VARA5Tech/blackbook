import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TripDetail } from "@/components/clients/trip-detail";
import { PageHeader } from "@/components/page-header";
import { displayName } from "@/domain/customers";
import type { ItineraryDay, TripStatus } from "@/domain/trips";
import { formatDateTime } from "@/lib/format";
import { getTrip } from "@/services/tern-service";

export const metadata: Metadata = { title: "Trip" };
export const dynamic = "force-dynamic";

/**
 * One trip, everything Blackbook holds for it: the fields, the travellers,
 * the day-by-day itinerary, and the rest of what Tern showed on the trip page.
 */
export default async function TripPage({ params }: { params: Promise<{ id: string; tripId: string }> }) {
  const { id, tripId } = await params;
  const found = await getTrip(tripId).catch(() => null);
  if (!found) notFound();
  const { trip, client } = found;

  const raw = trip.ternRaw as { overview?: { heading: string | null; tokens: { text: string; role: string }[] }[] } | null;

  return (
    <>
      <Link href={`/clients/${id}`} className="text-sm text-muted-foreground hover:underline">
        ← {client ? displayName(client) : "Client"}
      </Link>
      <PageHeader
        title={trip.title}
        description={
          trip.ternSyncedAt
            ? `From Tern · last read ${formatDateTime(trip.ternSyncedAt)}${client && client.id !== id ? ` · ${displayName(client)}'s trip` : ""}`
            : undefined
        }
      />
      <TripDetail
        trip={{
          title: trip.title,
          status: trip.status as TripStatus,
          startsOn: trip.startsOn,
          endsOn: trip.endsOn,
          datesText: trip.datesText,
          partySize: trip.partySize,
          currency: trip.currency,
          travelers: trip.travelers as never,
          itinerary: trip.itinerary as ItineraryDay[],
          flags: trip.flags,
          sections: raw?.overview ?? null,
        }}
      />
    </>
  );
}
