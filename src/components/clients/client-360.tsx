"use client";

import {
  CalendarHeart,
  PanelTop,
  Rows3,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Pencil,
  Phone,
  Plane,
  Sparkles,
  UserRound,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ActivityTimeline } from "@/components/clients/activity-timeline";
import { BriefMeDialog } from "@/components/clients/brief-me-dialog";
import { ClientDetails } from "@/components/clients/client-details";
import { ClientDnaStrip } from "@/components/clients/client-dna-panel";
import { HouseholdPanel } from "@/components/clients/household-panel";
import { InteractionPanel } from "@/components/clients/interaction-panel";
import { InterestStrip } from "@/components/clients/interest-panel";
import { MilestonePanel } from "@/components/clients/milestone-panel";
import { PreferenceSection } from "@/components/preferences/preference-section";
import { LeadPanel, type ClientLead } from "@/components/leads/lead-panel";
import { AtAGlance, type JumpTarget } from "@/components/clients/at-a-glance";
import {
  TravelDocumentsCard,
  TripsPanel,
  type TravelDocumentView,
  type TripView,
} from "@/components/clients/trips-panel";
import { TernSearchDialog } from "@/components/clients/tern-import";
import { DocumentsCard, type DocumentView } from "@/components/clients/documents-card";
import { PreferenceProfileForm } from "@/components/preferences/preference-profile-form";
import { Field, Section } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Client360, InterestSummaryRow } from "@/repositories/customer-repository";
import type { ClientSignals, SessionReplay } from "@/lib/posthog";
import type { CatalogueOption } from "@/domain/preferences";
import {
  displayName,
  executiveAssistantFor,
  fullName,
  initials,
  CLIENT_STATUS_LABELS,
} from "@/domain/customers";
import { countdown, formatDate, humanise, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Client360Permissions = {
  canEdit: boolean;
  canArchive: boolean;
  canLogInteraction: boolean;
  canManageMilestones: boolean;
  canUpdatePreferences: boolean;
  canUseAi: boolean;
  canWorkLeads: boolean;
  canAssignLeads: boolean;
  canRevealDocuments: boolean;
  canManageDocuments: boolean;
};

/** Tabs, or one long page. Remembered per browser, never per client. */
type Layout = "tabs" | "page";
const LAYOUT_KEY = "blackbook.client-layout";

/**
 * The preference lives in the browser, so React reads it as an external store
 * rather than copying it into state on mount. A second tab changing it keeps
 * every open client record in step.
 */
const listeners = new Set<() => void>();
let current: Layout | null = null;

function readLayout(): Layout {
  try {
    const saved = window.localStorage.getItem(LAYOUT_KEY);
    return saved === "page" ? "page" : "tabs";
  } catch {
    // Private windows and locked-down browsers refuse storage outright.
    return "tabs";
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== LAYOUT_KEY) return;
    current = null;
    listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function snapshot(): Layout {
  current ??= readLayout();
  return current;
}

function chooseLayout(next: Layout): void {
  current = next;
  try {
    window.localStorage.setItem(LAYOUT_KEY, next);
  } catch {
    // A browser refusing storage still gets the choice for this visit.
  }
  for (const listener of listeners) listener();
}

/**
 * A card something can be sent to.
 *
 * The ring is not decoration: a jump can land three cards down a long tab, and
 * without it somebody arrives looking at whatever happens to be under their
 * eyes. It fades on its own, because a permanent highlight is noise.
 */
function Anchor({
  id,
  landed,
  children,
}: {
  id: string;
  landed: string | null;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className={cn(
        // Clears the desk bar and a little air above the card.
        "scroll-mt-24 rounded-lg transition-shadow duration-300",
        landed === id && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background",
      )}
    >
      {children}
    </div>
  );
}

function LayoutToggle({
  value,
  onChange,
}: {
  value: Layout;
  onChange: (next: Layout) => void;
}) {
  const options = [
    { key: "tabs" as const, icon: PanelTop, label: "Tabbed" },
    { key: "page" as const, icon: Rows3, label: "One page" },
  ];

  return (
    <div className="flex shrink-0 items-center rounded-md border border-border p-0.5">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
            value === option.key
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <option.icon className="size-3.5" />
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Client360View({
  record,
  catalogue,
  permissions,
  interest,
  replays,
  signals,
  leads,
  staff,
  trips,
  travelDocuments,
  ternEnabled,
  documents,
  documentsEnabled,
}: {
  record: Client360;
  catalogue: Record<string, CatalogueOption[]>;
  permissions: Client360Permissions;
  interest: InterestSummaryRow[];
  replays: SessionReplay[];
  signals: ClientSignals | null;
  leads: ClientLead[];
  staff: { id: string; name: string }[];
  trips: TripView[];
  travelDocuments: TravelDocumentView[];
  /** The Tern bridge is configured, so Populate can be offered. */
  ternEnabled: boolean;
  documents: DocumentView[];
  /** Object storage is configured, so the documents card can appear. */
  documentsEnabled: boolean;
}) {
  const { customer, household, rm } = record;

  const nextMilestone = record.milestones[0];
  // Sorted asked-first, so if anything was asked about it is the first line.
  const asked = interest[0]?.askedAt ? interest[0] : null;
  const assistant = executiveAssistantFor(customer, household);

  // "tabs" on the server; the remembered choice takes over on hydration.
  const layout = useSyncExternalStore(subscribe, snapshot, () => "tabs" as Layout);

  /**
   * The six faces of a client record, written once and shown either as tabs
   * or stacked down a single page. Which one somebody prefers is a working
   * habit rather than a property of the client, so it is remembered on the
   * device and never written to the record.
   */
  /** Which tab is showing, so a gap can take somebody straight to it. */
  const [view, setView] = useState("overview");
  const [dnaOpen, setDnaOpen] = useState(false);
  /** The card a jump just landed on, ringed for a moment so the eye finds it. */
  const [landed, setLanded] = useState<string | null>(null);

  /**
   * Takes somebody from a chip in At a glance to the card that records it.
   *
   * Two frames before scrolling: naming the tab mounts its panel, and asking
   * for an element the same tick asks for one that is not in the document yet.
   * In one-page layout the tab name changes nothing and every card is already
   * there, so the same call works for both.
   */
  function jumpTo(target: JumpTarget) {
    setView(target.tab);
    setLanded(target.id);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .getElementById(target.id)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    window.setTimeout(() => setLanded(null), 1800);
  }

  const views = [
    {
      value: "overview",
      label: <>Overview</>,
      content: (
          <div className="space-y-5">
              <LeadPanel
                customerId={customer.id}
                leads={leads}
                staff={staff}
                canWork={permissions.canWorkLeads}
                canAssign={permissions.canAssignLeads}
              />

              {/*
                Client DNA is not here any more: it is the strip above the
                leads, where it is read, and the whole of it opens from there.
              */}
              <ClientDetails
                customer={customer}
                household={household}
                canEdit={permissions.canEdit}
              />
            </div>

        
      ),
    },
    {
      value: "trips",
      label: <>Trips{trips.length ? ` (${trips.length})` : ""}</>,
      content: (
        <div className="space-y-5">
          <TripsPanel
            customerId={customer.id}
            trips={trips}
            populate={
              ternEnabled && permissions.canEdit ? (
                <TernSearchDialog
                  customerId={customer.id}
                  label={customer.ternId ? "Refresh from Tern" : "Populate from Tern"}
                />
              ) : null
            }
          />
          <TravelDocumentsCard
            customerId={customer.id}
            documents={travelDocuments}
            canReveal={permissions.canRevealDocuments}
          />
          {documentsEnabled ? (
            <DocumentsCard
              customerId={customer.id}
              documents={documents}
              canManage={permissions.canManageDocuments}
            />
          ) : null}
        </div>
      ),
    },
    {
      value: "travel",
      label: <>Travel</>,
      content: (
        <div className="space-y-8">
          <Anchor id="sec-destinations" landed={landed}>
            <PreferenceSection
              customerId={customer.id}
              title="Destinations"
              kinds={["destination", "travel_season"]}
              catalogue={catalogue}
              preferences={record.preferences}
              canEdit={permissions.canUpdatePreferences}
            />
          </Anchor>
          <Anchor id="sec-travel-style" landed={landed}>
            <PreferenceSection
              customerId={customer.id}
              title="Travel style"
              kinds={["travel_style"]}
              catalogue={catalogue}
              preferences={record.preferences}
              canEdit={permissions.canUpdatePreferences}
            />
          </Anchor>
          <Anchor id="sec-travel-profile" landed={landed}>
            <PreferenceProfileForm
              customerId={customer.id}
              profile={record.profile}
              group="travel"
              canEdit={permissions.canUpdatePreferences}
            />
          </Anchor>
        </div>
      ),
    },
    {
      value: "memberships",
      label: <>Loyalty &amp; memberships</>,
      content: (
        <div className="space-y-8">
          {/*
            Every programme in one place, airline and hotel alike. They were
            split across Hotels and Flights, which meant checking two screens
            to answer "what does this client hold", and a cruise or a car hire
            scheme belonged to neither.
          */}
          <Anchor id="sec-loyalty" landed={landed}>
            <PreferenceSection
              customerId={customer.id}
              title="Loyalty and memberships"
              icon={<Sparkles className="size-4" />}
              kinds={["loyalty_programme"]}
              catalogue={catalogue}
              preferences={record.preferences}
              canEdit={permissions.canUpdatePreferences}
            />
          </Anchor>
        </div>
      ),
    },
    {
      value: "hotels-air",
      label: <>Hotels &amp; flights</>,
      content: (
        <div className="space-y-8">
          <Anchor id="sec-hotels" landed={landed}>
            <PreferenceSection
              customerId={customer.id}
              title="Hotels"
              kinds={[
                "hotel_brand",
                "hotel_property",
                "room_type",
                "bed_preference",
                "view_preference",
              ]}
              catalogue={catalogue}
              preferences={record.preferences}
              canEdit={permissions.canUpdatePreferences}
            />
          </Anchor>
          <Anchor id="sec-hotel-profile" landed={landed}>
            <PreferenceProfileForm
              customerId={customer.id}
              profile={record.profile}
              group="hotel"
              canEdit={permissions.canUpdatePreferences}
            />
          </Anchor>

          <Anchor id="sec-flights" landed={landed}>
            <PreferenceSection
              customerId={customer.id}
              title="Flights"
              icon={<Plane className="size-4" />}
              kinds={[
                "airline",
                "seat_preference",
                "flight_timing",
              ]}
              catalogue={catalogue}
              preferences={record.preferences}
              canEdit={permissions.canUpdatePreferences}
            />
          </Anchor>
          <Anchor id="sec-flight-profile" landed={landed}>
            <PreferenceProfileForm
              customerId={customer.id}
              profile={record.profile}
              group="flight"
              canEdit={permissions.canUpdatePreferences}
            />
          </Anchor>
        </div>
      ),
    },
    {
      value: "dining",
      label: <>Lifestyle</>,
      content: (
        <div className="space-y-8">
          <Anchor id="sec-dining" landed={landed}>
            <PreferenceSection
              customerId={customer.id}
              title="Dining"
              icon={<UtensilsCrossed className="size-4" />}
              kinds={["cuisine", "restaurant", "allergy", "beverage_preference"]}
              catalogue={catalogue}
              preferences={record.preferences}
              canEdit={permissions.canUpdatePreferences}
            />
          </Anchor>
          <Anchor id="sec-dining-profile" landed={landed}>
            <PreferenceProfileForm
              customerId={customer.id}
              profile={record.profile}
              group="dining"
              canEdit={permissions.canUpdatePreferences}
            />
          </Anchor>

          <Anchor id="sec-lifestyle" landed={landed}>
            <PreferenceSection
              customerId={customer.id}
              title="Lifestyle and experiences"
              kinds={["interest", "activity", "luxury_brand"]}
              catalogue={catalogue}
              preferences={record.preferences}
              canEdit={permissions.canUpdatePreferences}
            />
          </Anchor>
          <Anchor id="sec-lifestyle-profile" landed={landed}>
            <PreferenceProfileForm
              customerId={customer.id}
              profile={record.profile}
              group="lifestyle"
              canEdit={permissions.canUpdatePreferences}
            />
          </Anchor>
        </div>
      ),
    },
    {
      value: "household",
      label: <>Household</>,
      content: (
        <>
          {household ? (
            <div className="space-y-8">
              <Section
                title="Household"
                action={
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/households/${household.id}`}>
                      Open household
                    </Link>
                  </Button>
                }
              >
                <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-3">
                  <Field label="Household">{household.name}</Field>
                  <Field label="Household ID">
                    <span className="tabular">{household.ref}</span>
                  </Field>
                  <Field label="City">{household.city ?? "—"}</Field>
                  <Field label="Travel pattern">
                    {humanise(household.travelPattern)}
                  </Field>
                  <Field label="Notes" className="sm:col-span-2">
                    {household.notes ?? "—"}
                  </Field>
                </dl>
              </Section>

              <HouseholdPanel
                household={household}
                members={record.householdMembers}
                currentCustomerId={customer.id}
                expanded
              />
            </div>
          ) : (
            <Section title="Household">
              <p className="text-sm text-muted-foreground">
                This client is not linked to a household yet. Link one from the
                edit screen to manage the family as a unit.
              </p>
            </Section>
          )}
        </>
      ),
    },
    {
      value: "activity",
      label: <>Activity</>,
      content: (
        <div className="grid gap-8 lg:grid-cols-2">
          <InteractionPanel
            customerId={customer.id}
            interactions={record.interactions}
            canLog={permissions.canLogInteraction}
          />
          <ActivityTimeline entries={record.timeline} />
        </div>
      ),
    },
  ];

  /**
   * Nearly every client here is reached on WhatsApp and few have anything else,
   * so the number itself is what the desk needs to read; a link saying only
   * "WhatsApp" hid it. One number serving both is shown once, labelled for both.
   */
  const sameNumber =
    Boolean(customer.mobile) &&
    customer.mobile?.replace(/\D/g, "") === customer.whatsapp?.replace(/\D/g, "");

  return (
    <div className="space-y-5">
      <Link
        href="/clients"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Clients
      </Link>

      {/*
        One rail down the side of the whole page, not one per section.
        Giving the header its own right column and the body another left a
        band of dead space between them, and put what a curator reads before
        a call below the fold. The rail starts at the top and stays put.
      */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] lg:items-start">
        <div className="min-w-0 space-y-5">
          <header className="space-y-5">
            <div className="flex min-w-0 gap-4">
              <Avatar className="size-14 shrink-0">
                <AvatarFallback className="font-display text-lg">
                  {initials(customer)}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="font-display text-3xl leading-none tracking-tight">
                    {displayName(customer)}
                  </h1>
                  {customer.archivedAt ? (
                    <Badge variant="outline">Archived</Badge>
                  ) : (
                    <Badge
                      variant={customer.status === "active" ? "secondary" : "outline"}
                    >
                      {CLIENT_STATUS_LABELS[customer.status]}
                    </Badge>
                  )}
                </div>

                {customer.preferredName &&
                customer.preferredName !== fullName(customer) ? (
                  <p className="text-sm text-muted-foreground">
                    {fullName(customer)}
                  </p>
                ) : null}

                <p className="tabular text-sm text-muted-foreground">
                  {customer.ref}
                  {customer.city ? ` · ${customer.city}` : ""}
                  {` · Client since ${formatDate(customer.customerSince)}`}
                </p>

                <p className="text-sm text-muted-foreground">
                  Relationship manager:{" "}
                  <span className="text-foreground">
                    {rm?.name ?? "Unassigned"}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {customer.mobile ? (
            <a
              href={`tel:${customer.mobile}`}
              className="flex items-center gap-1.5 hover:underline"
            >
              <Phone className="size-3.5 text-muted-foreground" />
              <span className="tabular">{customer.mobile}</span>
              <span className="text-muted-foreground">
                {sameNumber ? "mobile, WhatsApp" : "mobile"}
              </span>
            </a>
          ) : null}

          {customer.whatsapp && !sameNumber ? (
            <a
              href={`https://wa.me/${customer.whatsapp.replace(/[^0-9]/g, "")}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 hover:underline"
            >
              <MessageCircle className="size-3.5 text-muted-foreground" />
              <span className="tabular">{customer.whatsapp}</span>
              <span className="text-muted-foreground">WhatsApp</span>
            </a>
          ) : null}

          {customer.email ? (
            <a
              href={`mailto:${customer.email}`}
              className="flex items-center gap-1.5 hover:underline"
            >
              <Mail className="size-3.5 text-muted-foreground" />
              {customer.email}
            </a>
          ) : null}

          {customer.locationUrl ? (
            <a
              href={customer.locationUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 hover:underline"
            >
              <MapPin className="size-3.5 text-muted-foreground" />
              Location pin
            </a>
          ) : null}

          {/*
            Comes from logged interactions and nothing else: it is the date of
            the most recent one, so an empty one says so rather than implying
            the client has been ignored.
          */}
          <span
            className="flex items-center gap-1.5 text-muted-foreground"
            title={
              customer.lastInteractionAt
                ? "The most recent interaction logged for this client"
                : "Set automatically when someone logs a call, meeting or message in Interactions"
            }
          >
            <MessageSquare className="size-3.5" />
            {customer.lastInteractionAt
              ? `Last contacted ${timeAgo(customer.lastInteractionAt)}`
              : "No interaction logged yet"}
          </span>
        </div>

        {assistant ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            <span className="flex items-center gap-1.5">
              <UserRound className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">
                {assistant.fromHousehold ? "Household assistant" : "Assistant"}
              </span>
              <span>{assistant.name ?? "Name not recorded"}</span>
            </span>
            {assistant.phone ? (
              <a
                href={`tel:${assistant.phone}`}
                className="tabular flex items-center gap-1.5 hover:underline"
              >
                <Phone className="size-3.5 text-muted-foreground" />
                {assistant.phone}
              </a>
            ) : null}
            {assistant.email ? (
              <a
                href={`mailto:${assistant.email}`}
                className="flex items-center gap-1.5 hover:underline"
              >
                <Mail className="size-3.5 text-muted-foreground" />
                {assistant.email}
              </a>
            ) : null}
          </div>
        ) : null}



        {nextMilestone ? (
          <div className="flex items-center gap-2 rounded-md border border-accent bg-accent/40 px-3 py-2 text-sm text-accent-foreground">
            <CalendarHeart className="size-4 shrink-0" />
            <span>
              {nextMilestone.title} on{" "}
              {formatDate(nextMilestone.nextOccurrence)},{" "}
              {countdown(nextMilestone.daysUntil)}
            </span>
          </div>
        ) : null}

        {asked ? (
          <div className="flex items-center gap-2 rounded-md border border-accent bg-accent/40 px-3 py-2 text-sm text-accent-foreground">
            <Sparkles className="size-4 shrink-0" />
            <span>
              Texted the Curator about {asked.title}, {timeAgo(asked.askedAt)}
            </span>
          </div>
        ) : null}

            {/*
              Above the leads, because it is read before them. Two lines of it
              here and the whole record a click away, so the three things worth
              a glance — who they are, what they have asked for, what they hold
              — fit on one screen and scrolling means detail or editing.
            */}
            <ClientDnaStrip
              open={dnaOpen}
              onOpenChange={setDnaOpen}
              customerId={customer.id}
              clientDna={customer.clientDna}
              dos={record.customer.dos}
              donts={record.customer.donts}
              canEdit={permissions.canEdit}
            />

          </header>

      {layout === "tabs" ? (
        <Tabs value={view} onValueChange={setView}>
          {/*
            * Horizontal scrolling is wanted on a narrow window; the vertical
            * scrollbar that came with it was not. Leaving overflow-y to compute
            * itself puts a permanent set of arrows at the end of the row.
            */}
          <TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden">
            {views.map((view) => (
              <TabsTrigger key={view.value} value={view.value}>
                {view.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {views.map((view) => (
            <TabsContent key={view.value} value={view.value} className="mt-6">
              {view.content}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <div className="space-y-8">
          {views.map((view) => (
            <section key={view.value}>{view.content}</section>
          ))}
        </div>
      )}
        </div>

        {/*
          What the desk reads before it rings: the one look first, then what
          they have been doing, who they belong to and what is coming.
        */}
        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {/*
              A display preference, so it sits with the other page controls
              rather than taking a whole row out of the first screen.
            */}
            <LayoutToggle value={layout} onChange={chooseLayout} />
            {permissions.canUseAi ? (
              <BriefMeDialog
                customerId={customer.id}
                customerName={displayName(customer)}
              />
            ) : null}
            {permissions.canEdit ? (
              <Button asChild>
                <Link href={`/clients/${customer.id}/edit`}>
                  <Pencil />
                  Edit
                </Link>
              </Button>
            ) : null}
          </div>

          <AtAGlance
            preferences={record.preferences}
            profile={record.profile}
            dos={record.customer.dos}
            donts={record.customer.donts}
            onJump={jumpTo}
            onDna={() => setDnaOpen(true)}
          />

          <InterestStrip
            customerId={customer.id}
            interest={interest}
            replays={replays}
            signals={signals}
          />

          <HouseholdPanel
            household={household}
            members={record.householdMembers}
            currentCustomerId={customer.id}
          />

          <MilestonePanel
            milestones={record.milestones}
            customerId={customer.id}
            canManage={permissions.canManageMilestones}
          />
        </div>
      </div>
    </div>
  );
}
