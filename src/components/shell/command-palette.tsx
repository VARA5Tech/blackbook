"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { quickSearch, type QuickResult } from "@/actions/search-actions";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

/**
 * Global search, opened with Cmd/Ctrl+K or the sidebar button.
 *
 * Requirement: find a client by name, customer ID, household ID or mobile.
 * The command palette is that single entry point, so the ops team never has to
 * decide which list page to visit first.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<QuickResult[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    function onOpenRequest() {
      setOpen(true);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("vara5:open-command", onOpenRequest);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("vara5:open-command", onOpenRequest);
    };
  }, []);

  useEffect(() => {
    const trimmed = term.trim();
    if (!open || trimmed.length === 0) return;

    // Debounced so a fast typist does not issue a query per keystroke.
    const timer = setTimeout(() => {
      startTransition(async () => {
        setResults(await quickSearch(trimmed));
      });
    }, 150);

    return () => clearTimeout(timer);
  }, [term, open]);

  function go(result: QuickResult) {
    setOpen(false);
    setTerm("");
    router.push(
      result.kind === "client"
        ? `/clients/${result.id}`
        : `/households/${result.id}`,
    );
  }

  // Derived rather than cleared in an effect, so an empty box shows nothing
  // immediately instead of one render later.
  const visible = term.trim().length === 0 ? [] : results;
  const clients = visible.filter((result) => result.kind === "client");
  const households = visible.filter((result) => result.kind === "household");

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Find a client or household"
    >
      {/* Ranking is done in Postgres, so cmdk must not re-filter the results. */}
      <Command shouldFilter={false}>
        <CommandInput
        placeholder="Name, client ID, household ID or mobile..."
        value={term}
        onValueChange={setTerm}
      />
      <CommandList>
        <CommandEmpty>
          {term.trim().length === 0
            ? "Start typing to search."
            : pending
              ? "Searching..."
              : "Nothing matched."}
        </CommandEmpty>

        {clients.length > 0 ? (
          <CommandGroup heading="Clients">
            {clients.map((result) => (
              <CommandItem
                key={result.id}
                value={result.id}
                onSelect={() => go(result)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{result.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {result.subtitle}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {households.length > 0 ? (
          <CommandGroup heading="Households">
            {households.map((result) => (
              <CommandItem
                key={result.id}
                value={result.id}
                onSelect={() => go(result)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{result.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {result.subtitle}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
