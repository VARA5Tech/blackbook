import { ArrowUpRight, Home } from "lucide-react";
import Link from "next/link";
import { Section } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { Household } from "@/db/schema";
import { HOUSEHOLD_ROLE_LABELS, displayName, initials,
  type ClientStatus,
  CLIENT_STATUS_LABELS,
} from "@/domain/customers";
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
  status: ClientStatus;
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
      <Section title="Household" icon={Home}>
        <p className="text-sm text-muted-foreground">
          Not part of a household yet. Link one from Edit.
        </p>
      </Section>
    );
  }

  const others = members.filter((member) => member.id !== currentCustomerId).length;

  return (
    <Section
      title="Household"
      icon={Home}
      count={members.length}
      flush
      action={
        !expanded ? (
          <Link
            href={`/households/${household.id}`}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          >
            Open
            <ArrowUpRight className="size-3" />
          </Link>
        ) : null
      }
    >
      <div className="border-b border-border px-4 py-3">
        <Link
          href={`/households/${household.id}`}
          className="font-display text-lg tracking-tight hover:underline"
        >
          {household.name}
        </Link>
        <p className="tabular text-xs text-muted-foreground">
          {[household.ref, household.city, others > 0 ? `${others} other ${others === 1 ? "member" : "members"}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {/*
        A large family scrolls rather than pushing everything under it down the
        page. Three fit; past that the list keeps its height and the rest is a
        flick away, which is the right trade in a panel that sits beside the
        record rather than being the record.
      */}
      <ul
        className={cn(
          "divide-y divide-border",
          !expanded && members.length > 3 ? "max-h-52 overflow-y-auto" : null,
        )}
      >
        {members.map((member) => {
          const years = age(member.dateOfBirth);
          const isCurrent = member.id === currentCustomerId;
          const detail = [
            member.householdRole ? HOUSEHOLD_ROLE_LABELS[member.householdRole] : null,
            years !== null ? `${years} yrs` : null,
            expanded && member.dateOfBirth ? formatDayMonth(member.dateOfBirth) : null,
          ]
            .filter(Boolean)
            .join(" · ");

          const row = (
            <>
              <span
                aria-hidden
                className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {initials(member)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm">
                  <span className={`truncate ${isCurrent ? "font-medium" : ""}`}>
                    {displayName(member)}
                  </span>
                  {isCurrent ? (
                    <Badge variant="secondary" className="text-[10px]">
                      This client
                    </Badge>
                  ) : null}
                  {member.status !== "active" ? (
                    <Badge variant="outline" className="text-[10px]">
                      {CLIENT_STATUS_LABELS[member.status]}
                    </Badge>
                  ) : null}
                </span>
                {detail ? (
                  <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                ) : null}
              </span>
            </>
          );

          return (
            <li key={member.id}>
              {isCurrent ? (
                <div className="flex items-center gap-3 bg-muted/40 px-4 py-2.5">{row}</div>
              ) : (
                <Link
                  href={`/clients/${member.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60"
                >
                  {row}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
