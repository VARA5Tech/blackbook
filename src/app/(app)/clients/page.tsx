import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getActor } from "@/auth/session";
import type { ClientStatus } from "@/domain/customers";
import { can } from "@/auth/session";
import { ClientFilters } from "@/components/clients/client-filters";
import { ClientTable } from "@/components/clients/client-table";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { searchClientGroups } from "@/services/client-service";
import { getCatalogue } from "@/services/preference-service";
import { listStaff } from "@/services/user-service";

export const metadata: Metadata = { title: "Clients" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** "10 clients · 1 household", counting every client the filters matched. */
function listSummary(clients: number, households: number): string {
  const people = clients === 1 ? "1 client" : `${clients} clients`;
  if (households === 0) return people;
  return `${people} · ${households === 1 ? "1 household" : `${households} households`}`;
}

function all(params: SearchParams, key: string): string[] {
  const value = params[key];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const actor = await getActor();

  const page = Number(first(params, "page") ?? "1");
  const limit = 25;

  // Everything except the page number, so paging preserves the active filters.
  const baseQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      baseQuery.append(key, item);
    }
  }

  // Ordering is not narrowing. Any other parameter means the reader is looking
  // for particular people, so their households open to show who matched.
  const ORDERING = new Set(["sort", "dir"]);
  const filtering = [...baseQuery.keys()].some((key) => !ORDERING.has(key));

  const [results, catalogue, staff] = await Promise.all([
    searchClientGroups({
      q: first(params, "q"),
      status: first(params, "status") as ClientStatus | undefined,
      rmId: first(params, "rm"),
      city: first(params, "city"),
      prefers: all(params, "prefers"),
      avoids: all(params, "avoids"),
      notContactedInDays: first(params, "stale")
        ? Number(first(params, "stale"))
        : undefined,
      includeArchived: first(params, "archived") === "1",
      sort: (first(params, "sort") ?? "relevance") as never,
      dir: first(params, "dir") as "asc" | "desc" | undefined,
      limit,
      offset: (Math.max(page, 1) - 1) * limit,
    }),
    getCatalogue(),
    listStaff(),
  ]);

  const canCreate = actor ? can(actor, "client.create") : false;
  const canReassign = actor ? can(actor, "client.reassign_rm") : false;

  return (
    <>
      <PageHeader
        title="Clients"
        description={listSummary(results.totalClients, results.totalHouseholds)}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/clients/new">
                <Plus />
                New client
              </Link>
            </Button>
          ) : null
        }
      />

      <ClientFilters
        catalogue={Object.fromEntries(catalogue)}
        staff={staff}
      />

      <div className="mt-6">
        {results.groups.length === 0 ? (
          <EmptyState
            title="No clients matched"
            description="Try a different name, client ID or mobile number, or clear the preference filters."
          />
        ) : (
          <ClientTable
            // Remounts on a new search or page, so households opened on one
            // page do not stay open against another page's results.
            key={`${baseQuery.toString()}|${page}`}
            groups={results.groups}
            totalGroups={results.totalGroups}
            page={Math.max(page, 1)}
            pageSize={limit}
            baseQuery={baseQuery.toString()}
            expandByDefault={filtering}
            staff={staff}
            canReassign={canReassign}
          />
        )}
      </div>
    </>
  );
}
