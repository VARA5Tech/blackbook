"use client";

import { Check, Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createPreferenceOptionAction,
  setPreferencesAction,
} from "@/actions/crm-actions";
import type { PreferenceRow } from "@/components/preferences/preference-section";
import { Section } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  KIND_LABELS,
  POLARITY_LABELS,
  type CatalogueOption,
} from "@/domain/preferences";
import { cn } from "@/lib/utils";

type Polarity = "prefer" | "wishlist" | "avoid";

type Selection = {
  optionId: string;
  label: string;
  polarity: Polarity;
  note: string;
};

const POLARITIES: Polarity[] = ["prefer", "wishlist", "avoid"];

/**
 * Editor for one group of facets. Saving is per-facet, so the travel section
 * and the dining section can never overwrite one another.
 */
export function PreferenceEditor({
  customerId,
  title,
  kinds,
  catalogue,
  preferences,
  onDone,
}: {
  customerId: string;
  title: string;
  kinds: string[];
  catalogue: Record<string, CatalogueOption[]>;
  preferences: PreferenceRow[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const [state, setState] = useState<Record<string, Selection[]>>(() => {
    const initial: Record<string, Selection[]> = {};
    for (const kind of kinds) {
      initial[kind] = preferences
        .filter((row) => row.kind === kind)
        .map((row) => ({
          optionId: row.optionId,
          label: row.label,
          polarity: row.polarity,
          note: row.note ?? "",
        }));
    }
    return initial;
  });

  const [options, setOptions] = useState(catalogue);

  function toggle(kind: string, option: CatalogueOption, polarity: Polarity) {
    setState((current) => {
      const existing = current[kind] ?? [];
      const match = existing.find((item) => item.optionId === option.id);

      if (match && match.polarity === polarity) {
        return {
          ...current,
          [kind]: existing.filter((item) => item.optionId !== option.id),
        };
      }
      if (match) {
        return {
          ...current,
          [kind]: existing.map((item) =>
            item.optionId === option.id ? { ...item, polarity } : item,
          ),
        };
      }
      return {
        ...current,
        [kind]: [
          ...existing,
          { optionId: option.id, label: option.label, polarity, note: "" },
        ],
      };
    });
  }

  function setNote(kind: string, optionId: string, note: string) {
    setState((current) => ({
      ...current,
      [kind]: (current[kind] ?? []).map((item) =>
        item.optionId === optionId ? { ...item, note } : item,
      ),
    }));
  }

  function save() {
    startTransition(async () => {
      for (const kind of kinds) {
        const result = await setPreferencesAction({
          customerId,
          kind: kind as never,
          selections: (state[kind] ?? []).map((item) => ({
            optionId: item.optionId,
            polarity: item.polarity,
            note: item.note,
          })),
        });

        if (!result.ok) {
          toast.error(result.error);
          return;
        }
      }
      toast.success(`${title} saved`);
      onDone();
    });
  }

  return (
    <Section
      title={title}
      action={
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={pending}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {kinds.map((kind) => {
          const kindOptions = options[kind] ?? [];
          const selections = state[kind] ?? [];

          return (
            <div key={kind} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">
                  {KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? kind}
                </p>

                <OptionPicker
                  kind={kind}
                  options={kindOptions}
                  selections={selections}
                  onToggle={(option, polarity) => toggle(kind, option, polarity)}
                  onCreated={(option) => {
                    setOptions((current) => ({
                      ...current,
                      [kind]: [...(current[kind] ?? []), option],
                    }));
                    toggle(kind, option, "prefer");
                  }}
                />
              </div>

              {selections.length === 0 ? (
                <p className="text-sm text-muted-foreground">None selected.</p>
              ) : (
                <ul className="space-y-2">
                  {selections.map((selection) => (
                    <li
                      key={selection.optionId}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span className="min-w-36 flex-1 text-sm">
                        {selection.label}
                      </span>

                      <div className="flex rounded-md border border-border p-0.5">
                        {POLARITIES.map((polarity) => (
                          <button
                            key={polarity}
                            type="button"
                            onClick={() =>
                              setState((current) => ({
                                ...current,
                                [kind]: (current[kind] ?? []).map((item) =>
                                  item.optionId === selection.optionId
                                    ? { ...item, polarity }
                                    : item,
                                ),
                              }))
                            }
                            className={cn(
                              "rounded-sm px-2 py-1 text-xs transition-colors",
                              selection.polarity === polarity
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {POLARITY_LABELS[polarity]}
                          </button>
                        ))}
                      </div>

                      <Input
                        value={selection.note}
                        onChange={(event) =>
                          setNote(kind, selection.optionId, event.target.value)
                        }
                        placeholder="Note"
                        className="h-8 w-44"
                      />

                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Remove ${selection.label}`}
                        onClick={() =>
                          setState((current) => ({
                            ...current,
                            [kind]: (current[kind] ?? []).filter(
                              (item) => item.optionId !== selection.optionId,
                            ),
                          }))
                        }
                      >
                        <X className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function OptionPicker({
  kind,
  options,
  selections,
  onToggle,
  onCreated,
}: {
  kind: string;
  options: CatalogueOption[];
  selections: Selection[];
  onToggle: (option: CatalogueOption, polarity: Polarity) => void;
  onCreated: (option: CatalogueOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [pending, startTransition] = useTransition();

  const exactMatch = options.some(
    (option) => option.label.toLowerCase() === term.trim().toLowerCase(),
  );

  function createOption() {
    startTransition(async () => {
      const result = await createPreferenceOptionAction({
        kind,
        label: term.trim(),
      });

      if (result.ok) {
        onCreated({
          id: result.data.id,
          kind: kind as CatalogueOption["kind"],
          label: result.data.label,
          grouping: null,
        });
        setTerm("");
        toast.success(`Added ${result.data.label}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-3.5" />
          Add
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput
            placeholder="Search or type a new one..."
            value={term}
            onValueChange={setTerm}
          />
          <CommandList className="max-h-72">
            <CommandEmpty>
              {term.trim().length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={createOption}
                  disabled={pending}
                >
                  <Plus className="size-3.5" />
                  Add &ldquo;{term.trim()}&rdquo;
                </Button>
              ) : (
                "No options."
              )}
            </CommandEmpty>

            <CommandGroup>
              {options.map((option) => {
                const selected = selections.find(
                  (item) => item.optionId === option.id,
                );

                return (
                  <CommandItem
                    key={option.id}
                    value={`${option.label} ${option.grouping ?? ""}`}
                    onSelect={() => onToggle(option, "prefer")}
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded-sm border",
                        selected &&
                          "border-transparent bg-primary text-primary-foreground",
                      )}
                    >
                      {selected ? <Check className="size-3" /> : null}
                    </span>
                    <span className="flex-1 truncate">{option.label}</span>
                    {option.grouping ? (
                      <span className="text-xs text-muted-foreground">
                        {option.grouping}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>

            {term.trim().length > 0 && !exactMatch ? (
              <CommandGroup>
                <CommandItem onSelect={createOption} disabled={pending}>
                  <Plus className="size-3.5" />
                  Add &ldquo;{term.trim()}&rdquo;
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
