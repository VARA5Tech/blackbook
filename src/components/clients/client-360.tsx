"use client";

import {
  CalendarHeart,
  PanelTop,
  Rows3,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plane,
  Sparkles,
  UserRound,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ActivityTimeline } from "@/components/clients/activity-timeline";
import { BriefMeDialog } from "@/components/clients/brief-me-dialog";
import { ClientDnaPanel } from "@/components/clients/client-dna-panel";
import { HouseholdPanel } from "@/components/clients/household-panel";
import { InteractionPanel } from "@/components/clients/interaction-panel";
import { InterestStrip } from "@/components/clients/interest-panel";
import { MilestonePanel } from "@/components/clients/milestone-panel";
import { PreferenceSection } from "@/components/preferences/preference-section";
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
  GENDER_LABELS,
  displayName,
  executiveAssistantFor,
  fullName,
  initials,
  CLIENT_STATUS_LABELS,
} from "@/domain/customers";
import { countdown, formatDate, humanise, timeAgo } from "@/lib/format";

export type Client360Permissions = {
  canEdit: boolean;
  canArchive: boolean;
  canLogInteraction: boolean;
  canManageMilestones: boolean;
  canUpdatePreferences: boolean;
  canUseAi: boolean;
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
}: {
  record: Client360;
  catalogue: Record<string, CatalogueOption[]>;
  permissions: Client360Permissions;
  interest: InterestSummaryRow[];
  replays: SessionReplay[];
  signals: ClientSignals | null;
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
  const views = [
    {
      value: "overview",
      label: <>Overview</>,
      content: (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-8">
              <ClientDnaPanel
                customerId={customer.id}
                clientDna={customer.clientDna}
                dos={record.customer.dos}
                donts={record.customer.donts}
                canEdit={permissions.canEdit}
              />

              <Section title="Details">
                <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Mobile">
                    <span className="tabular">{customer.mobile ?? "—"}</span>
                  </Field>
                  <Field label="WhatsApp">
                    <span className="tabular">{customer.whatsapp ?? "—"}</span>
                  </Field>
                  <Field label="Email">{customer.email ?? "—"}</Field>
                  <Field label="Date of birth">
                    {formatDate(customer.dateOfBirth)}
                  </Field>
                  <Field label="Gender">
                    {customer.gender ? GENDER_LABELS[customer.gender] : "—"}
                  </Field>
                  <Field label="Nationality">
                    {customer.nationality ?? "—"}
                  </Field>
                  <Field label="City">{customer.city ?? "—"}</Field>
                  <Field label="Address" className="sm:col-span-2">
                    {customer.address ?? "—"}
                  </Field>
                  {assistant?.notes ? (
                    <Field label="Assistant notes" className="sm:col-span-2">
                      {assistant.notes}
                    </Field>
                  ) : null}
                  {customer.remarks ? (
                    <Field label="Remarks" className="sm:col-span-2 lg:col-span-3">
                      <span className="whitespace-pre-line">{customer.remarks}</span>
                    </Field>
                  ) : null}
                  <Field label="Profile last updated">
                    {formatDate(customer.profileUpdatedAt)}
                  </Field>
                </dl>
              </Section>
            </div>

            <div className="space-y-8">
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
        
      ),
    },
    {
      value: "travel",
      label: <>Travel</>,
      content: (
        <div className="space-y-8">
            <PreferenceSection
              customerId={customer.id}
              title="Destinations"
              kinds={["destination", "travel_season"]}
              catalogue={catalogue}
              preferences={record.preferences}
              canEdit={permissions.canUpdatePreferences}
            />
            <PreferenceSection
              customerId={customer.id}
              title="Travel style"
              kinds={["travel_style"]}
              catalogue={catalogue}
              preferences={record.preferences}
              canEdit={permissions.canUpdatePreferences}
            />
            <PreferenceProfileForm
              customerId={customer.id}
              profile={record.profile}
              group="travel"
              canEdit={permissions.canUpdatePreferences}
            />
        
        </div>
      ),
    },
    {
      value: "hotels-air",
      label: <>Hotels &amp; air</>,
      content: (
        <div className="space-y-8">
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
            <PreferenceProfileForm
              customerId={customer.id}
              profile={record.profile}
              group="hotel"
              canEdit={permissions.canUpdatePreferences}
            />

            <PreferenceSection
              customerId={customer.id}
              title="Flights"
              icon={<Plane className="size-4" />}
              kinds={[
                "airline",
                "loyalty_programme",
                "seat_preference",
                "flight_timing",
              ]}
              catalogue={catalogue}
              preferences={record.preferences}
              canEdit={permissions.canUpdatePreferences}
            />
            <PreferenceProfileForm
              customerId={customer.id}
              profile={record.profile}
              group="flight"
              canEdit={permissions.canUpdatePreferences}
            />
        
        </div>
      ),
    },
    {
      value: "dining",
      label: <>Dining &amp; lifestyle</>,
      content: (
        <div className="space-y-8">
            <PreferenceSection
              customerId={customer.id}
              title="Dining"
              icon={<UtensilsCrossed className="size-4" />}
              kinds={["cuisine", "restaurant", "allergy", "beverage_preference"]}
              catalogue={catalogue}
              preferences={record.preferences}
              canEdit={permissions.canUpdatePreferences}
            />
            <PreferenceProfileForm
              customerId={customer.id}
              profile={record.profile}
              group="dining"
              canEdit={permissions.canUpdatePreferences}
            />

            <PreferenceSection
              customerId={customer.id}
              title="Lifestyle and experiences"
              kinds={["interest", "activity", "luxury_brand"]}
              catalogue={catalogue}
              preferences={record.preferences}
              canEdit={permissions.canUpdatePreferences}
            />
            <PreferenceProfileForm
              customerId={customer.id}
              profile={record.profile}
              group="lifestyle"
              canEdit={permissions.canUpdatePreferences}
            />
        
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
    <div className="space-y-8">
      <header className="space-y-5">
        <Link
          href="/clients"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Clients
        </Link>

        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
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

          <div className="flex shrink-0 flex-wrap gap-2">
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

          <span className="flex items-center gap-1.5 text-muted-foreground">
            Last contacted {timeAgo(customer.lastInteractionAt)}
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

        <InterestStrip
          customerId={customer.id}
          interest={interest}
          replays={replays}
          signals={signals}
        />

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
              Asked the Curator about {asked.title}, {timeAgo(asked.askedAt)}
            </span>
          </div>
        ) : null}
      </header>

      <div className="flex justify-end">
        <LayoutToggle value={layout} onChange={chooseLayout} />
      </div>

      {layout === "tabs" ? (
        <Tabs defaultValue="overview">
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
        <div className="space-y-12">
          {views.map((view) => (
            <section key={view.value} className="space-y-6">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-xl tracking-tight">
                  {view.label}
                </h2>
                <div className="h-px flex-1 bg-border" />
              </div>
              {view.content}
            </section>
          ))}
        </div>
      )}

    </div>
  );
}
