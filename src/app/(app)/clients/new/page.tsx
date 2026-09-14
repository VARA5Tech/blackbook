import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, getActor } from "@/auth/session";
import { ClientForm } from "@/components/clients/client-form";
import { PageHeader } from "@/components/page-header";
import { listHouseholdOptions } from "@/services/household-service";
import { listStaff } from "@/services/user-service";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage() {
  const actor = await getActor();
  if (!actor || !can(actor, "client.create")) notFound();

  const [households, staff] = await Promise.all([
    listHouseholdOptions(),
    listStaff(),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="New client"
        description="Capture identity and contact details now. Preferences can be added from the profile afterwards."
      />
      <ClientForm
        households={households}
        staff={staff}
        canArchive={false}
        canReassign={can(actor, "client.reassign_rm")}
      />
    </div>
  );
}
