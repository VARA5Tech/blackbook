import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { MilestoneList } from "@/components/milestones/milestone-list";
import { getUpcomingMilestones } from "@/services/milestone-service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Milestones" };

const WINDOWS = [
  { days: 30, label: "30 days" },
  { days: 60, label: "60 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
];

export default async function MilestonesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const windowParam = Array.isArray(params.window) ? params.window[0] : params.window;
  const typeParam = Array.isArray(params.type) ? params.type[0] : params.type;

  const days = Number(windowParam ?? 60);
  const all = await getUpcomingMilestones(days, 200);
  const milestones = typeParam
    ? all.filter((milestone) => milestone.type === typeParam)
    : all;

  return (
    <>
      <PageHeader
        title="Milestones"
        description="Birthdays, anniversaries and other dates worth a call. Ordered by how soon they fall."
      />

      <div className="flex flex-wrap gap-1 pb-4">
        {WINDOWS.map((option) => {
          const active = days === option.days;
          const query = new URLSearchParams();
          query.set("window", String(option.days));
          if (typeParam) query.set("type", typeParam);

          return (
            <Link
              key={option.days}
              href={`/milestones?${query.toString()}`}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent/50",
              )}
            >
              Next {option.label}
            </Link>
          );
        })}

        {typeParam ? (
          <Link
            href={`/milestones?window=${days}`}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/50"
          >
            Clear type filter
          </Link>
        ) : null}
      </div>

      {milestones.length === 0 ? (
        <EmptyState
          title="Nothing in this window"
          description="Try a longer window, or add milestones from a client profile."
        />
      ) : (
        <MilestoneList milestones={milestones} showNotes />
      )}
    </>
  );
}
