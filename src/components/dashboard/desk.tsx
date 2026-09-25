"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Section } from "@/components/page-header";
import { displayName } from "@/domain/customers";
import { formatDate, timeAgo } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* What the desk owes somebody                                         */
/* ------------------------------------------------------------------ */

export type WaitingClient = {
  id: string;
  customerId: string;
  ref: string;
  firstName: string;
  lastName: string | null;
  preferredName: string | null;
  curatorName: string | null;
  title: string;
  status: string;
  dueAt: Date | string;
  escalationLevel: number;
  createdAt: Date | string;
};

/**
 * The one panel that is a list of work rather than a report.
 *
 * Every mature CRM leads its dashboard with what the reader has to do: Espo
 * opens on Activities and Tasks, Krayin on open leads. This screen led on four
 * counters instead, which say how things are without saying what to do about
 * them.
 *
 * A client is here because they asked for something and the lead is still open.
 * Leads nobody owns come first whatever their age: they are the ones that will
 * still be sitting here tomorrow unless a manager acts.
 */
export function NeedsYou({ waiting }: { waiting: WaitingClient[] }) {
  if (waiting.length === 0) {
    return (
      <Section title="Needs you">
        <div className="rounded-lg border border-border px-4 py-8 text-center">
          <p className="text-sm font-medium">Nothing outstanding</p>
          <p className="mt-1 text-sm text-muted-foreground">
            A client who texts the Curator appears here until somebody answers
            them, and is chased automatically if nobody does.
          </p>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Needs you">
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {waiting.map((client) => (
          <li key={client.id}>
            <Link
              href={`/clients/${client.customerId}`}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <Sparkles
                className="mt-0.5 size-4 shrink-0"
                style={{ color: "var(--chart-1)" }}
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {displayName(client)}
                  <span className="tabular ml-2 text-xs font-normal text-muted-foreground">
                    {client.ref}
                  </span>
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  Texted the Curator about{" "}
                  <span className="text-foreground">{client.title}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {timeAgo(client.createdAt)}
                  {client.status === "new"
                    ? " · answer by " + formatDate(client.dueAt)
                    : " · " + client.status}
                  {client.curatorName
                    ? " · " + client.curatorName
                    : " · nobody assigned"}
                  {/* Chased already, and still sitting here. */}
                  {client.escalationLevel > 0 ? " · overdue" : ""}
                </p>
              </div>

              <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* The funnel, as a shape rather than four numbers                     */
/* ------------------------------------------------------------------ */

type Stage = { key: string; label: string; value: number; of: string };

function StageTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Stage }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">{row.label}</p>
      <p className="tabular text-muted-foreground">
        {row.value} {row.of}
      </p>
    </div>
  );
}

/**
 * Browsing, opened, read, asked: the closest thing Blackbook has to the sales
 * pipeline every one of the CRMs I read leads its dashboard with.
 *
 * One falling bar per stage, so the drop between stages is what the eye lands
 * on. Four separate counters hid it, and the drop is the whole story: the
 * interesting fact is not that fourteen journeys were opened, it is that
 * fourteen became one.
 */
export function Pipeline({
  funnel,
}: {
  funnel: { clients: number; opened: number; read: number; asked: number };
}) {
  const stages: Stage[] = [
    { key: "clients", label: "Browsing", value: funnel.clients, of: "clients" },
    { key: "opened", label: "Opened", value: funnel.opened, of: "journeys" },
    { key: "read", label: "Read through", value: funnel.read, of: "journeys" },
    { key: "asked", label: "Asked", value: funnel.asked, of: "asks" },
  ];

  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={stages}
          margin={{ top: 20, right: 8, bottom: 0, left: -20 }}
        >
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
          <Tooltip content={<StageTip />} cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]}>
            {/* The last stage is the one that pays, so it is the one in ink. */}
            {stages.map((stage, index) => (
              <Cell
                key={stage.key}
                fill={
                  index === stages.length - 1
                    ? "var(--chart-1)"
                    : "var(--chart-3)"
                }
                fillOpacity={index === stages.length - 1 ? 1 : 0.45}
              />
            ))}
            <LabelList
              dataKey="value"
              position="top"
              fill="var(--foreground)"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Is it going up                                                      */
/* ------------------------------------------------------------------ */

/**
 * Visits and the number of clients behind them, day by day.
 *
 * A total on its own cannot answer "is this working", which is the question
 * the founders actually ask. Two series rather than one, because thirty visits
 * from three clients and thirty from thirty are different weeks.
 */
export function Pulse({
  daily,
}: {
  daily: { day: string; visits: number; clients: number }[];
}) {
  const data = daily.map((row) => ({
    ...row,
    label: formatDate(row.day).slice(0, 5),
  }));

  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          /*
            Room on the right for the last date label. At eight pixels the
            final tick ran off the edge of the card and read as half a date.
          */
          margin={{ top: 8, right: 20, bottom: 0, left: -20 }}
        >
          <defs>
            <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "0.375rem",
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="visits"
            name="Visits"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#pulseFill)"
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
  );
}
