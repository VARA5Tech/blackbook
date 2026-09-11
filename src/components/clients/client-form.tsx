"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  archiveClientAction,
  createClientAction,
  restoreClientAction,
  updateClientAction,
} from "@/actions/client-actions";
import { Section } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Customer } from "@/db/schema";
import {
  CLIENT_STATUSES,
  GENDERS,
  GENDER_LABELS,
  HOUSEHOLD_ROLES,
  HOUSEHOLD_ROLE_LABELS,
} from "@/domain/customers";
import { humanise } from "@/lib/format";

const NONE = "__none__";

type HouseholdOption = { id: string; ref: string; name: string };
type StaffOption = { id: string; name: string };

type Draft = Record<string, string>;

function toDraft(customer?: Customer | null): Draft {
  return {
    firstName: customer?.firstName ?? "",
    lastName: customer?.lastName ?? "",
    preferredName: customer?.preferredName ?? "",
    mobile: customer?.mobile ?? "",
    whatsapp: customer?.whatsapp ?? "",
    email: customer?.email ?? "",
    dateOfBirth: customer?.dateOfBirth ?? "",
    gender: customer?.gender ?? "",
    nationality: customer?.nationality ?? "",
    city: customer?.city ?? "",
    address: customer?.address ?? "",
    locationUrl: customer?.locationUrl ?? "",
    householdId: customer?.householdId ?? "",
    householdRole: customer?.householdRole ?? "",
    primaryRmId: customer?.primaryRmId ?? "",
    customerSince:
      customer?.customerSince ?? new Date().toISOString().slice(0, 10),
    status: customer?.status ?? "active",
  };
}

export function ClientForm({
  customer,
  households,
  staff,
  canArchive,
  canReassign,
}: {
  customer?: Customer | null;
  households: HouseholdOption[];
  staff: StaffOption[];
  canArchive: boolean;
  canReassign: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => toDraft(customer));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const isEdit = Boolean(customer);

  function set(key: string, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const payload = {
        ...draft,
        householdId: draft.householdId || null,
        primaryRmId: draft.primaryRmId || null,
      };

      const result = isEdit
        ? await updateClientAction({
            ...payload,
            id: customer!.id,
          } as Parameters<typeof updateClientAction>[0])
        : await createClientAction(
            payload as Parameters<typeof createClientAction>[0],
          );

      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }

      toast.success(isEdit ? "Client updated" : "Client created");
      router.push(
        isEdit
          ? `/clients/${customer!.id}`
          : `/clients/${(result.data as { id: string }).id}`,
      );
      router.refresh();
    });
  }

  function toggleArchive() {
    if (!customer) return;
    startTransition(async () => {
      const result = customer.archivedAt
        ? await restoreClientAction(customer.id)
        : await archiveClientAction(customer.id);

      if (result.ok) {
        toast.success(customer.archivedAt ? "Client restored" : "Client archived");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="max-w-3xl space-y-8">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Section title="Identity">
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="First name"
            name="firstName"
            value={draft.firstName}
            onChange={set}
            errors={fieldErrors.firstName}
            required
          />
          <FormField
            label="Last name"
            name="lastName"
            value={draft.lastName}
            onChange={set}
            errors={fieldErrors.lastName}
          />
          <FormField
            label="Preferred name"
            name="preferredName"
            value={draft.preferredName}
            onChange={set}
            hint="What the team should call them."
          />
          <FormField
            label="Date of birth"
            name="dateOfBirth"
            type="date"
            value={draft.dateOfBirth}
            onChange={set}
            errors={fieldErrors.dateOfBirth}
          />

          <div className="space-y-2">
            <Label htmlFor="gender">Gender</Label>
            <Select
              value={draft.gender || NONE}
              onValueChange={(value) =>
                set("gender", value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="gender">
                <SelectValue placeholder="Not recorded" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not recorded</SelectItem>
                {GENDERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {GENDER_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <FormField
            label="Nationality"
            name="nationality"
            value={draft.nationality}
            onChange={set}
            hint="Two-letter country code, e.g. IN."
          />
        </div>
      </Section>

      <Section title="Contact">
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="Mobile number"
            name="mobile"
            value={draft.mobile}
            onChange={set}
            errors={fieldErrors.mobile}
            placeholder="+91 98100 11223"
          />
          <FormField
            label="WhatsApp number"
            name="whatsapp"
            value={draft.whatsapp}
            onChange={set}
            errors={fieldErrors.whatsapp}
            placeholder="+91 98100 11223"
          />
          <FormField
            label="Email"
            name="email"
            type="email"
            value={draft.email}
            onChange={set}
            errors={fieldErrors.email}
          />
          <FormField
            label="City"
            name="city"
            value={draft.city}
            onChange={set}
          />

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="address">Address</Label>
            <Textarea
              id="address"
              rows={2}
              value={draft.address}
              onChange={(event) => set("address", event.target.value)}
            />
          </div>

          <FormField
            label="Google pin"
            name="locationUrl"
            value={draft.locationUrl}
            onChange={set}
            className="sm:col-span-2"
            hint="Paste a Google Maps share link."
          />
        </div>
      </Section>

      <Section title="Relationship">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="householdId">Household</Label>
            <Select
              value={draft.householdId || NONE}
              onValueChange={(value) =>
                set("householdId", value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="householdId">
                <SelectValue placeholder="No household" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No household</SelectItem>
                {households.map((household) => (
                  <SelectItem key={household.id} value={household.id}>
                    {household.name} · {household.ref}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="householdRole">Role in household</Label>
            <Select
              value={draft.householdRole || NONE}
              onValueChange={(value) =>
                set("householdRole", value === NONE ? "" : value)
              }
              disabled={!draft.householdId}
            >
              <SelectTrigger id="householdRole">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {HOUSEHOLD_ROLES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {HOUSEHOLD_ROLE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="primaryRmId">Primary relationship manager</Label>
            <Select
              value={draft.primaryRmId || NONE}
              onValueChange={(value) =>
                set("primaryRmId", value === NONE ? "" : value)
              }
              disabled={isEdit && !canReassign}
            >
              <SelectTrigger id="primaryRmId">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Unassigned</SelectItem>
                {staff.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit && !canReassign ? (
              <p className="text-xs text-muted-foreground">
                Only a manager can reassign a client.
              </p>
            ) : null}
          </div>

          <FormField
            label="Client since"
            name="customerSince"
            type="date"
            value={draft.customerSince}
            onChange={set}
            errors={fieldErrors.customerSince}
          />

          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={draft.status}
              onValueChange={(value) => set("status", value)}
            >
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLIENT_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {humanise(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
        <div className="flex gap-2">
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {isEdit ? "Save changes" : "Create client"}
          </Button>
          <Button variant="ghost" asChild>
            <Link href={isEdit ? `/clients/${customer!.id}` : "/clients"}>
              Cancel
            </Link>
          </Button>
        </div>

        {isEdit && canArchive ? (
          <Button
            variant={customer!.archivedAt ? "outline" : "ghost"}
            onClick={toggleArchive}
            disabled={pending}
            className={customer!.archivedAt ? "" : "text-destructive"}
          >
            {customer!.archivedAt ? "Restore client" : "Archive client"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function FormField({
  label,
  name,
  value,
  onChange,
  type = "text",
  errors,
  hint,
  placeholder,
  required,
  className,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (name: string, value: string) => void;
  type?: string;
  errors?: string[];
  hint?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label htmlFor={name}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Input
        id={name}
        type={type}
        value={value}
        placeholder={placeholder}
        aria-invalid={errors ? true : undefined}
        onChange={(event) => onChange(name, event.target.value)}
      />
      {errors?.length ? (
        <p className="text-xs text-destructive">{errors[0]}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
