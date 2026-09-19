"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MousePointerClick } from "lucide-react";
import { clientActivityAction } from "@/actions/client-actions";
import { InterestDetail, type ClientActivity } from "@/components/clients/interest-panel";
import { ReplayPlayer } from "@/components/clients/replay-player";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { readingTime, timeAgo } from "@/lib/format";

export type Visit = {
  sessionId: string;
  customerId: string;
  startedAt: string;
  seconds: number;
  clicks: number;
  name: string;
  ref: string;
  archived: boolean;
};

/**
 * Who has been on the members' site lately, newest first.
 *
 * The desk reads this the way PostHog's own list reads: a name, how long ago,
 * how long they stayed. Opening one shows that client's whole picture and plays
 * the visit, so nobody has to go and find the record first.
 */
export function RecentVisits({ visits }: { visits: Visit[] }) {
  const [open, setOpen] = useState<Visit | null>(null);

  if (visits.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No client has been through the members&rsquo; gate yet. Visits appear
        here as they happen.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {visits.map((visit) => (
          <li key={visit.sessionId}>
            <button
              type="button"
              onClick={() => setOpen(visit)}
              className="-mx-2 flex w-full items-baseline justify-between gap-4 rounded px-2 py-2.5 text-left transition-colors hover:bg-accent/40"
            >
              <span className="min-w-0">
                <span className="font-medium">{visit.name}</span>
                <span className="tabular ml-2 text-xs text-muted-foreground">
                  {visit.ref}
                </span>
                {visit.archived ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    archived
                  </span>
                ) : null}
              </span>

              <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                {visit.clicks > 0 ? (
                  <span className="flex items-center gap-1">
                    <MousePointerClick className="size-3" />
                    <span className="tabular">{visit.clicks}</span>
                  </span>
                ) : null}
                <span>{readingTime(visit.seconds)}</span>
                <span className="tabular">{timeAgo(visit.startedAt)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <VisitDialog visit={open} onClose={() => setOpen(null)} />
    </>
  );
}

function VisitDialog({
  visit,
  onClose,
}: {
  visit: Visit | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={visit !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        {/*
          Keyed on the client, so opening a different row mounts a fresh body
          rather than showing the previous client's activity while the next
          one loads.
        */}
        {visit ? <VisitBody key={visit.customerId} visit={visit} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Loaded when the dialog opens rather than with the list.
 *
 * Twelve rows would otherwise mean twelve clients' histories fetched to draw
 * twelve names, and PostHog charges a query for each.
 */
function VisitBody({ visit }: { visit: Visit }) {
  const [activity, setActivity] = useState<ClientActivity | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void clientActivityAction(visit.customerId).then((result) => {
      if (cancelled) return;
      if (result.ok) setActivity(result.data);
      else setFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [visit.customerId]);

  const thisVisit = activity?.replays.find(
    (replay) => replay.sessionId === visit.sessionId,
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {visit.name}
          <span className="tabular ml-2 text-sm font-normal text-muted-foreground">
            {visit.ref}
          </span>
        </DialogTitle>
        <DialogDescription>
          Visited {timeAgo(visit.startedAt)} for {readingTime(visit.seconds)}.
        </DialogDescription>
      </DialogHeader>

      {/* The recording first: it is what the row was clicked for. */}
      {thisVisit ? (
        <ReplayPlayer customerId={visit.customerId} replays={[thisVisit]} compact />
      ) : null}

      {activity ? (
        <div className="mt-6">
          <InterestDetail
            customerId={visit.customerId}
            interest={activity.interest}
            replays={activity.replays}
            signals={activity.signals}
          />
        </div>
      ) : failed ? (
        <p className="py-8 text-sm text-muted-foreground">
          Could not load this client&rsquo;s activity.
        </p>
      ) : (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading their activity…
        </p>
      )}

      <div className="mt-6 border-t border-border pt-4">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/clients/${visit.customerId}`}>Open the full record</Link>
        </Button>
      </div>
    </>
  );
}
