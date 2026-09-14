import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, getActor } from "@/auth/session";
import { ClientForm } from "@/components/clients/client-form";
import { PageHeader } from "@/components/page-header";
import { displayName } from "@/domain/customers";
import { getClient360 } from "@/services/client-service";
import { listHouseholdOptions } from "@/services/household-service";
import { listStaff } from "@/services/user-service";

export const metadata: Metadata = { title: "Edit client" };

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor || !can(actor, "client.update")) notFound();

  const record = await getClient360(id);
  if (!record) notFound();

  const [households, staff] = await Promise.all([
    listHouseholdOptions(),
    listStaff(),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title={`Edit ${displayName(record.customer)}`}
        description={record.customer.ref}
      />
      <ClientForm
        customer={record.customer}
        households={households}
        staff={staff}
        canArchive={can(actor, "client.archive")}
        canReassign={can(actor, "client.reassign_rm")}
      />
    </div>
  );
}
