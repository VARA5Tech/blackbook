import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { MemberAnalyticsView } from "@/components/analytics/member-analytics";
import { getMemberAnalytics } from "@/services/dashboard-service";
import { ANALYTICS_RANGES, type AnalyticsRange } from "@/domain/engagement";

export const metadata: Metadata = { title: "Members" };

/** Live figures, never cached at the edge. */
export const dynamic = "force-dynamic";

const DEFAULT_RANGE: AnalyticsRange = 30;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const asked = Number(typeof params.days === "string" ? params.days : "");
  // Anything else falls back rather than reaching the query.
  const days = (ANALYTICS_RANGES as readonly number[]).includes(asked)
    ? (asked as AnalyticsRange)
    : DEFAULT_RANGE;

  // Off unless asked for: the desk's own testing is heavier than every client
  // put together, and it is not demand.
  const includeTesters = params.testers === "1";
  const { analytics, configured, testers } = await getMemberAnalytics(
    days,
    includeTesters,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Members"
        description="What clients are reading on vara5.com, and how far it gets them."
      />

      <MemberAnalyticsView
        analytics={analytics}
        days={days}
        configured={configured}
        testers={testers}
        includeTesters={includeTesters}
      />
    </div>
  );
}
