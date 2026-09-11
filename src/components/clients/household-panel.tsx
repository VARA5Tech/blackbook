import Link from "next/link";
import { Section } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import type { Household } from "@/db/schema";
import { HOUSEHOLD_ROLE_LABELS, displayName } from "@/domain/customers";
import { age, formatDayMonth } from "@/lib/format";

type Member = {
  id: string;
  ref: string;
  firstName: string;
  lastName: string | null;
  preferredName: string | null;
  householdRole:
    | "primary"
    | "spouse"
    | "partner"
    | "child"
    | "parent"
    | "sibling"
    | "other"
    | null;
  dateOfBirth: string | null;
  status: "active" | "inactive";
};

/**
 * The family as a unit, with each member still linking to their own profile.
 * Individual preferences are never merged into the household.
 */
export function HouseholdPanel({
  household,
  members,
  currentCustomerId,
  expanded = false,
}: {
  household: Household | null;
  members: Member[];
  currentCustomerId: string;
  expanded?: boolean;
}) {
  if (!household) {
    return (
      <Section title="Household">
        <p className="text-sm text-muted-foreground">Not linked to a household.</p>
      </Section>
    );
  }

  return (
    <Section
      title="Household"
      action={
        !expanded ? (
          <Link
            href={`/households/${household.id}`}
            className="text-xs text-muted-foreground hover:underline"
          >
            {household.ref}
          </Link>
        ) : null
      }
    >
      <div className="space-y-3">
        <p className="font-display text-lg tracking-tight">{household.name}</p>

        <ul className="space-y-1">
          {members.map((member, index) => {
            const isLast = index === members.length - 1;
            const years = age(member.dateOfBirth);
            const isCurrent = member.id === currentCustomerId;

            return (
              <li key={member.id} className="flex items-baseline gap-2 text-sm">
                <span
                  aria-hidden
                  className="tabular shrink-0 text-muted-foreground"
                >
                  {isLast ? "└──" : "├──"}
                </span>

                {isCurrent ? (
                  <span className="font-medium">{displayName(member)}</span>
                ) : (
                  <Link
                    href={`/clients/${member.id}`}
                    className="hover:underline"
                  >
                    {displayName(member)}
                  </Link>
                )}

                <span className="truncate text-xs text-muted-foreground">
                  {[
                    member.householdRole
                      ? HOUSEHOLD_ROLE_LABELS[member.householdRole]
                      : null,
                    years !== null ? `${years}` : null,
                    expanded && member.dateOfBirth
                      ? formatDayMonth(member.dateOfBirth)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>

                {member.status === "inactive" ? (
                  <Badge variant="outline" className="text-[10px]">
                    Inactive
                  </Badge>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}
