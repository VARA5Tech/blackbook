"use client";

import { Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PreferenceEditor } from "@/components/preferences/preference-editor";
import { Section } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  KIND_LABELS,
  POLARITY_LABELS,
  type CatalogueOption,
} from "@/domain/preferences";
import { cn } from "@/lib/utils";

export type PreferenceRow = {
  id: string;
  polarity: "prefer" | "wishlist" | "avoid";
  note: string | null;
  rank: number;
  optionId: string;
  kind: string;
  label: string;
  grouping: string | null;
};

const POLARITY_ORDER = ["prefer", "wishlist", "avoid"] as const;

const POLARITY_STYLES: Record<(typeof POLARITY_ORDER)[number], string> = {
  prefer:
    "bg-[color:var(--polarity-prefer-bg)] text-[color:var(--polarity-prefer)]",
  wishlist:
    "bg-[color:var(--polarity-wishlist-bg)] text-[color:var(--polarity-wishlist)]",
  avoid:
    "bg-[color:var(--polarity-avoid-bg)] text-[color:var(--polarity-avoid)]",
};

/**
 * Renders one group of catalogue facets for a client, split by polarity so the
 * requirements document's "Favourite / Wishlist / Avoid" columns read as three
 * distinct lists even though they share one table.
 */
export function PreferenceSection({
  customerId,
  title,
  kinds,
  catalogue,
  preferences,
  canEdit,
  icon,
}: {
  customerId: string;
  title: string;
  kinds: string[];
  catalogue: Record<string, CatalogueOption[]>;
  preferences: PreferenceRow[];
  canEdit: boolean;
  icon?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  const relevant = preferences.filter((row) => kinds.includes(row.kind));

  if (editing) {
    return (
      <PreferenceEditor
        customerId={customerId}
        title={title}
        kinds={kinds}
        catalogue={catalogue}
        preferences={relevant}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <Section
      title={title}
      action={
        canEdit ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
            Edit
          </Button>
        ) : null
      }
    >
      {relevant.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing recorded yet.
          {icon ? <span className="sr-only">{title}</span> : null}
        </p>
      ) : (
        <div className="space-y-5">
          {kinds.map((kind) => {
            const rows = relevant.filter((row) => row.kind === kind);
            if (rows.length === 0) return null;

            return (
              <div key={kind} className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? kind}
                </p>

                <div className="space-y-2">
                  {POLARITY_ORDER.map((polarity) => {
                    const chips = rows.filter(
                      (row) => row.polarity === polarity,
                    );
                    if (chips.length === 0) return null;

                    return (
                      <div
                        key={polarity}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5"
                      >
                        <span className="w-16 shrink-0 text-xs text-muted-foreground">
                          {POLARITY_LABELS[polarity]}
                        </span>
                        {chips.map((chip) => (
                          <span
                            key={chip.id}
                            className={cn(
                              "rounded-full px-2.5 py-1 text-xs",
                              POLARITY_STYLES[polarity],
                            )}
                            title={chip.note ?? undefined}
                          >
                            {chip.label}
                            {chip.note ? (
                              <span className="opacity-70"> · {chip.note}</span>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
