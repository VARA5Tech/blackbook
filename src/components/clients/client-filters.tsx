"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { CatalogueOption } from "@/domain/preferences";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PreferencePicker } from "@/components/preferences/preference-picker";

const ANY = "__any__";

type Staff = { id: string; name: string };

/**
 * Filter bar for the clients list.
 *
 * All state lives in the URL so a useful view (Priya's Delhi clients who like
 * Japan) can be bookmarked or pasted into a chat, and so the server component
 * above stays the single source of truth for results.
 */
export function ClientFilters({
  catalogue,
  staff,
}: {
  catalogue: Record<string, CatalogueOption[]>;
  staff: Staff[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const urlTerm = params.get("q") ?? "";
  const [term, setTerm] = useState(urlTerm);

  /**
   * Adjusting state during render, rather than in an effect, is React's own
   * recommendation for syncing a controlled input with a prop. It keeps the
   * box in step when the user navigates back or clears filters, without the
   * extra render pass an effect would cause.
   */
  const [lastUrlTerm, setLastUrlTerm] = useState(urlTerm);
  if (urlTerm !== lastUrlTerm) {
    setLastUrlTerm(urlTerm);
    setTerm(urlTerm);
  }

  function apply(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  }

  useEffect(() => {
    if (term === urlTerm) return;

    const timer = setTimeout(() => {
      apply((next) => {
        if (term.trim()) next.set("q", term.trim());
        else next.delete("q");
      });
    }, 250);

    return () => clearTimeout(timer);
    // The debounce keys off `term`; `apply` reads the latest params each call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, urlTerm]);

  const prefers = params.getAll("prefers");
  const avoids = params.getAll("avoids");
  const activeFilters =
    prefers.length +
    avoids.length +
    (params.get("status") ? 1 : 0) +
    (params.get("rm") ? 1 : 0) +
    (params.get("stale") ? 1 : 0);

  const allOptions = Object.values(catalogue).flat();
  const labelFor = (id: string) =>
    allOptions.find((option) => option.id === id)?.label ?? "Unknown";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Name, client ID, household ID or mobile"
            className="pl-9"
            aria-label="Search clients"
          />
        </div>

        <Select
          value={params.get("status") ?? ANY}
          onValueChange={(value) =>
            apply((next) =>
              value === ANY ? next.delete("status") : next.set("status", value),
            )
          }
        >
          <SelectTrigger className="w-36" aria-label="Status">
            <SelectValue placeholder="Any status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={params.get("rm") ?? ANY}
          onValueChange={(value) =>
            apply((next) =>
              value === ANY ? next.delete("rm") : next.set("rm", value),
            )
          }
        >
          <SelectTrigger className="w-48" aria-label="Relationship manager">
            <SelectValue placeholder="Any manager" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any manager</SelectItem>
            {staff.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={params.get("stale") ?? ANY}
          onValueChange={(value) =>
            apply((next) =>
              value === ANY ? next.delete("stale") : next.set("stale", value),
            )
          }
        >
          <SelectTrigger className="w-44" aria-label="Last contacted">
            <SelectValue placeholder="Any contact date" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any contact date</SelectItem>
            <SelectItem value="30">Not contacted in 30 days</SelectItem>
            <SelectItem value="60">Not contacted in 60 days</SelectItem>
            <SelectItem value="90">Not contacted in 90 days</SelectItem>
          </SelectContent>
        </Select>

        <PreferencePicker
          catalogue={catalogue}
          selectedPrefers={prefers}
          selectedAvoids={avoids}
          onChange={(nextPrefers, nextAvoids) =>
            apply((next) => {
              next.delete("prefers");
              next.delete("avoids");
              for (const id of nextPrefers) next.append("prefers", id);
              for (const id of nextAvoids) next.append("avoids", id);
            })
          }
        />

        {activeFilters > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              startTransition(() => {
                setTerm("");
                router.push(pathname);
              })
            }
          >
            Clear
          </Button>
        ) : null}
      </div>

      {prefers.length + avoids.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {prefers.map((id) => (
            <Badge
              key={`prefer-${id}`}
              variant="secondary"
              className="gap-1 font-normal"
            >
              Prefers {labelFor(id)}
              <button
                type="button"
                aria-label={`Remove ${labelFor(id)}`}
                onClick={() =>
                  apply((next) => {
                    const kept = prefers.filter((value) => value !== id);
                    next.delete("prefers");
                    for (const value of kept) next.append("prefers", value);
                  })
                }
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          {avoids.map((id) => (
            <Badge
              key={`avoid-${id}`}
              variant="outline"
              className="gap-1 font-normal"
            >
              Avoids {labelFor(id)}
              <button
                type="button"
                aria-label={`Remove ${labelFor(id)}`}
                onClick={() =>
                  apply((next) => {
                    const kept = avoids.filter((value) => value !== id);
                    next.delete("avoids");
                    for (const value of kept) next.append("avoids", value);
                  })
                }
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
