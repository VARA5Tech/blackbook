import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { can, getActor } from "@/auth/session";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listHouseholds } from "@/services/household-service";
import { humanise } from "@/lib/format";

export const metadata: Metadata = { title: "Households" };

export default async function HouseholdsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const term = Array.isArray(params.q) ? params.q[0] : params.q;

  const [households, actor] = await Promise.all([
    listHouseholds(term),
    getActor(),
  ]);

  const canCreate = actor ? can(actor, "household.manage") : false;

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

      <form className="pb-6">
        <Input
          name="q"
          defaultValue={term ?? ""}
          placeholder="Household name, household ID or city"
          className="max-w-sm"
          aria-label="Search households"
        />
      </form>

      {households.length === 0 ? (
        <EmptyState
          title="No households found"
          description="Create one from a client profile or with the button above."
        />
      ) : (
        <ul className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {households.map((household) => (
            <li key={household.id} className="bg-card">
              <Link
                href={`/households/${household.id}`}
                className="block p-5 transition-colors hover:bg-accent/40"
              >
                <p className="font-display text-lg tracking-tight">
                  {household.name}
                </p>
                <p className="tabular mt-1 text-xs text-muted-foreground">
                  {household.ref}
                  {household.city ? ` · ${household.city}` : ""}
                </p>
                <p className="mt-3 text-sm">
                  {household.memberCount}{" "}
                  {household.memberCount === 1 ? "member" : "members"}
                  {household.travelPattern
                    ? ` · ${humanise(household.travelPattern)}`
                    : ""}
                </p>
                {household.primaryCustomerName ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Primary: {household.primaryCustomerName.trim()}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
