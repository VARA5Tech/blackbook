import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, getActor } from "@/auth/session";
import { PageHeader } from "@/components/page-header";
import { UserTable } from "@/components/settings/user-table";
import { listAllUsers } from "@/services/user-service";

export const metadata: Metadata = { title: "Team" };

export default async function UsersPage() {
  const actor = await getActor();
  if (!actor || !can(actor, "user.manage")) notFound();

  const users = await listAllUsers();

  return (
    <>
      <PageHeader
        title="Team"
        description="Who can sign in, and what each person is allowed to do."
      />
      <UserTable users={users} currentUserId={actor.id} />
    </>
  );
}
