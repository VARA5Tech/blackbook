"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { CatalogueOption } from "@/domain/preferences";
import {
  CLIENT_STATUS_LABELS,
  type ClientStatus,
} from "@/domain/customers";
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

/**
 * Named questions, kept as the query they stand for.
 *
 * A view is on when the URL already carries its parameters, so pressing one
 * twice turns it off and the browser's back button behaves. They are the same
 * filters anybody could build by hand; naming them is what makes them worth
 * opening the screen for.
 */
const SAVED_VIEWS = [
  {
    name: "Never contacted",
    query: "stale=1&sort=recent&dir=desc",
    matches: (params: URLSearchParams) => params.get("stale") === "1",
  },
  {
    name: "Gone quiet",
    query: "stale=60&sort=last_interaction&dir=asc",
    matches: (params: URLSearchParams) => params.get("stale") === "60",
  },
  {
    name: "Newest first",
    query: "sort=recent&dir=desc",
    matches: (params: URLSearchParams) =>
      params.get("sort") === "recent" && !params.get("stale"),
  },
  {
    name: "Inactive",
    query: "status=inactive",
    matches: (params: URLSearchParams) => params.get("status") === "inactive",
  },
] as const;

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

  /**
   * Every filter that is not a preference, as something you can see and drop.
   *
   * The dropdowns above are how a filter is added; these are how you read what
   * is currently applied and remove one of them without clearing the rest.
   */
  const staleDays = params.get("stale");
  const statusValue = params.get("status");
  const rmValue = params.get("rm");
  const plainChips = [
    statusValue
      ? {
          key: "status",
          label: CLIENT_STATUS_LABELS[statusValue as ClientStatus] ?? statusValue,
        }
      : null,
    rmValue
      ? {
          key: "rm",
          label: staff.find((member) => member.id === rmValue)?.name ?? "Manager",
        }
      : null,
    staleDays
      ? { key: "stale", label: `Not contacted in ${staleDays} days` }
      : null,
  ].filter((chip): chip is { key: string; label: string } => chip !== null);

  const activeView = SAVED_VIEWS.find((view) => view.matches(params));

  return (
    <div className="space-y-3">
      {/*
        The questions the desk actually opens this screen to ask. They were
        already scattered as links on the dashboard; here they are the same
        thing, named, and visibly on or off.
      */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SAVED_VIEWS.map((view) => {
          const on = activeView?.name === view.name;
          return (
            <button
              key={view.name}
              type="button"
              onClick={() =>
                startTransition(() => {
                  setTerm("");
                  router.push(on ? pathname : `${pathname}?${view.query}`);
                })
              }
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                on
                  ? "border-transparent bg-secondary text-secondary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {view.name}
            </button>
          );
        })}
      </div>

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

      {prefers.length + avoids.length + plainChips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {plainChips.map((chip) => (
            <Badge key={chip.key} variant="secondary" className="gap-1 font-normal">
              {chip.label}
              <button
                type="button"
                aria-label={`Remove ${chip.label}`}
                onClick={() => apply((next) => next.delete(chip.key))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
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
