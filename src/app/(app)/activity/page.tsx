import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { listRecentActivity } from "@/services/activity-service";
import { requireCapability } from "@/auth/session";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage() {
  await requireCapability("client.read");
  const entries = await listRecentActivity(150);

  return (
    <>
      <PageHeader
        title="Activity"
        description="Everything recorded across clients and households, newest first."
      />

      {entries.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <ol className="divide-y divide-border">
          {entries.map((entry) => {
            const href = entry.customerId
              ? `/clients/${entry.customerId}`
              : entry.householdId
                ? `/households/${entry.householdId}`
                : null;

            return (
              <li key={entry.id} className="py-3">
                {href ? (
                  <Link href={href} className="text-sm hover:underline">
                    {entry.summary}
                  </Link>
                ) : (
                  <span className="text-sm">{entry.summary}</span>
                )}
                <p className="tabular text-xs text-muted-foreground">
                  {formatDateTime(entry.createdAt)}
                  {entry.actorName ? ` · ${entry.actorName}` : ""}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
