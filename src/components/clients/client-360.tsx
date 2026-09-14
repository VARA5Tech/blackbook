"use client";

import {
  CalendarHeart,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plane,
  UserRound,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { ActivityTimeline } from "@/components/clients/activity-timeline";
import { BriefMeDialog } from "@/components/clients/brief-me-dialog";
import { ClientDnaPanel } from "@/components/clients/client-dna-panel";
import { HouseholdPanel } from "@/components/clients/household-panel";
import { InteractionPanel } from "@/components/clients/interaction-panel";
import { MilestonePanel } from "@/components/clients/milestone-panel";
import { PreferenceSection } from "@/components/preferences/preference-section";
import { PreferenceProfileForm } from "@/components/preferences/preference-profile-form";
import { Field, Section } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Client360 } from "@/repositories/customer-repository";
import type { CatalogueOption } from "@/domain/preferences";
import {
  GENDER_LABELS,
  displayName,
  executiveAssistantFor,
  fullName,
  initials,
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

export function Client360View({
  record,
  catalogue,
  permissions,
}: {
  record: Client360;
  catalogue: Record<string, CatalogueOption[]>;
  permissions: Client360Permissions;
}) {
  const { customer, household, rm } = record;

  const nextMilestone = record.milestones[0];
  const assistant = executiveAssistantFor(customer, household);

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
                ) : customer.status === "active" ? (
                  <Badge variant="secondary">Active</Badge>
                ) : (
                  <Badge variant="outline">Inactive</Badge>
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
            </a>
          ) : null}

          {customer.whatsapp ? (
            <a
              href={`https://wa.me/${customer.whatsapp.replace(/[^0-9]/g, "")}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 hover:underline"
            >
              <MessageCircle className="size-3.5 text-muted-foreground" />
              WhatsApp
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
      </header>

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="travel">Travel</TabsTrigger>
          <TabsTrigger value="hotels-air">Hotels &amp; air</TabsTrigger>
          <TabsTrigger value="dining">Dining &amp; lifestyle</TabsTrigger>
          <TabsTrigger value="household">Household</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* ---------------- Overview ---------------- */}
        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-8">
              <ClientDnaPanel
                customerId={customer.id}
                clientDna={customer.clientDna}
                directives={record.directives}
                canEdit={permissions.canEdit}
              />

              <Section title="Details">
                <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
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
        </TabsContent>

        {/* ---------------- Travel ---------------- */}
        <TabsContent value="travel" className="mt-6 space-y-8">
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
        </TabsContent>

        {/* ---------------- Hotels and air ---------------- */}
        <TabsContent value="hotels-air" className="mt-6 space-y-8">
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
        </TabsContent>

        {/* ---------------- Dining and lifestyle ---------------- */}
        <TabsContent value="dining" className="mt-6 space-y-8">
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
        </TabsContent>

        {/* ---------------- Household ---------------- */}
        <TabsContent value="household" className="mt-6">
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
        </TabsContent>

        {/* ---------------- Activity ---------------- */}
        <TabsContent value="activity" className="mt-6">
          <div className="grid gap-8 lg:grid-cols-2">
            <InteractionPanel
              customerId={customer.id}
              interactions={record.interactions}
              canLog={permissions.canLogInteraction}
            />
            <ActivityTimeline entries={record.timeline} />
          </div>
        </TabsContent>
      </Tabs>

    </div>
  );
}
