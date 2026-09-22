import type { Metadata } from "next";
import { CalendarHeart, History as HistoryIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can, getActor } from "@/auth/session";
import { HouseholdDetails, HouseholdMembers } from "@/components/households/household-members";
import { PageHeader, Section } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listHouseholdActivity } from "@/services/activity-service";
import { getHousehold } from "@/services/household-service";
import { searchClients } from "@/services/client-service";
import { displayName } from "@/domain/customers";
import { formatDate, formatDateTime } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const record = await getHousehold(id);
  return { title: record?.household.name ?? "Household" };
}

export default async function HouseholdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [record, actor] = await Promise.all([getHousehold(id), getActor()]);
  if (!record || !actor) notFound();

  const { household, members } = record;
  const canManage = can(actor, "household.manage");

  // Clients with no household yet, offered as candidates to link.
  const unlinked = canManage
    ? (await searchClients({ limit: 100, sort: "name" })).rows.filter(
        (row) => row.householdId === null,
      )
    : [];

  const activity = await listHouseholdActivity(id, 20);

  return (
    <>
      <PageHeader
        title={household.name}
        description={
          <span className="tabular">
            {household.ref}
            {household.city ? ` · ${household.city}` : ""}
          </span>
        }
        actions={
          canManage ? (
            <Button variant="outline" asChild>
              <Link href={`/households/${household.id}/edit`}>Edit</Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <HouseholdMembers
            householdId={household.id}
            primaryCustomerId={household.primaryCustomerId}
            members={members}
            candidates={unlinked.map((row) => ({
              id: row.id,
              ref: row.ref,
              label: displayName(row),
            }))}
            canManage={canManage}
          />

          <HouseholdDetails household={household} canEdit={canManage} />
        </div>

        <div className="space-y-6">
          <Section title="Household milestones" icon={CalendarHeart}>
            {record.milestones.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No shared dates recorded. Anniversaries that belong to the
                family as a whole live here; personal birthdays stay on each
                member&rsquo;s own profile.
              </p>
            ) : (
              <ul className="space-y-3">
                {record.milestones.map((milestone) => (
                  <li key={milestone.id}>
                    <p className="text-sm font-medium">{milestone.title}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      {formatDate(milestone.date)}
                    </p>
                    {milestone.celebrationStyle ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {milestone.celebrationStyle}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="History" icon={HistoryIcon}>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No activity recorded.
              </p>
            ) : (
              <ol className="space-y-3">
                {activity.map((entry) => (
                  <li key={entry.id} className="text-sm">
                    {entry.summary}
                    <p className="tabular text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                      {entry.actorName ? ` · ${entry.actorName}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
