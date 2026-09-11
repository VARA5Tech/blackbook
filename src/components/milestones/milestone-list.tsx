import Link from "next/link";
import type { UpcomingMilestone } from "@/services/milestone-service";
import { MILESTONE_TYPE_LABELS, occurrenceNumber } from "@/domain/milestones";
import { countdown, formatDayMonth } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Shared upcoming-milestone list used by the home screen and the milestones
 * page. Sorted by days remaining, which is the only order that matters to an
 * ops team planning outreach.
 */
export function MilestoneList({
  milestones,
  showNotes = false,
}: {
  milestones: UpcomingMilestone[];
  showNotes?: boolean;
}) {
  return (
    <ul className="divide-y divide-border">
      {milestones.map((milestone) => {
        const ordinal = occurrenceNumber(
          milestone.date,
          milestone.nextOccurrence,
        );
        const soon = milestone.daysUntil <= 7;

        const href = milestone.customerId
          ? `/clients/${milestone.customerId}`
          : milestone.householdId
            ? `/households/${milestone.householdId}`
            : null;

        const who = milestone.customerName ?? milestone.householdName ?? "—";

        const body = (
          <div className="flex items-baseline gap-4 py-3">
            <div className="w-20 shrink-0">
              <p className="tabular text-sm font-medium">
                {formatDayMonth(milestone.nextOccurrence)}
              </p>
              <p
                className={cn(
                  "text-xs",
                  soon
                    ? "font-medium text-accent-foreground"
                    : "text-muted-foreground",
                )}
              >
                {countdown(milestone.daysUntil)}
              </p>
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{who}</p>
              <p className="truncate text-xs text-muted-foreground">
                {MILESTONE_TYPE_LABELS[milestone.type]}
                {ordinal ? ` · ${ordinal}${ordinalSuffix(ordinal)}` : ""}
                {/* Only worth naming the household when the row is titled by a person. */}
                {milestone.customerName && milestone.householdName
                  ? ` · ${milestone.householdName}`
                  : ""}
              </p>
              {showNotes && milestone.celebrationStyle ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {milestone.celebrationStyle}
                </p>
              ) : null}
            </div>
          </div>
        );

        return (
          <li key={milestone.id}>
            {href ? (
              <Link href={href} className="block hover:bg-accent/30">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ordinalSuffix(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return "th";
  switch (value % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}
