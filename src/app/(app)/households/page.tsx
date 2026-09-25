import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Home, Plus, Search } from "lucide-react";
import type { ReactNode } from "react";
import { can, getActor } from "@/auth/session";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  HOUSEHOLD_SORTS,
  HOUSEHOLD_SORT_DEFAULT_DIRECTION,
  type HouseholdSort,
} from "@/domain/households";
import { formatDate, humanise } from "@/lib/format";
import { listHouseholds } from "@/services/household-service";

export const metadata: Metadata = { title: "Households" };

const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/**
 * Households as a table, the same way the client list reads: one family per
 * row, the facts a curator scans for in fixed columns, and every column that
 * is worth ordering by sortable from its header.
 */
export default async function HouseholdsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const term = one(params.q);
  const requested = one(params.sort);
  const sort: HouseholdSort = (HOUSEHOLD_SORTS as readonly string[]).includes(requested ?? "")
    ? (requested as HouseholdSort)
    : "name";
  const dirParam = one(params.dir);
  const dir = dirParam === "asc" || dirParam === "desc" ? dirParam : HOUSEHOLD_SORT_DEFAULT_DIRECTION[sort];

  const [households, actor] = await Promise.all([listHouseholds(term, sort, dir), getActor()]);
  const canCreate = actor ? can(actor, "household.manage") : false;

  const query = new URLSearchParams();
  if (term) query.set("q", term);
  query.set("sort", sort);
  query.set("dir", dir);

  return (
    <>
      <PageHeader
        title="Households"
        description="Families managed as a unit, with each member keeping their own profile."
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/households/new">
                <Plus />
                New household
              </Link>
            </Button>
          ) : null
        }
      />

      <form className="flex items-center gap-2 pb-4">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={term ?? ""}
            placeholder="Household, household ID, city or assistant"
            className="bg-card pl-8"
            aria-label="Search households"
          />
        </div>
        {sort !== "name" ? <input type="hidden" name="sort" value={sort} /> : null}
        {sort !== "name" ? <input type="hidden" name="dir" value={dir} /> : null}
        <span className="tabular ml-auto text-xs text-muted-foreground">
          {households.length} {households.length === 1 ? "household" : "households"}
        </span>
      </form>

      {households.length === 0 ? (
        <EmptyState
          title="No households found"
          description="Create one from a client profile or with the button above."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table containerClassName="max-h-[72vh]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortHead sort="name" current={sort} dir={dir} query={query}>Household</SortHead>
                  <TableHead>Primary client</TableHead>
                  <SortHead sort="members" current={sort} dir={dir} query={query}>Members</SortHead>
                  <SortHead sort="city" current={sort} dir={dir} query={query}>City</SortHead>
                  <TableHead>Travel pattern</TableHead>
                  <TableHead>Relationship manager</TableHead>
                  <SortHead sort="updated" current={sort} dir={dir} query={query}>Updated</SortHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {households.map((household) => {
                  const shownNames = household.memberNames.slice(0, 3);
                  const more = household.memberNames.length - shownNames.length;
                  return (
                    <TableRow key={household.id} className="group relative">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                            <Home className="size-4 text-muted-foreground" />
                          </span>
                          <div className="min-w-0">
                            {/* The name is the row's link; its hit area is stretched
                                over the whole row, so a click anywhere opens it. */}
                            <Link
                              href={`/households/${household.id}`}
                              className="block truncate font-medium after:absolute after:inset-0 hover:underline"
                            >
                              {household.name}
                            </Link>
                            <span className="tabular block text-xs text-muted-foreground">{household.ref}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {household.primaryCustomerName ? (
                          <span className="text-sm">{household.primaryCustomerName.trim()}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="tabular inline-flex min-w-6 justify-center rounded-full bg-muted px-1.5 text-xs font-medium">
                            {household.memberCount}
                          </span>
                          <span className="max-w-56 truncate text-sm text-muted-foreground">
                            {shownNames.join(", ")}
                            {more > 0 ? ` +${more}` : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {household.city ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {household.travelPattern ? (
                          humanise(household.travelPattern)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {household.managerNames.length > 0 ? (
                          household.managerNames.join(", ")
                        ) : (
                          <span className="text-muted-foreground">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular text-sm text-muted-foreground">
                        {formatDate(household.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
        </div>
      )}
    </>
  );
}

function SortHead({
  sort,
  current,
  dir,
  query,
  children,
}: {
  sort: HouseholdSort;
  current: HouseholdSort;
  dir: "asc" | "desc";
  query: URLSearchParams;
  children: ReactNode;
}) {
  const active = sort === current;
  const next = new URLSearchParams(query);
  next.set("sort", sort);
  next.set(
    "dir",
    active ? (dir === "asc" ? "desc" : "asc") : HOUSEHOLD_SORT_DEFAULT_DIRECTION[sort],
  );
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <TableHead aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link
        href={`?${next.toString()}`}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {children}
        <Icon className={`size-3 ${active ? "" : "opacity-40"}`} />
      </Link>
    </TableHead>
  );
}
