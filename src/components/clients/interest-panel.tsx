"use client";

import {
  ArrowRight,
  Clock,
  Eye,
  Globe,
  Film,
  Image as ImageIcon,
  MousePointerClick,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import type { ClientSignals, SessionReplay } from "@/lib/posthog";
import type { InterestSummaryRow } from "@/repositories/customer-repository";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ReplayPlayer } from "@/components/clients/replay-player";
import { readingTime, timeAgo } from "@/lib/format";

/**
 * "Antarctica", "Antarctica and Courchevel", "Antarctica, Courchevel and two
 * more" — a list a person reads aloud, not a comma-separated dump.
 */
function Plain({ items }: { items: string[] }) {
  const shown = items.slice(0, 2);
  const rest = items.length - shown.length;
  const text =
    rest > 0
      ? `${shown.join(", ")} and ${rest} more`
      : shown.length === 2
        ? `${shown[0]} and ${shown[1]}`
        : shown[0];
  return <span className="font-medium">{text}</span>;
}

type Props = {
  customerId: string;
  interest: InterestSummaryRow[];
  replays: SessionReplay[];
  signals: ClientSignals | null;
};

/** What one client has done on the members' site, as the service returns it. */
export type ClientActivity = Omit<Props, "customerId">;

/**
 * What the client has been reading on vara5.com.
 *
 * The desk lives in Blackbook, so this is here rather than in an analytics
 * tool. It reads as one line on the record — the part somebody picking up the
 * phone needs — and opens in full on demand. Nothing is lost between the two:
 * the line is the headline, the dialog is the whole story.
 *
 * The recordings play inside Blackbook. Nobody at the desk has a PostHog login.
 */
export function InterestStrip({ customerId, interest, replays, signals }: Props) {
  const [open, setOpen] = useState(false);

  if (interest.length === 0 && replays.length === 0) return null;

  const taps = signals?.clicks.reduce((total, click) => total + click.count, 0) ?? 0;
  const seconds = interest.reduce((total, row) => total + row.seconds, 0);
  const lastSeen = interest[0]?.lastSeenAt ?? replays[0]?.startedAt ?? null;
  const asked = interest.find((row) => row.askedAt);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Globe className="size-4 text-muted-foreground" />
          On vara5.com
        </span>
        {lastSeen ? (
          <span className="text-xs text-muted-foreground">{timeAgo(lastSeen)}</span>
        ) : null}
      </div>

      <div className="flex gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1 space-y-1.5 text-sm">
          {interest.length > 0 ? (
            <p className="leading-snug">
              Opened <Plain items={interest.map((row) => row.title)} />
            </p>
          ) : null}

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {seconds > 0 ? (
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {readingTime(seconds)} reading
              </span>
            ) : null}
            {taps > 0 ? (
              <span className="flex items-center gap-1">
                <MousePointerClick className="size-3" />
                <span className="tabular">{taps}</span> {taps === 1 ? "tap" : "taps"}
              </span>
            ) : null}
          </p>

          {asked ? (
            <p className="flex items-center gap-1.5 text-xs text-foreground">
              <Sparkles className="size-3 shrink-0" />
              Asked the Curator
            </p>
          ) : null}
        </div>

        {replays.length > 0 ? (
          <div className="w-28 shrink-0">
            <ReplayPlayer customerId={customerId} replays={replays} tile />
          </div>
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            See everything
            <ArrowRight className="size-3" />
          </button>
        </DialogTrigger>

        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>On vara5.com</DialogTitle>
            <DialogDescription>
              Everything the members&rsquo; site has recorded for this client.
            </DialogDescription>
          </DialogHeader>

          {/*
            Rendered only while open, so a record with a long history does not
            pay for a dialog nobody opened, and the player measures a dialog
            that already has its width.
          */}
          {open ? (
            <InterestDetail
              customerId={customerId}
              interest={interest}
              replays={replays}
              signals={signals}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="tabular font-display text-2xl tracking-tight">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </p>
  );
}

export function InterestDetail({ customerId, interest, replays, signals }: Props) {
  // PostHog labels a flip with the journey's slug; Blackbook already holds the
  // title the client actually saw, so it reads "Mnemba Island", not
  // "mnemba-island". A journey never opened has no row, and falls back.
  const titleOf = new Map(interest.map((row) => [row.destination, row.title]));
  const pretty = (slug: string) =>
    titleOf.get(slug) ??
    slug.replace(/-/g, " ").replace(/[a-z]/g, (c) => c.toUpperCase());

  const taps = signals?.clicks.reduce((total, click) => total + click.count, 0) ?? 0;
  const seconds = interest.reduce((total, row) => total + row.seconds, 0);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-6 border-y border-border py-4 sm:grid-cols-4">
        <Stat
          value={String(interest.length)}
          label={interest.length === 1 ? "journey opened" : "journeys opened"}
        />
        <Stat value={readingTime(seconds)} label="spent reading" />
        <Stat value={String(taps)} label={taps === 1 ? "tap" : "taps"} />
        <Stat
          value={String(replays.length)}
          label={replays.length === 1 ? "visit recorded" : "visits recorded"}
        />
      </div>

      {interest.length > 0 ? (
        <div className="space-y-3">
          <Heading>Journeys</Heading>
          <ul className="divide-y divide-border">
            {interest.map((row) => (
              <li
                key={row.destination}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 py-3 first:pt-0"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.title}</span>
                    {row.askedAt ? (
                      <Badge className="gap-1">
                        <Sparkles className="size-3" />
                        Asked the Curator
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.askedAt
                      ? `Asked ${timeAgo(row.askedAt)} · last seen ${timeAgo(row.lastSeenAt)}`
                      : `Last seen ${timeAgo(row.lastSeenAt)}`}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Eye className="size-3.5" />
                    <span className="tabular">{row.opens}</span>
                    {row.opens === 1 ? "open" : "opens"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="size-3.5" />
                    {readingTime(row.seconds)}
                  </span>
                  {row.photos > 0 ? (
                    <span className="flex items-center gap-1.5">
                      <ImageIcon className="size-3.5" />
                      <span className="tabular">{row.photos}</span>
                    </span>
                  ) : null}
                  {row.videos > 0 ? (
                    <span className="flex items-center gap-1.5">
                      <Film className="size-3.5" />
                      <span className="tabular">{row.videos}</span>
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-8 sm:grid-cols-2">
        {signals && (signals.flips.length > 0 || signals.sections.length > 0) ? (
          <div className="space-y-3">
            <Heading>What caught their eye</Heading>
            {signals.flips.length > 0 ? (
              <p className="text-sm">
                Turned over{" "}
                <Plain items={signals.flips.map((flip) => pretty(flip.label))} />{" "}
                without opening {signals.flips.length === 1 ? "it" : "them"}.
              </p>
            ) : null}
            {signals.sections.length > 0 ? (
              <p className="text-sm">
                Read as far as{" "}
                <Plain
                  items={signals.sections.map((section) => section.label)}
                />
                .
              </p>
            ) : null}
          </div>
        ) : null}

        {signals && signals.clicks.length > 0 ? (
          <div className="space-y-3">
            <Heading>What they pressed</Heading>
            <ul className="space-y-1.5 text-sm">
              {signals.clicks.map((click) => (
                <li
                  key={click.label}
                  className="flex items-baseline justify-between gap-4"
                >
                  <span className="truncate">{click.label}</span>
                  <span className="tabular shrink-0 text-xs text-muted-foreground">
                    {click.count}
                    {click.count === 1 ? " time" : " times"}
                  </span>
                </li>
              ))}
            </ul>
            {signals.deadClicks > 0 ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <MousePointerClick className="mt-0.5 size-3.5 shrink-0" />
                Also tapped something that does not respond {signals.deadClicks}{" "}
                {signals.deadClicks === 1 ? "time" : "times"} — worth a look at
                the page.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <ReplayPlayer customerId={customerId} replays={replays} />
    </div>
  );
}
