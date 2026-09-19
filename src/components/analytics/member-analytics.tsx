"use client";

import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ANALYTICS_RANGES,
  type AnalyticsRange,
  type MemberAnalytics,
} from "@/domain/engagement";
import { Section } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDate, readingTime, timeAgo } from "@/lib/format";

/**
 * How the members' site is doing, read commercially.
 *
 * Every number here is meant to end in a decision: which journey to put in
 * front of someone, which one is being turned over and abandoned, and who is
 * warm enough to ring today. Counts that answer nothing are left out.
 */
export function MemberAnalyticsView({
  analytics,
  days,
  configured,
  testers,
  includeTesters,
}: {
  analytics: MemberAnalytics;
  days: AnalyticsRange;
  configured: boolean;
  /** How many records are marked staff, so the switch can say what it hides. */
  testers: number;
  includeTesters: boolean;
}) {
  if (!configured) {
    return (
      <Section title="Not connected">
        <p className="text-sm text-muted-foreground">
          This screen reads from PostHog, which is not configured on this
          deployment. Set <Mono>POSTHOG_PROJECT_ID</Mono> and{" "}
          <Mono>POSTHOG_API_KEY</Mono> to switch it on.
        </p>
      </Section>
    );
  }

  const { funnel, daily, journeys, sections, clients, devices } = analytics;
  const quiet = funnel.visits === 0;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <RangeSwitch days={days} includeTesters={includeTesters} />
        {testers > 0 ? (
          <TesterSwitch days={days} includeTesters={includeTesters} testers={testers} />
        ) : null}
      </div>

      {quiet ? (
        <Section title="Nothing yet">
          <p className="text-sm text-muted-foreground">
            No client has been through the members&rsquo; gate in the last{" "}
            {days} days. This fills in as soon as one does.
          </p>
        </Section>
      ) : (
        <>
          <Funnel funnel={funnel} />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Visits daily={daily} />
            <Sections sections={sections} devices={devices} />
          </div>
          <Journeys journeys={journeys} />
          <Warmest clients={clients} days={days} />
        </>
      )}
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
  );
}

function RangeSwitch({
  days,
  includeTesters,
}: {
  days: AnalyticsRange;
  includeTesters: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs tracking-[0.08em] text-muted-foreground uppercase">
        Last
      </span>
      <div className="flex items-center rounded-md border border-border p-0.5">
        {ANALYTICS_RANGES.map((range) => (
          <Link
            key={range}
            href={`/analytics?days=${range}${includeTesters ? "&testers=1" : ""}`}
            aria-current={range === days ? "page" : undefined}
            className={`rounded px-2.5 py-1 text-xs transition-colors ${
              range === days
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {range} days
          </Link>
        ))}
      </div>
    </div>
  );
}


/**
 * Puts the desk's own browsing back in.
 *
 * Off by default, because staff testing is most of the traffic and none of the
 * demand. On when somebody is checking that the site itself works.
 */
function TesterSwitch({
  days,
  includeTesters,
  testers,
}: {
  days: AnalyticsRange;
  includeTesters: boolean;
  testers: number;
}) {
  return (
    <Link
      href={`/analytics?days=${days}${includeTesters ? "" : "&testers=1"}`}
      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
    >
      <span
        aria-hidden
        className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${
          includeTesters ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`size-3 rounded-full bg-background transition-transform ${
            includeTesters ? "translate-x-3" : ""
          }`}
        />
      </span>
      Include our own testing
      <span className="tabular">({testers})</span>
    </Link>
  );
}

/**
 * The four steps a guest takes, and what falls away between them.
 *
 * Shown as counts with the drop stated in words rather than as a funnel chart:
 * the numbers differ by an order of magnitude, so drawn to scale the last bar
 * would be invisible and the shape would say less than the sentence does.
 */
function Funnel({ funnel }: { funnel: MemberAnalytics["funnel"] }) {
  const steps = [
    { label: "Cards turned over", value: funnel.flipped, of: null },
    { label: "Journeys opened", value: funnel.opened, of: funnel.flipped },
    { label: "Read through", value: funnel.read, of: funnel.opened },
    { label: "Asked the Curator", value: funnel.asked, of: funnel.read },
  ];

  return (
    <Section title="From a glance to an ask">
      <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
        {steps.map((step) => (
          <div key={step.label} className="bg-card p-4">
            <p className="tabular font-display text-3xl tracking-tight">
              {step.value}
            </p>
            <p className="mt-1 text-sm">{step.label}</p>
            {step.of !== null ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {step.of === 0
                  ? "—"
                  : `${Math.round((step.value / step.of) * 100)}% of the step before`}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        {funnel.clients} {funnel.clients === 1 ? "client" : "clients"} across{" "}
        {funnel.visits} {funnel.visits === 1 ? "visit" : "visits"}, spending{" "}
        {readingTime(funnel.seconds)} inside journeys.
      </p>
    </Section>
  );
}

function Visits({ daily }: { daily: MemberAnalytics["daily"] }) {
  const data = daily.map((row) => ({
    ...row,
    label: formatDate(row.day).replace(/ \d{4}$/, ""),
  }));

  return (
    <Section title="Visits">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="visitsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <Tooltip content={<Tip />} cursor={{ stroke: "var(--border)" }} />
            <Area
              type="monotone"
              dataKey="visits"
              name="Visits"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#visitsFill)"
            />
            <Area
              type="monotone"
              dataKey="clients"
              name="Clients"
              stroke="var(--chart-3)"
              strokeWidth={2}
              fill="none"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <Legend
        items={[
          { label: "Visits", colour: "var(--chart-1)" },
          { label: "Distinct clients", colour: "var(--chart-3)" },
        ]}
      />
    </Section>
  );
}

function Sections({
  sections,
  devices,
}: {
  sections: MemberAnalytics["sections"];
  devices: MemberAnalytics["devices"];
}) {
  const known = devices.filter((row) => row.device !== "");
  const total = known.reduce((sum, row) => sum + row.sessions, 0);

  return (
    <Section title="How they read it">
      {sections.length > 0 ? (
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={sections}
              layout="vertical"
              margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid stroke="var(--border)" horizontal={false} />
              <XAxis
                type="number"
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={110}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <Tooltip content={<Tip />} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="views" name="Views" radius={[0, 3, 3, 0]}>
                {sections.map((row, index) => (
                  <Cell
                    key={row.key}
                    fill={`var(--chart-${(index % 5) + 1})`}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No section of an itinerary has been read yet.
        </p>
      )}

      {known.length > 0 ? (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <p className="text-xs tracking-[0.08em] text-muted-foreground uppercase">
            On what
          </p>
          {known.map((row) => (
            <div key={row.device} className="flex items-center gap-3 text-sm">
              <span className="w-20 shrink-0">{row.device}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[var(--chart-1)]"
                  style={{ width: `${total === 0 ? 0 : (row.sessions / total) * 100}%` }}
                />
              </div>
              <span className="tabular w-8 shrink-0 text-right text-xs text-muted-foreground">
                {row.sessions}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

/**
 * Demand against intent, journey by journey.
 *
 * The gap between the two columns is the point. A card turned over many times
 * and opened rarely is a thumbnail doing its job in front of a page that is
 * not; a journey read all the way through with nobody asking is a page doing
 * its job in front of an offer that is not.
 */
function Journeys({ journeys }: { journeys: MemberAnalytics["journeys"] }) {
  if (journeys.length === 0) {
    return (
      <Section title="Journeys">
        <p className="text-sm text-muted-foreground">
          No journey has been looked at yet.
        </p>
      </Section>
    );
  }

  const chart = journeys.slice(0, 8).map((row) => ({
    name: row.title,
    Flipped: row.flipped,
    Opened: row.opened,
    Asked: row.asked,
  }));

  return (
    <Section title="Journeys">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              interval={0}
              tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <Tooltip content={<Tip />} cursor={{ fill: "var(--muted)" }} />
            <Bar dataKey="Flipped" fill="var(--chart-3)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Opened" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Asked" fill="var(--chart-5)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend
        items={[
          { label: "Turned over", colour: "var(--chart-3)" },
          { label: "Opened", colour: "var(--chart-1)" },
          { label: "Asked the Curator", colour: "var(--chart-5)" },
        ]}
      />

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <Th>Journey</Th>
              <Th right>Turned over</Th>
              <Th right>Opened</Th>
              <Th right>Read</Th>
              <Th right>Asked</Th>
              <Th right>Clients</Th>
              <Th right>Time in it</Th>
            </tr>
          </thead>
          <tbody>
            {journeys.map((row) => (
              <tr key={row.slug} className="border-b border-border last:border-0">
                <td className="py-2.5 pr-4 font-medium">{row.title}</td>
                <Td>{row.flipped}</Td>
                <Td>{row.opened}</Td>
                <Td>{row.read}</Td>
                <Td>
                  {row.asked > 0 ? (
                    <Badge className="tabular">{row.asked}</Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </Td>
                <Td>{row.clients}</Td>
                <td className="py-2.5 text-right text-muted-foreground">
                  {readingTime(row.seconds)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** Who to ring, in the order to ring them. */
function Warmest({
  clients,
  days,
}: {
  clients: MemberAnalytics["clients"];
  days: AnalyticsRange;
}) {
  if (clients.length === 0) {
    return (
      <Section title="Who has been reading">
        <p className="text-sm text-muted-foreground">
          No identified client has visited in the last {days} days.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Who has been reading">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <Th>Client</Th>
              <Th right>Visits</Th>
              <Th right>Opened</Th>
              <Th right>Asked</Th>
              <Th right>Time reading</Th>
              <Th right>Last seen</Th>
            </tr>
          </thead>
          <tbody>
            {clients.map((row) => (
              <tr key={row.customerId} className="border-b border-border last:border-0">
                <td className="py-2.5 pr-4">
                  <Link
                    href={`/clients/${row.customerId}`}
                    className="font-medium hover:underline"
                  >
                    {row.name || row.ref}
                  </Link>
                  <span className="tabular ml-2 text-xs text-muted-foreground">
                    {row.ref}
                  </span>
                </td>
                <Td>{row.visits}</Td>
                <Td>{row.opened}</Td>
                <Td>
                  {row.asked > 0 ? (
                    <Badge className="tabular">{row.asked}</Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </Td>
                <td className="py-2.5 text-right text-muted-foreground">
                  {readingTime(row.seconds)}
                </td>
                <td className="py-2.5 text-right text-muted-foreground">
                  {timeAgo(row.lastSeen)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`pb-2 text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase ${
        right ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="tabular py-2.5 text-right">{children}</td>;
}

function Legend({ items }: { items: { label: string; colour: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
      {items.map((item) => (
        <span
          key={item.label}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: item.colour }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

type TipPayload = { name?: string; value?: number | string; color?: string };

/** Recharts' own tooltip ignores the theme; this one uses the same tokens. */
function Tip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TipPayload[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-sm">
      {label ? <p className="mb-1 font-medium">{label}</p> : null}
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}</span>
          <span className="tabular ml-auto font-medium">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}
