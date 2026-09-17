import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { getActor } from "@/auth/session";
import { MilestoneList } from "@/components/milestones/milestone-list";
import { EmptyState, Section } from "@/components/page-header";
import { getOpsDashboard } from "@/services/dashboard-service";
import { displayName } from "@/domain/customers";
import { formatDateTime } from "@/lib/format";

/** The dashboard reflects today's data and the signed-in user; never cache it. */
export const dynamic = "force-dynamic";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function HomePage() {
  const [actor, dashboard] = await Promise.all([getActor(), getOpsDashboard()]);
  const { counts } = dashboard;

  const stats = [
    {
      value: counts.birthdaysThisWeek,
      label: counts.birthdaysThisWeek === 1 ? "birthday" : "birthdays",
      detail: "in the next 7 days",
      href: "/milestones?type=birthday",
    },
    {
      value: counts.anniversariesThisMonth,
      label:
        counts.anniversariesThisMonth === 1 ? "anniversary" : "anniversaries",
      detail: "in the next 30 days",
      href: "/milestones?type=wedding_anniversary",
    },
    {
      value: counts.followUps,
      label: counts.followUps === 1 ? "client" : "clients",
      detail: `not contacted in ${counts.followUpDays} days`,
      href: `/clients?stale=${counts.followUpDays}`,
    },
    {
      value: counts.incomplete,
      label: counts.incomplete === 1 ? "profile" : "profiles",
      detail: "missing key details",
      href: "/clients",
    },
  ];

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-display text-3xl tracking-tight">
          {greeting()}
          {actor ? `, ${actor.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatDateTime(new Date()).split(",")[0]}
        </p>
      </header>

      <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link
            key={stat.detail}
            href={stat.href}
            className="group bg-card p-5 transition-colors hover:bg-accent/40"
          >
            <p className="tabular font-display text-3xl leading-none tracking-tight">
              {stat.value}
            </p>
            <p className="mt-2 text-sm font-medium">{stat.label}</p>
            <p className="text-xs text-muted-foreground">{stat.detail}</p>
          </Link>
        ))}
      </section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section
          title="Upcoming milestones"
          action={
            <Link
              href="/milestones"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              All milestones
              <ArrowRight className="size-3" />
            </Link>
          }
        >
          {dashboard.upcoming.length === 0 ? (
            <EmptyState
              title="Nothing in the next 45 days"
              description="Birthdays and anniversaries appear here as they approach."
            />
          ) : (
            <MilestoneList milestones={dashboard.upcoming} />
          )}
        </Section>

        <div className="space-y-10">
          {dashboard.wanted.length > 0 ? (
            <Section title={`Most wanted · last ${dashboard.wantedDays} days`}>
              <ul className="space-y-3">
                {dashboard.wanted.map((journey) => (
                  <li
                    key={journey.destination}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="truncate">{journey.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      <span className="tabular">{journey.clients}</span>
                      {journey.clients === 1 ? " client" : " clients"}
                      {journey.asked > 0 ? (
                        <>
                          {" · "}
                          <span className="tabular">{journey.asked}</span> asked
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section
            title="Recently updated"
            action={
              <Link
                href="/clients"
                className="text-xs text-muted-foreground hover:underline"
              >
                All clients
              </Link>
            }
          >
            <ul className="space-y-2">
              {dashboard.recentClients.map((client) => (
                <li key={client.id}>
                  <Link
                    href={`/clients/${client.id}`}
                    className="flex items-baseline justify-between gap-3 text-sm hover:underline"
                  >
                    <span className="truncate">{displayName(client)}</span>
                    <span className="tabular shrink-0 text-xs text-muted-foreground">
                      {client.ref}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Recent activity"
            action={
              <Link
                href="/activity"
                className="text-xs text-muted-foreground hover:underline"
              >
                All activity
              </Link>
            }
          >
            <ul className="space-y-3">
              {dashboard.activity.slice(0, 8).map((entry) => (
                <li key={entry.id} className="text-sm">
                  {entry.customerId ? (
                    <Link
                      href={`/clients/${entry.customerId}`}
                      className="hover:underline"
                    >
                      {entry.summary}
                    </Link>
                  ) : (
                    <span>{entry.summary}</span>
                  )}
                  <p className="tabular text-xs text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                    {entry.actorName ? ` · ${entry.actorName}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
