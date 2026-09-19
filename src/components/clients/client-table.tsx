"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Crown } from "lucide-react";
import type {
  ClientGroup,
  ClientGroupMember,
} from "@/repositories/customer-repository";
import {
  HOUSEHOLD_ROLE_LABELS,
  displayName,
  initials,
  CLIENT_STATUS_LABELS,
} from "@/domain/customers";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { timeAgo } from "@/lib/format";

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

  const lastPage = Math.max(1, Math.ceil(totalGroups / pageSize));

  const pageHref = (target: number) => {
    const query = new URLSearchParams(baseQuery);
    query.set("page", String(target));
    return `?${query.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Client</TableHead>
              <TableHead className="hidden md:table-cell">Household</TableHead>
              <TableHead className="hidden lg:table-cell">City</TableHead>
              <TableHead className="hidden lg:table-cell">Manager</TableHead>
              <TableHead className="hidden sm:table-cell">
                Last interaction
              </TableHead>
              <TableHead className="text-right">Status</TableHead>
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

                    <TableCell className="hidden md:table-cell">
                      {group.household ? (
                        <Link
                          href={`/households/${group.household.id}`}
                          className="text-sm hover:underline"
                        >
                          {group.household.name}
                        </Link>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    <DetailCells client={group.lead} />
                  </TableRow>

                  {isOpen
                    ? group.members.map((member) => (
                        <TableRow key={member.id} className="group bg-muted/30">
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
                              every member is noise. */}
                          <TableCell className="hidden md:table-cell" />

                          <DetailCells client={member} />
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
function DetailCells({ client }: { client: ClientGroupMember }) {
  return (
    <>
      <TableCell className="hidden text-sm lg:table-cell">
        {client.city ?? "—"}
      </TableCell>

      <TableCell className="hidden text-sm lg:table-cell">
        {client.rmName ?? (
          <span className="text-muted-foreground">Unassigned</span>
        )}
      </TableCell>

      <TableCell className="hidden text-sm sm:table-cell">
        <span className={client.lastInteractionAt ? "" : "text-muted-foreground"}>
          {timeAgo(client.lastInteractionAt)}
        </span>
      </TableCell>

      <TableCell className="text-right">
        {client.archivedAt ? (
          <Badge variant="outline">Archived</Badge>
        ) : (
          <Badge variant={client.status === "active" ? "secondary" : "outline"}>
            {CLIENT_STATUS_LABELS[client.status]}
          </Badge>
        )}
      </TableCell>
    </>
  );
}
