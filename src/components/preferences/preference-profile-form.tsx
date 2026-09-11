"use client";

import { Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updatePreferenceProfileAction } from "@/actions/crm-actions";
import { Field, Section } from "@/components/page-header";
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
import type { CustomerPreferenceProfile } from "@/db/schema";
import { scalarLabel } from "@/domain/preferences";

const NONE = "__none__";

type Group = "travel" | "hotel" | "flight" | "dining" | "lifestyle";

type SelectField = {
  key: keyof CustomerPreferenceProfile;
  label: string;
  options: readonly string[];
};

type NumberField = { key: keyof CustomerPreferenceProfile; label: string };

const SELECTS: Record<Group, SelectField[]> = {
  travel: [
    {
      key: "travelParty",
      label: "Typical travelling party",
      options: [
        "solo",
        "couple",
        "family_young_children",
        "family_teens",
        "multi_generational",
        "friends",
        "business",
      ],
    },
    {
      key: "travelFrequency",
      label: "Travel frequency",
      options: [
        "less_than_once_a_year",
        "one_to_two_per_year",
        "three_to_four_per_year",
        "five_plus_per_year",
      ],
    },
    {
      key: "travelBudgetRange",
      label: "Typical budget range",
      options: [
        "upto_5l",
        "5l_10l",
        "10l_25l",
        "25l_50l",
        "50l_plus",
        "no_ceiling",
      ],
    },
    {
      key: "travelBookingLeadTime",
      label: "Booking lead time",
      options: [
        "last_minute",
        "under_1_month",
        "one_to_three_months",
        "three_to_six_months",
        "six_months_plus",
      ],
    },
  ],
  hotel: [],
  flight: [
    {
      key: "flightCabin",
      label: "Preferred cabin",
      options: ["economy", "premium_economy", "business", "first", "private"],
    },
    {
      key: "flightDirectPreference",
      label: "Direct flights",
      options: ["always_direct", "prefer_direct", "no_preference"],
    },
  ],
  dining: [
    {
      key: "diningDietary",
      label: "Dietary preference",
      options: [
        "no_restriction",
        "vegetarian",
        "vegan",
        "jain",
        "halal",
        "kosher",
        "pescatarian",
        "gluten_free",
        "other",
      ],
    },
    {
      key: "diningFineDining",
      label: "Fine dining",
      options: ["essential", "enjoys", "occasional", "prefers_casual"],
    },
  ],
  lifestyle: [
    {
      key: "lifestyleExperienceStyle",
      label: "Preferred experience style",
      options: [
        "private_bespoke",
        "small_group",
        "exclusive_access",
        "off_the_beaten_path",
        "classic_highlights",
        "relaxed_unstructured",
      ],
    },
  ],
};

const NUMBERS: Record<Group, NumberField[]> = {
  travel: [
    { key: "travelTypicalTripNights", label: "Typical trip length (nights)" },
  ],
  hotel: [],
  flight: [],
  dining: [],
  lifestyle: [],
};

const NOTES: Record<Group, { key: keyof CustomerPreferenceProfile; label: string }> = {
  travel: { key: "travelNotes", label: "Travel notes" },
  hotel: { key: "hotelNotes", label: "Other hotel preferences" },
  flight: { key: "flightNotes", label: "Other flight preferences" },
  dining: { key: "diningNotes", label: "Dining notes" },
  lifestyle: { key: "lifestyleNotes", label: "Other lifestyle preferences" },
};

const TITLES: Record<Group, string> = {
  travel: "Travel behaviour",
  hotel: "Other hotel preferences",
  flight: "Flight details",
  dining: "Dining details",
  lifestyle: "Lifestyle details",
};

/**
 * The single-valued half of the preference model: the fields that genuinely
 * have one answer, plus the per-section free-text notes the requirements
 * document asks for.
 */
export function PreferenceProfileForm({
  customerId,
  profile,
  group,
  canEdit,
}: {
  customerId: string;
  profile: CustomerPreferenceProfile | null;
  group: Group;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    buildDraft(profile, group),
  );

  const selects = SELECTS[group];
  const numbers = NUMBERS[group];
  const note = NOTES[group];

  function save() {
    startTransition(async () => {
      const payload: Record<string, unknown> = { customerId };
      for (const [key, value] of Object.entries(draft)) {
        payload[key] = value === "" || value === NONE ? null : value;
      }

      const result = await updatePreferenceProfileAction(
        payload as Parameters<typeof updatePreferenceProfileAction>[0],
      );

      if (result.ok) {
        toast.success("Saved");
        setEditing(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  if (!editing) {
    return (
      <Section
        title={TITLES[group]}
        action={
          canEdit ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
          ) : null
        }
      >
        <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {numbers.map((field) => (
            <Field key={String(field.key)} label={field.label}>
              {profile?.[field.key] ? String(profile[field.key]) : "—"}
            </Field>
          ))}
          {selects.map((field) => (
            <Field key={String(field.key)} label={field.label}>
              {scalarLabel(profile?.[field.key] as string | null)}
            </Field>
          ))}
          <Field label={note.label} className="sm:col-span-2 lg:col-span-3">
            {(profile?.[note.key] as string | null) ?? "—"}
          </Field>
        </dl>
      </Section>
    );
  }

  return (
    <Section
      title={TITLES[group]}
      action={
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(buildDraft(profile, group));
              setEditing(false);
            }}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={pending}>
            Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {numbers.map((field) => (
          <div key={String(field.key)} className="space-y-2">
            <Label htmlFor={String(field.key)}>{field.label}</Label>
            <Input
              id={String(field.key)}
              type="number"
              min={0}
              value={draft[field.key as string] ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  [field.key as string]: event.target.value,
                }))
              }
            />
          </div>
        ))}

        {selects.map((field) => (
          <div key={String(field.key)} className="space-y-2">
            <Label htmlFor={String(field.key)}>{field.label}</Label>
            <Select
              value={draft[field.key as string] || NONE}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  [field.key as string]: value === NONE ? "" : value,
                }))
              }
            >
              <SelectTrigger id={String(field.key)}>
                <SelectValue placeholder="Not recorded" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not recorded</SelectItem>
                {field.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {scalarLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor={String(note.key)}>{note.label}</Label>
        <Textarea
          id={String(note.key)}
          rows={3}
          value={draft[note.key as string] ?? ""}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              [note.key as string]: event.target.value,
            }))
          }
        />
      </div>
    </Section>
  );
}

function buildDraft(
  profile: CustomerPreferenceProfile | null,
  group: Group,
): Record<string, string> {
  const keys = [
    ...NUMBERS[group].map((field) => field.key),
    ...SELECTS[group].map((field) => field.key),
    NOTES[group].key,
  ];

  const draft: Record<string, string> = {};
  for (const key of keys) {
    const value = profile?.[key];
    draft[key as string] = value === null || value === undefined ? "" : String(value);
  }
  return draft;
}
