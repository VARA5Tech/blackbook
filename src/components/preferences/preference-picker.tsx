"use client";

import { Check, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { KIND_LABELS, type CatalogueOption } from "@/domain/preferences";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Filter clients by what they like and what they will not accept.
 *
 * Cycling one row through prefers, avoids and off keeps both halves of the
 * "likes Japan but avoids large resorts" question in a single control.
 */
export function PreferencePicker({
  catalogue,
  selectedPrefers,
  selectedAvoids,
  onChange,
}: {
  catalogue: Record<string, CatalogueOption[]>;
  selectedPrefers: string[];
  selectedAvoids: string[];
  onChange: (prefers: string[], avoids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = selectedPrefers.length + selectedAvoids.length;

  function cycle(id: string) {
    const isPrefer = selectedPrefers.includes(id);
    const isAvoid = selectedAvoids.includes(id);

    if (isPrefer) {
      onChange(
        selectedPrefers.filter((value) => value !== id),
        [...selectedAvoids, id],
      );
    } else if (isAvoid) {
      onChange(
        selectedPrefers,
        selectedAvoids.filter((value) => value !== id),
      );
    } else {
      onChange([...selectedPrefers, id], selectedAvoids);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2">
          <SlidersHorizontal className="size-4" />
          Preferences
          {count > 0 ? (
            <span className="rounded-sm bg-primary px-1.5 text-xs text-primary-foreground">
              {count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Filter by preference..." />
          <CommandList className="max-h-80">
            <CommandEmpty>No matching preference.</CommandEmpty>
            {Object.entries(catalogue).map(([kind, options]) => (
              <CommandGroup
                key={kind}
                heading={KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? kind}
              >
                {options.map((option) => {
                  const isPrefer = selectedPrefers.includes(option.id);
                  const isAvoid = selectedAvoids.includes(option.id);

                  return (
                    <CommandItem
                      key={option.id}
                      value={`${option.label} ${option.grouping ?? ""}`}
                      onSelect={() => cycle(option.id)}
                    >
                      <span
                        className={cn(
                          "flex size-4 items-center justify-center rounded-sm border",
                          isPrefer && "border-transparent bg-primary text-primary-foreground",
                          isAvoid && "border-destructive bg-destructive text-white",
                        )}
                      >
                        {isPrefer ? <Check className="size-3" /> : null}
                        {isAvoid ? <span className="text-xs leading-none">×</span> : null}
                      </span>
                      <span className="flex-1 truncate">{option.label}</span>
                      {isPrefer ? (
                        <span className="text-xs text-muted-foreground">prefers</span>
                      ) : null}
                      {isAvoid ? (
                        <span className="text-xs text-muted-foreground">avoids</span>
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>

        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Click once for prefers, twice for avoids.
        </div>
      </PopoverContent>
    </Popover>
  );
}
