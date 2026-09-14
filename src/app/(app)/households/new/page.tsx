import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, getActor } from "@/auth/session";
import { HouseholdForm } from "@/components/households/household-form";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "New household" };

export default async function NewHouseholdPage() {
  const actor = await getActor();
  if (!actor || !can(actor, "household.manage")) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader
        title="New household"
        description="Create the family first, then link its members from the household page."
      />
      <HouseholdForm />
    </div>
  );
}
