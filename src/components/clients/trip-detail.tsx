"use client";

import {
  AlertTriangle,
  BedDouble,
  Briefcase,
  Car,
  ChevronDown,
  Compass,
  Info,
  ListTree,
  Luggage,
  Plane,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  ITINERARY_KIND_LABELS,
  TRIP_FLAG_LABELS,
  TRIP_STATUS_LABELS,
  type ItineraryDay,
  type ItineraryKind,
  type TripStatus,
} from "@/domain/trips";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One trip, all of it: the way it reads on a client, in the Tern preview, and
 * on its own page. One component, so a trip looks the same wherever somebody
 * opens it — and what they inspect before importing is what they will find
 * after.
 */

export type TripDetailData = {
  title: string;
  status: TripStatus;
  startsOn: string | null;
  endsOn: string | null;
  datesText: string | null;
  partySize: number | null;
  currency: string | null;
  travelers: {
    name: string;
    prefix: string | null;
    primary: boolean;
    email?: string | null;
    phone?: string | null;
    birthday?: string | null;
    customerId?: string | null;
  }[];
  itinerary: ItineraryDay[];
  flags: string[];
  /** Every section of Tern's trip page, for whatever the fields above leave out. */
  sections?: { heading: string | null; tokens: { text: string; role: string }[] }[] | null;
};

export const KIND_ICONS: Record<ItineraryKind, LucideIcon> = {
  flight: Plane,
  hotel: BedDouble,
  transfer: Car,
  dining: Utensils,
  experience: Compass,
  business: Briefcase,
  options: ListTree,
  information: Info,
  other: Luggage,
};

export function tripDates(trip: Pick<TripDetailData, "startsOn" | "endsOn" | "datesText">) {
  if (trip.startsOn && trip.endsOn && trip.startsOn !== trip.endsOn) {
    return `${formatDate(trip.startsOn)} – ${formatDate(trip.endsOn)}`;
  }
  if (trip.startsOn) return formatDate(trip.startsOn);
  return trip.datesText ?? "No dates";
}

export function TripDetail({ trip }: { trip: TripDetailData }) {
  const items = trip.itinerary.reduce((n, day) => n + day.items.length, 0);
  const counts = trip.itinerary
    .flatMap((d) => d.items.map((i) => i.kind))
    .reduce<Record<string, number>>((acc, kind) => ({ ...acc, [kind]: (acc[kind] ?? 0) + 1 }), {});

  return (
    <div className="space-y-6">
      {/* At a glance: the questions somebody opens a trip to answer. */}
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        {[
          ["Status", TRIP_STATUS_LABELS[trip.status]],
          ["Dates", tripDates(trip)],
          ["Travellers", trip.partySize ? String(trip.partySize) : "—"],
          ["Itinerary", items ? `${trip.itinerary.length} days · ${items} items` : "Nothing yet"],
        ].map(([label, value]) => (
          <div key={label} className="bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="tabular mt-0.5 text-sm font-medium">{value}</p>
          </div>
        ))}
      </div>

      {trip.flags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {trip.flags.map((flag) => (
            <Badge key={flag} variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-3" />
              {TRIP_FLAG_LABELS[flag] ?? flag}
            </Badge>
          ))}
        </div>
      ) : null}

      {Object.keys(counts).length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {Object.entries(counts).map(([kind, n]) => {
            const Icon = KIND_ICONS[kind as ItineraryKind] ?? Luggage;
            return (
              <span key={kind} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs">
                <Icon className="size-3.5 text-muted-foreground" />
                {n} {ITINERARY_KIND_LABELS[kind as ItineraryKind] ?? kind}
              </span>
            );
          })}
          {trip.currency ? <span className="rounded-full border border-border px-2.5 py-1 text-xs">Priced in {trip.currency}</span> : null}
        </div>
      ) : null}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Travellers</h3>
        {trip.travelers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No travellers on this trip.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {trip.travelers.map((t, i) => (
              <li key={`${t.name}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-medium">
                  {t.prefix ? `${t.prefix} ` : ""}
                  {t.customerId ? (
                    <Link href={`/clients/${t.customerId}`} className="underline-offset-4 hover:underline">{t.name}</Link>
                  ) : (
                    t.name
                  )}
                </span>
                {t.primary ? <Badge variant="secondary">Lead traveller</Badge> : null}
                <span className="tabular text-xs text-muted-foreground">
                  {[t.email, t.phone, t.birthday ? `born ${t.birthday}` : null].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Day by day</h3>
        <Itinerary days={trip.itinerary} />
      </section>

      {trip.sections && trip.sections.length > 0 ? <EverythingElse sections={trip.sections} /> : null}
    </div>
  );
}

export function Itinerary({ days }: { days: ItineraryDay[] }) {
  const withItems = days.filter((d) => d.items.length > 0 || d.location);
  if (withItems.length === 0) {
    return <p className="text-sm text-muted-foreground">Tern has no itinerary for this trip.</p>;
  }
  return (
    <ol className="space-y-4">
      {withItems.map((day) => (
        <li key={day.day} className="grid gap-2 sm:grid-cols-[6rem_1fr]">
          <div className="text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">Day {day.day}</p>
            {day.location ? <p>{day.location}</p> : day.title ? <p>{day.title}</p> : null}
          </div>
          <ul className="space-y-1.5">
            {day.items.map((item, index) => {
              const Icon = KIND_ICONS[item.kind] ?? Luggage;
              return (
                <li key={item.ternId ?? index} className="rounded-md border border-border px-3 py-2">
                  <div className="flex items-start gap-2 text-sm">
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label={ITINERARY_KIND_LABELS[item.kind]} />
                    <span className="min-w-0 flex-1 font-medium">{item.title}</span>
                    {item.price ? <span className="tabular shrink-0 text-xs text-muted-foreground">{item.price}</span> : null}
                  </div>
                  {item.flightNumber || item.time || item.texts.length ? (
                    <p className="tabular mt-1 ml-6 text-xs text-muted-foreground">
                      {[
                        item.flightNumber ? `${item.flightNumber} · ${item.from} → ${item.to}` : null,
                        item.time,
                        ...item.texts.filter((t) => t.length < 80),
                      ].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/**
 * The rest of Tern's trip page, section by section, as Tern wrote it. Nothing
 * Tern showed is lost, even where Blackbook has no field for it yet.
 */
function EverythingElse({ sections }: { sections: NonNullable<TripDetailData["sections"]> }) {
  const [open, setOpen] = useState(false);
  const shown = sections.filter((s) => s.heading && s.tokens.length && !/^(Global Search)$/.test(s.heading));
  if (shown.length === 0) return null;
  return (
    <section className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold"
      >
        Everything else Tern shows on this trip
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <dl className="divide-y divide-border border-t border-border">
          {shown.map((s, i) => (
            <div key={`${s.heading}-${i}`} className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_1fr]">
              <dt className="text-xs font-medium text-muted-foreground">{s.heading}</dt>
              <dd className="text-sm">{s.tokens.map((t) => t.text).join(" · ")}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
