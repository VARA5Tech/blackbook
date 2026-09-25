"use client";

import { AlertTriangle, ChevronDown, ChevronRight, Eye, Luggage, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { revealTravelDocumentAction } from "@/actions/client-actions";
import { Itinerary, tripDates } from "@/components/clients/trip-detail";
import { Section } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  OPEN_TRIP_STATUSES,
  TRAVEL_DOCUMENT_LABELS,
  TRIP_FLAG_LABELS,
  TRIP_STATUS_LABELS,
  type ItineraryDay,
  type StoredTravelDocument,
  type TripStatus,
} from "@/domain/trips";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A client's journeys and the travel documents they depend on.
 *
 * A trip opens two ways: the chevron unfolds its days in place, for a quick
 * look; its name opens the trip on a page of its own, with everything
 * Blackbook holds for it. Bringing trips over from Tern lives in
 * `tern-import.tsx`.
 */

export type TripView = {
  id: string;
  title: string;
  status: TripStatus;
  startsOn: string | null;
  endsOn: string | null;
  datesText: string | null;
  partySize: number | null;
  currency: string | null;
  travelers: { name: string; prefix: string | null; primary: boolean; customerId: string | null }[];
  itinerary: ItineraryDay[];
  flags: string[];
  /** The client's own trip, as opposed to one they travelled on with somebody else. */
  own: boolean;
};

export function TripsPanel({
  customerId,
  trips,
  populate,
}: {
  customerId: string;
  trips: TripView[];
  /** The Tern button, when Tern is set up and this person may use it. */
  populate: ReactNode;
}) {
  const upcoming = trips.filter((t) => OPEN_TRIP_STATUSES.includes(t.status));
  const past = trips.filter((t) => !OPEN_TRIP_STATUSES.includes(t.status));

  return (
    <Section title="Trips" icon={Luggage} count={trips.length || undefined} action={populate} flush>
      {trips.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No trips yet.{populate ? " Bring this client's history over from Tern." : ""}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {upcoming.length > 0 ? <TripGroup customerId={customerId} title="Ahead" trips={upcoming} /> : null}
          {past.length > 0 ? <TripGroup customerId={customerId} title="History" trips={past} /> : null}
        </div>
      )}
    </Section>
  );
}

function TripGroup({ customerId, title, trips }: { customerId: string; title: string; trips: TripView[] }) {
  return (
    <div>
      <p className="bg-muted/40 px-4 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      <ul className="divide-y divide-border">
        {trips.map((trip) => (
          <TripRow key={trip.id} customerId={customerId} trip={trip} />
        ))}
      </ul>
    </div>
  );
}

function TripRow({ customerId, trip }: { customerId: string; trip: TripView }) {
  const [open, setOpen] = useState(false);
  const items = trip.itinerary.reduce((n, day) => n + day.items.length, 0);
  const companions = trip.travelers.filter((t) => !t.primary);

  return (
    <li>
      <div className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Fold the days away" : "Show the days"}
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/clients/${customerId}/trips/${trip.id}`} className="font-medium underline-offset-4 hover:underline">
              {trip.title}
            </Link>
            <Badge variant={trip.status === "booked" || trip.status === "traveling" ? "default" : "secondary"}>
              {TRIP_STATUS_LABELS[trip.status]}
            </Badge>
            {!trip.own ? <Badge variant="outline">As a companion</Badge> : null}
            {trip.flags.map((flag) => (
              <Badge key={flag} variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3" />
                {TRIP_FLAG_LABELS[flag] ?? flag}
              </Badge>
            ))}
          </div>
          <p className="tabular mt-0.5 text-xs text-muted-foreground">
            {tripDates(trip)}
            {trip.partySize ? ` · ${trip.partySize} ${trip.partySize === 1 ? "traveller" : "travellers"}` : ""}
            {companions.length ? ` · with ${companions.map((t) => t.name).slice(0, 3).join(", ")}${companions.length > 3 ? ` +${companions.length - 3}` : ""}` : ""}
            {items ? ` · ${items} ${items === 1 ? "item" : "items"}` : ""}
          </p>
        </div>
        <Link href={`/clients/${customerId}/trips/${trip.id}`} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={`Open ${trip.title}`}>
          <ChevronRight className="size-4" />
        </Link>
      </div>
      {open ? (
        <div className="px-11 pb-4">
          <Itinerary days={trip.itinerary} />
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------ travel documents */

/**
 * A document as the browser sees it: never the sealed number. Whether it has
 * expired is worked out on the server as the page renders, so the screen does
 * not read the clock mid-render and disagree with itself.
 */
export type TravelDocumentView = Omit<StoredTravelDocument, "sealed"> & {
  expiry: "expired" | "soon" | "ok" | null;
};

export function TravelDocumentsCard({
  customerId,
  documents,
  canReveal,
}: {
  customerId: string;
  documents: TravelDocumentView[];
  canReveal: boolean;
}) {
  const [shown, setShown] = useState<Record<number, string>>({});
  const [pending, startTransition] = useTransition();

  if (documents.length === 0) return null;

  function reveal(index: number) {
    startTransition(async () => {
      const result = await revealTravelDocumentAction({ customerId, index });
      if (!result.ok) return void toast.error(result.error);
      setShown((s) => ({ ...s, [index]: result.data }));
      // Shown for a minute, then masked again, so it does not sit on a screen.
      setTimeout(() => setShown((s) => {
        const next = { ...s };
        delete next[index];
        return next;
      }), 60_000);
    });
  }

  return (
    <Section title="Travel documents" icon={ShieldCheck} flush>
      <ul className="divide-y divide-border">
        {documents.map((doc, index) => {
          const soon = doc.expiry === "expired" || doc.expiry === "soon";
          return (
            <li key={index} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {TRAVEL_DOCUMENT_LABELS[doc.kind]}
                  {doc.nationality ? <span className="font-normal text-muted-foreground"> · {doc.nationality}</span> : null}
                </p>
                <p className="tabular text-xs text-muted-foreground">
                  {shown[index] ?? `•••• ${doc.last4}`}
                  {doc.expiresOn ? (
                    <span className={cn(soon && "font-medium text-destructive")}>
                      {" · "}
                      {doc.expiry === "expired" ? "expired" : "expires"} {formatDate(doc.expiresOn)}
                    </span>
                  ) : null}
                </p>
              </div>
              {canReveal && !shown[index] ? (
                <Button variant="ghost" size="sm" onClick={() => reveal(index)} disabled={pending}>
                  <Eye />
                  Reveal
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
