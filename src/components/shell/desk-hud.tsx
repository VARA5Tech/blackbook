"use client";

import {
  AlertTriangle,
  CalendarHeart,
  CheckCircle2,
  ListChecks,
  Sparkles,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { DeskSignal } from "@/services/lead-service";
import { cn } from "@/lib/utils";

export type DeskStatus = {
  wholeDesk: boolean;
  signals: DeskSignal[];
  waiting: number;
  overdue: number;
  unassigned: number;
  working: number;
  dueToday: number;
  lateTasks: number;
  milestones: number;
};

/** How many rows fit in the column before the rest becomes a number. */
const SHOWN = 5;

/**
 * What is outstanding, on every screen, all the time.
 *
 * Not a notification: there is nothing to dismiss, nothing to mark as read and
 * no way to turn it off. It is a readout of the desk's own state, so it empties
 * when the work is done and not when somebody has had enough of looking at it.
 * A count that can be cleared away is a count that gets cleared away.
 *
 * Everything in it is ranked by how late it is rather than by what kind of
 * record it is. A birthday this afternoon and a lead nobody has answered are
 * the same question — what have we not dealt with — and sorting them into
 * headed lists buries whichever one is actually on fire.
 */
export function DeskHud({ status }: { status: DeskStatus }) {
  const shown = status.signals.slice(0, SHOWN);
  const rest = status.signals.length - shown.length;

  const late = status.signals.filter((signal) => signal.tone === "late").length;
  const clear = status.signals.length === 0;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        // The border carries the alarm. No red wash and no animation: the
        // panel is read fifty times a day and has to stay readable.
        late > 0 ? "border-[color:var(--polarity-avoid)]/60" : "border-border",
      )}
      aria-label="The desk"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted px-2.5 py-1.5">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          The desk
        </span>
        {late > 0 ? (
          <span className="tabular flex items-center gap-1 text-[11px] font-medium text-[color:var(--polarity-avoid)]">
            <AlertTriangle className="size-3" />
            {late} late
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {status.wholeDesk ? "whole desk" : "yours"}
          </span>
        )}
      </div>

      {clear ? (
        <p className="flex items-center gap-2 px-2.5 py-2.5 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5 shrink-0" />
          Nothing outstanding
        </p>
      ) : (
        <ul className="max-h-[min(40vh,22rem)] divide-y divide-border overflow-y-auto">
          {shown.map((signal) => (
            <Row key={signal.id} signal={signal} />
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/50 px-2.5 py-1 text-[11px]">
        <span className="tabular text-muted-foreground">
          {rest > 0
            ? `${rest} more`
            : `${status.signals.length} ${status.signals.length === 1 ? "thing" : "things"}`}
        </span>
        <Link
          href="/"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Open the desk
        </Link>
      </div>
    </section>
  );
}

const ICONS = {
  lead: Sparkles,
  task: ListChecks,
  milestone: CalendarHeart,
} as const;

function Row({ signal }: { signal: DeskSignal }) {
  const Icon = signal.unowned ? UserPlus : ICONS[signal.kind];

  return (
    <li>
      <Link
        href={signal.href}
        className="block px-2.5 py-2 transition-colors hover:bg-muted/60"
      >
        <div className="flex items-start gap-1.5">
          <Icon
            className={cn(
              "mt-0.5 size-3 shrink-0",
              signal.tone === "late"
                ? "text-[color:var(--polarity-avoid)]"
                : "text-muted-foreground",
            )}
          />
          <p className="min-w-0 flex-1 truncate text-xs font-medium">{signal.title}</p>
          <Countdown signal={signal} />
        </div>

        <p className="mt-0.5 ml-[1.125rem] truncate text-[11px] text-muted-foreground">
          {signal.who ?? "No client"}
          {signal.note ? ` · ${signal.note}` : ""}
        </p>

        {/*
          The work hanging off a lead, under the lead. One lead with three
          follow-ups is one thing to answer, and listing them as three rows
          makes a quiet desk look like a busy one.
        */}
        {signal.tasks.length > 0 ? (
          <ul className="mt-1 ml-[1.125rem] space-y-0.5 border-l border-border pl-1.5">
            {signal.tasks.slice(0, 2).map((task) => (
              <li
                key={task.id}
                className="truncate text-[11px] text-muted-foreground/80"
              >
                {task.title}
              </li>
            ))}
            {signal.tasks.length > 2 ? (
              <li className="tabular text-[11px] text-muted-foreground/60">
                +{signal.tasks.length - 2} more
              </li>
            ) : null}
          </ul>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * How long is left, counted down rather than stated.
 *
 * "Due 23-09-26, 5:29 am" asks the reader to do arithmetic; "2 hr left" does
 * not, and the difference decides whether somebody acts this morning. It
 * re-reads the clock every half minute, so a panel left open on a screen all
 * day stays true — and it renders nothing until it has mounted, because a
 * countdown computed on the server is wrong by the time it is read.
 */
function Countdown({ signal }: { signal: DeskSignal }) {
  const now = useNow();

  if (now === 0) {
    return <span className="tabular shrink-0 text-[11px] text-muted-foreground">·</span>;
  }

  const text = signal.dueAt
    ? remaining(Date.parse(signal.dueAt) - now)
    : signal.dueDate
      ? daysLeft(signal.dueDate, now)
      : "";

  return (
    <span
      className={cn(
        "tabular shrink-0 text-[11px] font-medium",
        signal.tone === "late"
          ? "text-[color:var(--polarity-avoid)]"
          : signal.tone === "now"
            ? "text-foreground"
            : "text-muted-foreground",
      )}
    >
      {text}
    </span>
  );
}

/**
 * The clock every countdown in the panel reads.
 *
 * One interval shared by every row rather than one each, and an external store
 * rather than state set from an effect: the time of day is not React's to own,
 * and copying it into state on mount is the pattern that makes a panel of six
 * rows schedule six timers. The server snapshot is zero, so the first paint
 * carries no countdown at all — a duration rendered on the server is already
 * wrong when it arrives.
 */
const clockListeners = new Set<() => void>();
let clock = 0;
let clockTimer: ReturnType<typeof setInterval> | undefined;

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);

  clockTimer ??= setInterval(() => {
    clock = Date.now();
    for (const each of clockListeners) each();
  }, 30_000);

  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

function clockSnapshot(): number {
  clock ||= Date.now();
  return clock;
}

function useNow(): number {
  return useSyncExternalStore(subscribeClock, clockSnapshot, () => 0);
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2 hr left", "18 min left", "3 days late". */
function remaining(millis: number): string {
  const late = millis < 0;
  const size = Math.abs(millis);
  const suffix = late ? "late" : "left";

  if (size < MINUTE) return late ? "just now" : "now";
  if (size < HOUR) return `${Math.round(size / MINUTE)} min ${suffix}`;
  if (size < DAY) return `${Math.round(size / HOUR)} hr ${suffix}`;

  const days = Math.round(size / DAY);
  return `${days} ${days === 1 ? "day" : "days"} ${suffix}`;
}

/**
 * A date has no time of day, so it is counted in whole days from today.
 *
 * Indian Standard Time, like every other date on screen: a birthday counted
 * against a browser in another zone is a birthday that moves by a day.
 */
function daysLeft(iso: string, now: number): string {
  const today = new Date(now).toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  const days = Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY,
  );

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 0) {
    const late = Math.abs(days);
    return `${late} ${late === 1 ? "day" : "days"} late`;
  }
  return `${days} days left`;
}
