import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getActor } from "@/auth/session";
import { can } from "@/auth/session";
import { ClientFilters } from "@/components/clients/client-filters";
import { ClientTable } from "@/components/clients/client-table";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { searchClients } from "@/services/client-service";
import { getCatalogue } from "@/services/preference-service";
import { listStaff } from "@/services/user-service";

export const metadata: Metadata = { title: "Clients" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
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

  const [results, catalogue, staff] = await Promise.all([
    searchClients({
      q: first(params, "q"),
      status: first(params, "status") as "active" | "inactive" | undefined,
      rmId: first(params, "rm"),
      city: first(params, "city"),
      prefers: all(params, "prefers"),
      avoids: all(params, "avoids"),
      notContactedInDays: first(params, "stale")
        ? Number(first(params, "stale"))
        : undefined,
      includeArchived: first(params, "archived") === "1",
      sort: (first(params, "sort") ?? "relevance") as never,
      limit,
      offset: (Math.max(page, 1) - 1) * limit,
    }),
    getCatalogue(),
    listStaff(),
  ]);

  const canCreate = actor ? can(actor, "client.create") : false;

  return (
    <>
      <PageHeader
        title="Clients"
        description={
          results.total === 1 ? "1 client" : `${results.total} clients`
        }
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
        {results.rows.length === 0 ? (
          <EmptyState
            title="No clients matched"
            description="Try a different name, client ID or mobile number, or clear the preference filters."
          />
        ) : (
          <ClientTable
            rows={results.rows}
            total={results.total}
            page={Math.max(page, 1)}
            pageSize={limit}
            baseQuery={baseQuery.toString()}
          />
        )}
      </div>
    </>
  );
}
