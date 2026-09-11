"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createHouseholdAction,
  updateHouseholdAction,
} from "@/actions/crm-actions";
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
import type { Household } from "@/db/schema";
import { TRAVEL_PATTERNS, TRAVEL_PATTERN_LABELS } from "@/domain/households";

const NONE = "__none__";

export function HouseholdForm({ household }: { household?: Household | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(household?.name ?? "");
  const [city, setCity] = useState(household?.city ?? "");
  const [travelPattern, setTravelPattern] = useState<
    (typeof TRAVEL_PATTERNS)[number] | ""
  >(household?.travelPattern ?? "");
  const [notes, setNotes] = useState(household?.notes ?? "");

  const isEdit = Boolean(household);

  function submit() {
    setError(null);
    startTransition(async () => {
      const payload = { name, city, travelPattern, notes };

      const result = isEdit
        ? await updateHouseholdAction({ ...payload, id: household!.id })
        : await createHouseholdAction(payload);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.success(isEdit ? "Household updated" : "Household created");
      router.push(
        isEdit
          ? `/households/${household!.id}`
          : `/households/${(result.data as { id: string }).id}`,
      );
      router.refresh();
    });
  }

  return (
    <div className="max-w-2xl space-y-8">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Section title="Household">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">
              Household name<span className="text-destructive"> *</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Sharma Family"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="travelPattern">Family travel pattern</Label>
            <Select
              value={travelPattern || NONE}
              onValueChange={(value) =>
                setTravelPattern(
                  value === NONE ? "" : (value as (typeof TRAVEL_PATTERNS)[number]),
                )
              }
            >
              <SelectTrigger id="travelPattern">
                <SelectValue placeholder="Not recorded" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not recorded</SelectItem>
                {TRAVEL_PATTERNS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {TRAVEL_PATTERN_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="notes">Household notes</Label>
            <Textarea
              id="notes"
              rows={4}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="How this family travels together, who decides, anything shared across members."
            />
          </div>
        </div>
      </Section>

      <div className="flex gap-2 border-t border-border pt-6">
        <Button
          onClick={submit}
          disabled={pending || name.trim().length === 0}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          {isEdit ? "Save changes" : "Create household"}
        </Button>
        <Button variant="ghost" asChild>
          <Link
            href={isEdit ? `/households/${household!.id}` : "/households"}
          >
            Cancel
          </Link>
        </Button>
      </div>
    </div>
  );
}
