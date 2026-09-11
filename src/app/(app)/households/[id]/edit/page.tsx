import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, getActor } from "@/auth/session";
import { HouseholdForm } from "@/components/households/household-form";
import { PageHeader } from "@/components/page-header";
import { getHousehold } from "@/services/household-service";

export const metadata: Metadata = { title: "Edit household" };

export default async function EditHouseholdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor || !can(actor, "household.manage")) notFound();

  const record = await getHousehold(id);
  if (!record) notFound();

  return (
    <>
      <PageHeader
        title={`Edit ${record.household.name}`}
        description={record.household.ref}
      />
      <HouseholdForm household={record.household} />
    </>
  );
}
