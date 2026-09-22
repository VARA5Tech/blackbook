"use client";

import {
  Archive,
  ArrowRight,
  CalendarHeart,
  ChevronLeft,
  ChevronRight,
  Globe,
  Home,
  Link2,
  ListChecks,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Unlink,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { displayName } from "@/domain/customers";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_PERIODS,
  ACTIVITY_PERIOD_LABELS,
  ACTIVITY_RECORDS,
  ACTIVITY_RECORD_LABELS,
  describeChange,
  type ActivityAction,
  type ActivityRecord,
  type ChangeLookups,
} from "@/domain/engagement";
import { formatDate, formatTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The activity log as a table: When, By, Action, Record, Details.
 *
 * Every row answers the same four questions in the same columns, which is what
 * makes a log scannable: who did it, what kind of thing happened, to whom, and
 * precisely what changed. Field changes are rendered from the stored diff with
 * today's labels and names, not from the sentence written at the time, so an
 * id reads as the person it belongs to and an old label cannot linger.
 */

type Row = {
  id: string;
  createdAt: Date;
  action: ActivityAction;
  entityType: ActivityRecord;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  actorId: string | null;
  actorName: string | null;
  customerId: string | null;
  customerFirstName: string | null;
  customerLastName: string | null;
  customerPreferredName: string | null;
  customerRef: string | null;
  householdId: string | null;
  householdName: string | null;
  householdRef: string | null;
};

const ANY = "__any__";

const ACTION_LOOK: Record<ActivityAction, { icon: LucideIcon; tone: string }> = {
  created: { icon: Plus, tone: "var(--chart-2)" },
  updated: { icon: Pencil, tone: "var(--chart-4)" },
  archived: { icon: Archive, tone: "var(--destructive)" },
  restored: { icon: RotateCcw, tone: "var(--chart-2)" },
  linked: { icon: Link2, tone: "var(--chart-3)" },
  unlinked: { icon: Unlink, tone: "var(--chart-5)" },
  interaction_logged: { icon: MessageSquare, tone: "var(--chart-1)" },
  preference_updated: { icon: SlidersHorizontal, tone: "var(--chart-4)" },
};

const RECORD_ICON: Record<ActivityRecord, LucideIcon> = {
  customer: UserRound,
  household: Home,
  milestone: CalendarHeart,
  interaction: MessageSquare,
  task: ListChecks,
  preference: SlidersHorizontal,
};

type Author = { id: string; name: string };

export function ActivityTable({
  rows,
  total,
  page,
  pageSize,
  lookups,
  authors,
}: {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  lookups: ChangeLookups;
  authors: Author[];
}) {
  const params = useSearchParams();
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const pageHref = (next: number) => {
    const query = new URLSearchParams(params.toString());
    if (next <= 1) query.delete("page");
    else query.set("page", String(next));
    const text = query.toString();
    return text ? `?${text}` : "?";
  };

  return (
    <div className="space-y-4">
      <ActivityFilters authors={authors} />

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="max-h-[70vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-36">When</TableHead>
                <TableHead className="w-44">By</TableHead>
                <TableHead className="w-36">Action</TableHead>
                <TableHead className="w-64">Record</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                    Nothing matches these filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => <ActivityRowView key={row.id} row={row} lookups={lookups} />)
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          <span className="tabular">
            {total === 0 ? "No entries" : `${first}–${last} of ${total} ${total === 1 ? "entry" : "entries"}`}
          </span>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm" className={cn(page <= 1 && "pointer-events-none opacity-40")}>
              <Link href={pageHref(page - 1)} aria-disabled={page <= 1}>
                <ChevronLeft /> Newer
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className={cn(last >= total && "pointer-events-none opacity-40")}>
              <Link href={pageHref(page + 1)} aria-disabled={last >= total}>
                Older <ChevronRight />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One row                                                             */
/* ------------------------------------------------------------------ */

function ActivityRowView({ row, lookups }: { row: Row; lookups: ChangeLookups }) {
  const look = ACTION_LOOK[row.action];
  const RecordIcon = RECORD_ICON[row.entityType];

  // Whose record this is about. A household-level row names the household; any
  // other names the client it belongs to, when there is one.
  const aboutHousehold = row.entityType === "household" || (!row.customerId && row.householdId);
  const customerName =
    row.customerFirstName !== null
      ? displayName({
          firstName: row.customerFirstName,
          lastName: row.customerLastName,
          preferredName: row.customerPreferredName,
        })
      : null;
  const recordName = aboutHousehold
    ? (row.householdName ?? "A household since removed")
    : (customerName ?? (row.customerId ? "A client since removed" : ACTIVITY_RECORD_LABELS[row.entityType]));
  const recordRef = aboutHousehold ? row.householdRef : row.customerRef;
  const href = aboutHousehold
    ? row.householdId && row.householdName ? `/households/${row.householdId}` : null
    : row.customerId && customerName ? `/clients/${row.customerId}` : null;

  // Nobody signed in wrote it: the members' site reporting a client's ask.
  const fromWebsite = !row.actorId && /vara5\.(com|travel)/i.test(row.summary);

  return (
    <TableRow className="align-top">
      <TableCell className="whitespace-nowrap">
        <span className="tabular block text-sm">{formatDate(row.createdAt)}</span>
        <span className="tabular block text-xs text-muted-foreground" title={timeAgo(row.createdAt)}>
          {formatTime(row.createdAt)}
        </span>
      </TableCell>

      <TableCell>
        {fromWebsite ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="flex size-7 items-center justify-center rounded-full bg-muted">
              <Globe className="size-3.5 text-muted-foreground" />
            </span>
            vara5.com
          </span>
        ) : row.actorName ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
              {row.actorName
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part.charAt(0).toUpperCase())
                .join("")}
            </span>
            <span className="truncate">{row.actorName}</span>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Someone since removed</span>
        )}
      </TableCell>

      <TableCell>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium">
          <look.icon className="size-3.5" style={{ color: look.tone } as CSSProperties} />
          {ACTIVITY_ACTION_LABELS[row.action]}
        </span>
      </TableCell>

      <TableCell className="max-w-64">
        <div className="flex items-start gap-2">
          <RecordIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            {href ? (
              <Link href={href} className="block truncate text-sm font-medium hover:underline">
                {recordName}
              </Link>
            ) : (
              <span className="block truncate text-sm font-medium">{recordName}</span>
            )}
            <span className="tabular block truncate text-xs text-muted-foreground">
              {[ACTIVITY_RECORD_LABELS[row.entityType], recordRef].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>
      </TableCell>

      <TableCell className="whitespace-normal">
        <Details row={row} lookups={lookups} />
      </TableCell>
    </TableRow>
  );
}

function Details({ row, lookups }: { row: Row; lookups: ChangeLookups }) {
  const changes = Object.entries(row.changes ?? {});
  const [open, setOpen] = useState(false);

  if (changes.length > 0) {
    const shown = open ? changes : changes.slice(0, 3);
    return (
      <ul className="space-y-1 text-sm">
        {shown.map(([field, change]) => {
          const described = describeChange(field, change, lookups);
          return (
            <li key={field} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="text-muted-foreground">{described.label}</span>
              <span className="max-w-56 truncate text-muted-foreground">
                {described.from}
              </span>
              <ArrowRight className="size-3 text-muted-foreground" />
              <span className="max-w-72 truncate font-medium">{described.to}</span>
            </li>
          );
        })}
        {changes.length > 3 ? (
          <li>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {open ? "Show fewer" : `${changes.length - 3} more ${changes.length - 3 === 1 ? "change" : "changes"}`}
            </button>
          </li>
        ) : null}
      </ul>
    );
  }

  // A creation is already said by the Action and Record columns.
  if (row.action === "created" && (row.entityType === "customer" || row.entityType === "household")) {
    return (
      <span className="text-sm text-muted-foreground">
        New {ACTIVITY_RECORD_LABELS[row.entityType].toLowerCase()} record
      </span>
    );
  }
  return <span className="text-sm">{row.summary}</span>;
}

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

/**
 * Everything lives in the URL, like the clients list: a filtered log can be
 * bookmarked or pasted to a colleague, and the server stays the only thing
 * that decides what matches.
 */
function ActivityFilters({ authors }: { authors: Author[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const urlTerm = params.get("q") ?? "";
  const [term, setTerm] = useState(urlTerm);
  // Kept in step with the URL during render, as React recommends, so Back and
  // "Clear" both update the box without an extra effect pass.
  const [lastUrlTerm, setLastUrlTerm] = useState(urlTerm);
  if (urlTerm !== lastUrlTerm) {
    setLastUrlTerm(urlTerm);
    setTerm(urlTerm);
  }

  function apply(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete("page");
    const text = next.toString();
    startTransition(() => router.push(text ? `${pathname}?${text}` : pathname));
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

  const choose = (key: string) => (value: string) =>
    apply((next) => {
      if (value === ANY) next.delete(key);
      else next.set(key, value);
    });

  const period = params.get("period") ?? "all";
  const filtered = ["q", "action", "record", "by", "period"].some((key) => params.get(key));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Client, household, person or note"
          aria-label="Search the activity log"
          className="bg-card pl-8"
        />
      </div>

      <Select value={params.get("action") ?? ANY} onValueChange={choose("action")}>
        <SelectTrigger className="w-40 bg-card" aria-label="Action">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any action</SelectItem>
          {ACTIVITY_ACTIONS.map((action) => (
            <SelectItem key={action} value={action}>
              {ACTIVITY_ACTION_LABELS[action]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={params.get("record") ?? ANY} onValueChange={choose("record")}>
        <SelectTrigger className="w-40 bg-card" aria-label="Record">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any record</SelectItem>
          {ACTIVITY_RECORDS.map((record) => (
            <SelectItem key={record} value={record}>
              {ACTIVITY_RECORD_LABELS[record]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={params.get("by") ?? ANY} onValueChange={choose("by")}>
        <SelectTrigger className="w-44 bg-card" aria-label="By">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Anyone</SelectItem>
          {authors.map((author) => (
            <SelectItem key={author.id} value={author.id}>
              {author.name}
            </SelectItem>
          ))}
          <SelectItem value="website">vara5.com (website)</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex items-center rounded-md border border-border bg-card p-0.5" role="group" aria-label="Period">
        {ACTIVITY_PERIODS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={period === value}
            onClick={() => choose("period")(value === "all" ? ANY : value)}
            className={cn(
              "rounded px-2.5 py-1 text-xs transition-colors",
              period === value
                ? "bg-secondary font-medium text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {ACTIVITY_PERIOD_LABELS[value]}
          </button>
        ))}
      </div>

      {filtered ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setTerm("");
            startTransition(() => router.push(pathname));
          }}
        >
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}
