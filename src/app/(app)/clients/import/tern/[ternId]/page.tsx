import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { can, getActor } from "@/auth/session";
import { TernImportPage } from "@/components/clients/tern-import";
import { EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ternConfigured } from "@/lib/tern";
import { previewTernClient } from "@/services/tern-service";

export const metadata: Metadata = { title: "Import from Tern" };

/** Reads Tern on every visit: this is a live comparison, never a cached one. */
export const dynamic = "force-dynamic";

/**
 * Everything Tern holds for one contact, beside what Blackbook has, for a
 * person to choose from before anything is written.
 *
 * Reached from the Tern search on the clients list, or on a client's own page,
 * in which case `customerId` says which client it is for.
 */
export default async function TernImportRoute({
  params,
  searchParams,
}: {
  params: Promise<{ ternId: string }>;
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { ternId } = await params;
  const { customerId } = await searchParams;
  if (!/^[0-9]{1,12}$/.test(ternId)) notFound();

  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (!ternConfigured() || !can(actor, customerId ? "client.update" : "client.create")) notFound();

  let preview: Awaited<ReturnType<typeof previewTernClient>>;
  try {
    preview = await previewTernClient({ ternId, customerId });
  } catch (error) {
    preview = { ok: false, message: error instanceof Error ? error.message : "Tern could not be read." };
  }

  if (!preview.ok) {
    return (
      <EmptyState
        title="Tern could not be read"
        description={preview.message}
        action={
          <Button asChild variant="outline">
            <Link href={customerId ? `/clients/${customerId}` : "/clients"}>Back</Link>
          </Button>
        }
      />
    );
  }

  return <TernImportPage initial={preview} />;
}
