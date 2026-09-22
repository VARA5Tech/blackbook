"use client";

import {
  Fragment,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Columns3,
  Crown,
  Download,
  Rows3,
} from "lucide-react";
import type {
  ClientGroup,
  ClientGroupMember,
} from "@/repositories/customer-repository";
import {
  HOUSEHOLD_ROLE_LABELS,
  displayName,
  initials,
  CLIENT_STATUS_LABELS,
  CLIENT_SORT_DEFAULT_DIRECTION,
  type ClientSort,
  CLIENT_COLUMNS,
  DEFAULT_CLIENT_COLUMNS,
  type ClientColumnKey,
} from "@/domain/customers";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { reassignClientsAction } from "@/actions/client-actions";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, timeAgo } from "@/lib/format";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The clients list, one row per household with its members nested under the
 * primary client.
 *
 * Results are searched, ranked, grouped and paginated in Postgres, so this
 * renders a single page of groups and never re-sorts anything. It is a client
 * component only to hold which households are open.
 */
export function ClientTable({
  groups,
  totalGroups,
  page,
  pageSize,
  baseQuery,
  expandByDefault,
  staff,
  canReassign,
}: {
  groups: ClientGroup[];
  totalGroups: number;
  page: number;
  pageSize: number;
  /** Current filters, without `page`, so paging keeps the active search. */
  baseQuery: string;
  /**
   * Open every household when a search or filter is active, because the
   * members who matched are what the reader came for. Closed otherwise, so a
   * long list stays scannable one family per line.
   */
  expandByDefault: boolean;
  /** Who a selection can be handed to. Empty when the reader may not reassign. */
  staff: { id: string; name: string }[];
  canReassign: boolean;
}) {
  const [open, setOpen] = useState(
    () => new Set(expandByDefault ? groups.map((group) => group.key) : []),
  );

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /*
   * Which columns, and how tight. Both are working habits rather than anything
   * about the clients, so they live on the device and never in the URL: a
   * pasted link should open somebody else's filters, not impose your layout.
   */
  const chosen = useSyncExternalStore(subscribe, columnSnapshot, serverColumns);
  const dense = useSyncExternalStore(subscribe, densitySnapshot, () => false);

  const shown = CLIENT_COLUMNS.filter((column) => chosen.includes(column.key));

  function toggleColumn(key: ClientColumnKey) {
    // Rebuilt from the declaration rather than appended, so a column that is
    // switched back on returns to its place instead of the end.
    const next = chosen.includes(key)
      ? chosen.filter((value) => value !== key)
      : CLIENT_COLUMNS.filter(
          (column) => column.key === key || chosen.includes(column.key),
        ).map((column) => column.key);

    writeColumns(next);
  }

  /*
   * Selection is per page and deliberately not in the URL: it is a thing you
   * are in the middle of, not a view worth sharing, and a link that arrived
   * with twelve clients already ticked would be alarming.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Every client drawn on this page, lead rows and opened members alike.
  const visible = groups.flatMap((group) => [
    group.lead,
    ...(open.has(group.key) ? group.members : []),
  ]);
  const allVisibleSelected =
    visible.length > 0 && visible.every((client) => selected.has(client.id));

  function toggleRow(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const lastPage = Math.max(1, Math.ceil(totalGroups / pageSize));

  const pageHref = (target: number) => {
    const query = new URLSearchParams(baseQuery);
    query.set("page", String(target));
    return `?${query.toString()}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          aria-pressed={dense}
          onClick={() => {
            writeDense(!dense);
          }}
        >
          <Rows3 className="size-3.5" />
          {dense ? "Comfortable" : "Compact"}
        </Button>

        <ColumnChooser
          chosen={chosen}
          onToggle={toggleColumn}
          onReset={() => {
            writeColumns(DEFAULT_CLIENT_COLUMNS);
          }}
        />
      </div>

      {selected.size > 0 ? (
        <SelectionBar
          count={selected.size}
          staff={staff}
          canReassign={canReassign}
          clients={visible.filter((client) => selected.has(client.id))}
          onDone={() => setSelected(new Set())}
        />
      ) : null}

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
        <Table>
          {/* Sticks while the list scrolls: at forty rows the header is off
              screen exactly when somebody needs to know what a column is. */}
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  checked={allVisibleSelected}
                  aria-label={
                    allVisibleSelected
                      ? "Clear the selection"
                      : "Select every client on this page"
                  }
                  onCheckedChange={() =>
                    setSelected(
                      allVisibleSelected
                        ? new Set()
                        : new Set(visible.map((client) => client.id)),
                    )
                  }
                />
              </TableHead>

              <SortHead sort="name" query={baseQuery}>
                Client
              </SortHead>

              {shown.map((column) =>
                column.sort ? (
                  <SortHead
                    key={column.key}
                    sort={column.sort}
                    query={baseQuery}
                    align={column.key === "status" ? "right" : "left"}
                  >
                    {column.label}
                  </SortHead>
                ) : (
                  <TableHead key={column.key}>{column.label}</TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>

          <TableBody>
            {groups.map((group) => {
              const count = group.members.length;
              const isOpen = open.has(group.key);
              const noun = count === 1 ? "member" : "members";

              return (
                <Fragment key={group.key}>
                  <TableRow
                    className={group.leadMatched ? "group" : "group opacity-60"}
                    title={
                      group.leadMatched
                        ? undefined
                        : "Shown for context: this client did not match the search"
                    }
                  >
                    <RowCheckbox
                      client={group.lead}
                      selected={selected}
                      onToggle={toggleRow}
                    />

                    <TableCell>
                      <div className="flex items-center gap-2">
                        {count > 0 ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "Show"} ${count} ${noun} of ${group.household?.name ?? "this household"}`}
                            onClick={() => toggle(group.key)}
                          >
                            <ChevronRight
                              className={`size-4 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`}
                            />
                          </Button>
                        ) : (
                          <span className="size-7 shrink-0" aria-hidden />
                        )}

                        <ClientLink
                          client={group.lead}
                          badge={
                            group.leadIsPrimary ? (
                              <Badge variant="secondary" className="gap-1">
                                <Crown className="size-3" />
                                Primary
                              </Badge>
                            ) : null
                          }
                          detail={[
                            group.lead.ref,
                            group.lead.mobile,
                            count > 0 ? `${count} ${noun}` : null,
                          ]}
                        />
                      </div>
                    </TableCell>

                    <DetailCells
                      client={group.lead}
                      household={group.household}
                      shown={shown}
                      dense={dense}
                    />
                  </TableRow>

                  {isOpen
                    ? group.members.map((member) => (
                        <TableRow key={member.id} className="group bg-muted/30">
                          <RowCheckbox
                            client={member}
                            selected={selected}
                            onToggle={toggleRow}
                          />

                          <TableCell>
                            {/* Indented past the toggle, with a rail joining
                                the family to the primary above it. */}
                            <div className="ml-[18px] flex items-center border-l border-border py-0.5 pl-[25px]">
                              <ClientLink
                                client={member}
                                compact
                                detail={[
                                  member.householdRole
                                    ? HOUSEHOLD_ROLE_LABELS[member.householdRole]
                                    : null,
                                  member.ref,
                                  member.mobile,
                                ]}
                              />
                            </div>
                          </TableCell>

                          {/* The household is the row above; repeating it on
                              every member is noise, so the cell is left blank
                              rather than omitted. */}
                          <DetailCells
                            client={member}
                            household={null}
                            shown={shown}
                            dense={dense}
                          />
                        </TableRow>
                      ))
                    : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {lastPage > 1 ? (
        <div className="flex items-center justify-between">
          <p className="tabular text-sm text-muted-foreground">
            Page {page} of {lastPage}
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={pageHref(page - 1)}>Previous</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Previous
              </Button>
            )}
            {page < lastPage ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={pageHref(page + 1)}>Next</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Next
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ClientLink({
  client,
  detail,
  badge,
  compact = false,
}: {
  client: ClientGroupMember;
  detail: (string | null)[];
  badge?: ReactNode;
  compact?: boolean;
}) {
  return (
    <Link
      href={`/clients/${client.id}`}
      className="flex min-w-0 items-center gap-3"
    >
      <Avatar className={compact ? "size-7" : "size-8"}>
        <AvatarFallback className="text-[11px]">
          {initials(client)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium group-hover:underline">
            {displayName(client)}
          </span>
          {badge}
        </span>
        <span className="tabular block truncate text-xs text-muted-foreground">
          {detail.filter(Boolean).join(" · ")}
        </span>
      </span>
    </Link>
  );
}

/** City, manager, last interaction and status: the same for a lead or a member. */
/**
 * One cell per chosen column, in the order the declaration lists them.
 *
 * Driven by the same array as the header, so a column can never appear in one
 * and not the other, and adding one is a single line in `CLIENT_COLUMNS`.
 */
function DetailCells({
  client,
  household,
  shown,
  dense,
}: {
  client: ClientGroupMember;
  household: ClientGroup["household"];
  shown: readonly (typeof CLIENT_COLUMNS)[number][];
  dense: boolean;
}) {
  const pad = dense ? "py-1.5" : "";

  return (
    <>
      {shown.map((column) => {
        switch (column.key) {
          case "household":
            return (
              <TableCell key={column.key} className={`text-sm ${pad}`}>
                {household ? (
                  <Link
                    href={`/households/${household.id}`}
                    className="hover:underline"
                  >
                    {household.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            );

          case "city":
            return (
              <TableCell key={column.key} className={`text-sm ${pad}`}>
                {client.city ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
            );

          case "manager":
            return (
              <TableCell key={column.key} className={`text-sm ${pad}`}>
                {client.rmName ?? (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
              </TableCell>
            );

          case "since":
            return (
              <TableCell key={column.key} className={`tabular text-sm ${pad}`}>
                {formatDate(client.customerSince)}
              </TableCell>
            );

          case "lastContacted":
            return (
              <TableCell key={column.key} className={`text-sm ${pad}`}>
                <span
                  className={client.lastInteractionAt ? "" : "text-muted-foreground"}
                >
                  {timeAgo(client.lastInteractionAt)}
                </span>
              </TableCell>
            );

          case "status":
            return (
              <TableCell key={column.key} className={`text-right ${pad}`}>
                {client.archivedAt ? (
                  <Badge variant="outline">Archived</Badge>
                ) : (
                  <Badge
                    variant={client.status === "active" ? "secondary" : "outline"}
                  >
                    {CLIENT_STATUS_LABELS[client.status]}
                  </Badge>
                )}
              </TableCell>
            );
        }
      })}
    </>
  );
}

/**
 * A column header that sorts.
 *
 * The order lives in the URL like every other part of this view, so a sorted
 * list can be bookmarked and the server stays the only thing that orders
 * anything. Clicking the column already sorted reverses it; clicking a
 * different one opens it the way round that column is usually asked — names
 * from A, dates from the most recent.
 */
function SortHead({
  sort,
  query,
  children,
  className,
  align = "left",
}: {
  sort: ClientSort;
  query: string;
  children: ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  const params = new URLSearchParams(query);
  const current = params.get("sort");
  const active = current === sort;
  const direction = active
    ? (params.get("dir") ?? CLIENT_SORT_DEFAULT_DIRECTION[sort])
    : null;

  const next = new URLSearchParams(query);
  next.set("sort", sort);
  next.set(
    "dir",
    direction === "asc" ? "desc" : direction === "desc" ? "asc" : CLIENT_SORT_DEFAULT_DIRECTION[sort],
  );
  // A new ordering starts from the top of the list, not halfway down it.
  next.delete("page");

  return (
    <TableHead className={className}>
      <Link
        href={`?${next.toString()}`}
        aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
        className={`flex items-center gap-1 transition-colors hover:text-foreground ${
          align === "right" ? "justify-end" : ""
        } ${active ? "text-foreground" : ""}`}
      >
        {children}
        {active ? (
          direction === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </Link>
    </TableHead>
  );
}

const COLUMNS_KEY = "blackbook.client-columns";
const DENSITY_KEY = "blackbook.client-density";

/**
 * How the table is laid out for whoever is reading it.
 *
 * Read as an external store rather than copied into state on mount: the values
 * live in the browser, not in React, and a second tab changing them keeps every
 * open list in step. The server renders the defaults, so the first paint is the
 * same for everybody and the remembered choice takes over on hydration.
 */
const listeners = new Set<() => void>();
let columnsCache: ClientColumnKey[] | null = null;
let denseCache: boolean | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== COLUMNS_KEY && event.key !== DENSITY_KEY) return;
    columnsCache = null;
    denseCache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function announce() {
  for (const listener of listeners) listener();
}

const serverColumns = () => DEFAULT_CLIENT_COLUMNS;

function columnSnapshot(): ClientColumnKey[] {
  columnsCache ??= readColumns();
  return columnsCache;
}

function densitySnapshot(): boolean {
  denseCache ??= readDense();
  return denseCache;
}

/** Browsers can refuse storage outright; a refused preference is not an error. */
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The choice still holds for this visit.
  }
}

function writeColumns(next: ClientColumnKey[]) {
  columnsCache = next;
  write(COLUMNS_KEY, JSON.stringify(next));
  announce();
}

function writeDense(next: boolean) {
  denseCache = next;
  write(DENSITY_KEY, next ? "dense" : "comfortable");
  announce();
}

function readColumns(): ClientColumnKey[] {
  try {
    const raw = window.localStorage.getItem(COLUMNS_KEY);
    if (!raw) return DEFAULT_CLIENT_COLUMNS;

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_CLIENT_COLUMNS;

    /*
     * Keeps only keys that still exist. A column renamed in a later release
     * would otherwise leave whoever had chosen it with a table of blanks and no
     * way back except clearing site data.
     */
    const known = CLIENT_COLUMNS.map((column) => column.key);
    const kept = parsed.filter((key): key is ClientColumnKey =>
      known.includes(key as ClientColumnKey),
    );
    return kept.length > 0 ? kept : DEFAULT_CLIENT_COLUMNS;
  } catch {
    return DEFAULT_CLIENT_COLUMNS;
  }
}

function readDense(): boolean {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === "dense";
  } catch {
    return false;
  }
}

function ColumnChooser({
  chosen,
  onToggle,
  onReset,
}: {
  chosen: ClientColumnKey[];
  onToggle: (key: ClientColumnKey) => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
        >
          <Columns3 className="size-3.5" />
          Columns
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        {CLIENT_COLUMNS.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.key}
            checked={chosen.includes(column.key)}
            /* The menu stays open: choosing columns is several decisions. */
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => onToggle(column.key)}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReset}>Reset to default</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowCheckbox({
  client,
  selected,
  onToggle,
}: {
  client: ClientGroupMember;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <TableCell className="w-10">
      <Checkbox
        checked={selected.has(client.id)}
        aria-label={`Select ${displayName(client)}`}
        onCheckedChange={() => onToggle(client.id)}
      />
    </TableCell>
  );
}

/**
 * What can be done to the clients that are ticked.
 *
 * Two actions, both chosen for being answerable: handing a set of clients to a
 * colleague, and taking them out to a spreadsheet. Archiving is not here on
 * purpose — it is reversible but not casually so, and a mis-click across twelve
 * rows is a different kind of mistake from a mis-click on one.
 */
function SelectionBar({
  count,
  staff,
  canReassign,
  clients,
  onDone,
}: {
  count: number;
  staff: { id: string; name: string }[];
  canReassign: boolean;
  clients: ClientGroupMember[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function reassign(rmId: string) {
    startTransition(async () => {
      const result = await reassignClientsAction({
        customerIds: clients.map((client) => client.id),
        primaryRmId: rmId === UNASSIGNED ? null : rmId,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const moved = result.data.moved;
      toast.success(
        moved === 0
          ? "They were already with that colleague"
          : `${moved} ${moved === 1 ? "client" : "clients"} reassigned`,
      );
      onDone();
    });
  }

  /**
   * Built and downloaded in the browser rather than fetched.
   *
   * Everything in the file is already on this screen, so a round trip would
   * only be asking the server to repeat itself. Values are quoted and any
   * quote inside them doubled, which is what keeps a client called
   * O"Brien, or a household with a comma, in one cell.
   */
  function exportCsv() {
    const header = ["Reference", "Name", "City", "Manager", "Status", "Last contacted"];
    const rows = clients.map((client) => [
      client.ref,
      displayName(client),
      client.city ?? "",
      client.rmName ?? "",
      client.status,
      client.lastInteractionAt
        ? formatDate(client.lastInteractionAt)
        : "never",
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `vara5-clients-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-accent/40 px-3 py-2 text-sm">
      <span className="font-medium">
        <span className="tabular">{count}</span>{" "}
        {count === 1 ? "client" : "clients"} selected
      </span>

      {canReassign ? (
        <Select disabled={pending} onValueChange={reassign}>
          <SelectTrigger size="sm" className="h-7 w-48 bg-background text-xs">
            <SelectValue placeholder="Hand to a colleague" />
          </SelectTrigger>
          <SelectContent>
            {staff.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.name}
              </SelectItem>
            ))}
            <SelectItem value={UNASSIGNED}>Nobody</SelectItem>
          </SelectContent>
        </Select>
      ) : null}

      <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={exportCsv}>
        <Download className="size-3.5" />
        Export
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-7 text-muted-foreground"
        onClick={onDone}
      >
        Clear
      </Button>
    </div>
  );
}

/** A value the picker can carry, since an empty string closes the menu. */
const UNASSIGNED = "__unassigned__";
