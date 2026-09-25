"use client";

import { Award, Ban, Heart, Plane, UtensilsCrossed } from "lucide-react";
import { Section } from "@/components/page-header";
import { SCALAR_LABELS } from "@/domain/preferences";
import type { PreferenceRow } from "@/components/preferences/preference-section";
import { cn } from "@/lib/utils";

/** Enough of the profile to place somebody without opening a tab. */
type Profile = {
  travelParty: string | null;
  travelBudgetRange: string | null;
  flightCabin: string | null;
  diningDietary: string | null;
};

/** Where a chip lives when somebody wants to change it: a tab, and a card. */
export type JumpTarget = { tab: string; id: string };

/**
 * The section each facet is edited in.
 *
 * Everything on this panel is a summary of something recorded elsewhere, so a
 * chip is only half an answer: reading "Marriott Bonvoy" and then hunting for
 * the tab that holds the membership number is the work this panel was meant to
 * save. Every chip carries the way back to where it is edited.
 */
const FACET_TARGETS: Record<string, JumpTarget> = {
  destination: { tab: "travel", id: "sec-destinations" },
  travel_season: { tab: "travel", id: "sec-destinations" },
  travel_style: { tab: "travel", id: "sec-travel-style" },
  loyalty_programme: { tab: "memberships", id: "sec-loyalty" },
  hotel_brand: { tab: "hotels-air", id: "sec-hotels" },
  hotel_property: { tab: "hotels-air", id: "sec-hotels" },
  room_type: { tab: "hotels-air", id: "sec-hotels" },
  bed_preference: { tab: "hotels-air", id: "sec-hotels" },
  view_preference: { tab: "hotels-air", id: "sec-hotels" },
  airline: { tab: "hotels-air", id: "sec-flights" },
  seat_preference: { tab: "hotels-air", id: "sec-flights" },
  flight_timing: { tab: "hotels-air", id: "sec-flights" },
  cuisine: { tab: "dining", id: "sec-dining" },
  restaurant: { tab: "dining", id: "sec-dining" },
  allergy: { tab: "dining", id: "sec-dining" },
  beverage_preference: { tab: "dining", id: "sec-dining" },
  interest: { tab: "dining", id: "sec-lifestyle" },
  activity: { tab: "dining", id: "sec-lifestyle" },
  luxury_brand: { tab: "dining", id: "sec-lifestyle" },
};

/**
 * The client in one look.
 *
 * Every screen of this kind that works does the same thing: pin the handful of
 * facts somebody checks before they ring, and leave the rest a click away.
 * What belongs here is what a curator would otherwise have to open three tabs
 * to find — what the client holds, what they love, and what would ruin the
 * trip.
 *
 * Nothing is fetched for it. Every value is already loaded for the tabs below,
 * so the panel costs a filter rather than a query.
 */
export function AtAGlance({
  preferences,
  profile,
  dos,
  donts,
  onJump,
  onDna,
}: {
  preferences: PreferenceRow[];
  profile: Profile | null;
  dos: string[];
  donts: string[];
  /** Opens the section the chip is recorded in. */
  onJump: (target: JumpTarget) => void;
  /** The dos and don'ts are written on the client, not in the catalogue. */
  onDna: () => void;
}) {
  const memberships = preferences
    .filter((row) => row.kind === "loyalty_programme")
    .sort((a, b) => a.rank - b.rank);

  const loves = preferences
    .filter((row) => row.polarity === "prefer" && row.kind !== "loyalty_programme")
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 8);

  const avoids = preferences
    .filter((row) => row.polarity === "avoid")
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 6);

  /*
   * The scalar answers worth surfacing. Budget and cabin are what a proposal
   * is built around; who they travel with and what they eat are what gets it
   * wrong when nobody checks.
   */
  const facts = [
    {
      icon: Heart,
      label: "Travels as",
      value: scalar(profile?.travelParty),
      target: { tab: "travel", id: "sec-travel-profile" },
    },
    {
      icon: Award,
      label: "Budget",
      value: scalar(profile?.travelBudgetRange),
      target: { tab: "travel", id: "sec-travel-profile" },
    },
    {
      icon: Plane,
      label: "Cabin",
      value: scalar(profile?.flightCabin),
      target: { tab: "hotels-air", id: "sec-flight-profile" },
    },
    {
      icon: UtensilsCrossed,
      label: "Dietary",
      value: scalar(profile?.diningDietary),
      target: { tab: "dining", id: "sec-dining-profile" },
    },
  ].filter((fact) => fact.value !== null);

  const empty =
    memberships.length === 0 &&
    loves.length === 0 &&
    avoids.length === 0 &&
    facts.length === 0 &&
    donts.length === 0;

  if (empty) {
    return (
      <Section title="At a glance">
        <p className="text-sm text-muted-foreground">
          Nothing recorded yet. Memberships, tastes and the things to avoid
          appear here as they are added.
        </p>
      </Section>
    );
  }

  return (
    <Section title="At a glance">
      <div className="space-y-4 rounded-lg border border-border p-4">
        {facts.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <fact.icon className="size-3.5" />
                  {fact.label}
                </dt>
                <dd className="mt-0.5">
                  <button
                    type="button"
                    onClick={() => onJump(fact.target)}
                    className="text-left text-sm underline-offset-4 hover:underline"
                  >
                    {fact.value}
                  </button>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {memberships.length > 0 ? (
          <Group title="Holds">
            {memberships.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => onJump(FACET_TARGETS[row.kind] ?? FACET_TARGETS.loyalty_programme)}
                title={
                  row.membershipNumber
                    ? `${row.label} · ${row.membershipNumber}`
                    : `Open ${row.label} to add the membership number`
                }
                className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-background px-2 py-0.5 text-xs transition-colors hover:border-foreground/30 hover:bg-muted"
              >
                <span className="font-medium">{row.label}</span>
                {/* The tier is the part that changes how they are treated. */}
                {row.membershipTier ? (
                  <span className="text-muted-foreground">{row.membershipTier}</span>
                ) : null}
              </button>
            ))}
          </Group>
        ) : null}

        {loves.length > 0 ? (
          <Group title="Loves">
            {loves.map((row) => (
              <Tag
                key={row.id}
                tone="prefer"
                onClick={() => onJump(FACET_TARGETS[row.kind])}
              >
                {row.label}
              </Tag>
            ))}
          </Group>
        ) : null}

        {avoids.length > 0 || donts.length > 0 ? (
          <Group title="Never">
            {avoids.map((row) => (
              <Tag
                key={row.id}
                tone="avoid"
                onClick={() => onJump(FACET_TARGETS[row.kind])}
              >
                {row.label}
              </Tag>
            ))}
            {/*
              A written deal-breaker counts the same as a catalogue one on the
              screen, but it is edited somewhere else: it is a line of `donts`
              on the client, so it opens Client DNA rather than a facet.
            */}
            {donts.map((line) => (
              <Tag key={line} tone="avoid" onClick={onDna}>
                {line}
              </Tag>
            ))}
          </Group>
        ) : null}

        {dos.length > 0 ? (
          <Group title="Always">
            {dos.map((line) => (
              <Tag key={line} tone="prefer" onClick={onDna}>
                {line}
              </Tag>
            ))}
          </Group>
        ) : null}
      </div>
    </Section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-3 first:border-0 first:pt-0">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {title === "Never" ? <Ban className="size-3.5" /> : null}
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Tag({
  tone,
  onClick,
  children,
}: {
  tone: "prefer" | "avoid";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "max-w-full truncate rounded-sm px-2 py-0.5 text-xs transition-opacity hover:opacity-80",
        tone === "prefer"
          ? "bg-[color:var(--polarity-prefer-bg)] text-[color:var(--polarity-prefer)]"
          : "bg-[color:var(--polarity-avoid-bg)] text-[color:var(--polarity-avoid)]",
      )}
    >
      {children}
    </button>
  );
}

/** Enum keys read the way the screens read them, never as the key. */
function scalar(value: string | null | undefined): string | null {
  if (!value) return null;
  return SCALAR_LABELS[value] ?? value.replace(/_/g, " ");
}
