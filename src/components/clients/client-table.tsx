import Link from "next/link";
import type { ClientSearchRow } from "@/repositories/customer-repository";
import { displayName, initials } from "@/domain/customers";
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
 * Results are searched, ranked and paginated in Postgres, so this stays a plain
 * server-rendered table. A client-side table library would only re-sort the one
 * page already on screen, which is the wrong answer for the ops team.
 */
export function ClientTable({
  rows,
  total,
  page,
  pageSize,
  baseQuery,
}: {
  rows: ClientSearchRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Current filters, without `page`, so paging keeps the active search. */
  baseQuery: string;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

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
            {rows.map((row) => (
              <TableRow key={row.id} className="group">
                <TableCell>
                  <Link
                    href={`/clients/${row.id}`}
                    className="flex items-center gap-3"
                  >
                    <Avatar className="size-8">
                      <AvatarFallback className="text-[11px]">
                        {initials(row)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0">
                      <span className="block truncate font-medium group-hover:underline">
                        {displayName(row)}
                      </span>
                      <span className="tabular block truncate text-xs text-muted-foreground">
                        {row.ref}
                        {row.mobile ? ` · ${row.mobile}` : ""}
                      </span>
                    </span>
                  </Link>
                </TableCell>

                <TableCell className="hidden md:table-cell">
                  {row.householdId ? (
                    <Link
                      href={`/households/${row.householdId}`}
                      className="text-sm hover:underline"
                    >
                      {row.householdName}
                    </Link>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>

                <TableCell className="hidden text-sm lg:table-cell">
                  {row.city ?? "—"}
                </TableCell>

                <TableCell className="hidden text-sm lg:table-cell">
                  {row.rmName ?? (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </TableCell>

                <TableCell className="hidden text-sm sm:table-cell">
                  <span
                    className={
                      row.lastInteractionAt ? "" : "text-muted-foreground"
                    }
                  >
                    {timeAgo(row.lastInteractionAt)}
                  </span>
                </TableCell>

                <TableCell className="text-right">
                  {row.archivedAt ? (
                    <Badge variant="outline">Archived</Badge>
                  ) : row.status === "active" ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="outline">Inactive</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {total > pageSize ? (
        <div className="flex items-center justify-between">
          <p className="tabular text-sm text-muted-foreground">
            {from} to {to} of {total}
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
