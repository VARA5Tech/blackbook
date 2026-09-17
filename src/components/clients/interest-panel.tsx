"use client";

import { Clock, Eye, Film, Image as ImageIcon, PlayCircle, Sparkles } from "lucide-react";
import type { SessionReplay } from "@/lib/posthog";
import type { InterestSummaryRow } from "@/repositories/customer-repository";
import { Section } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, readingTime, timeAgo } from "@/lib/format";

/**
 * What the client has been reading on vara5.travel.
 *
 * The desk lives in Blackbook, so the summary is here rather than in an
 * analytics tool: one line per journey, strongest interest first, with the
 * Curator ask called out because that is the line worth ringing about. The
 * recordings stay in PostHog and are linked, never copied.
 */
export function InterestPanel({
  interest,
  replays,
}: {
  interest: InterestSummaryRow[];
  replays: SessionReplay[];
}) {
  if (interest.length === 0 && replays.length === 0) {
    return (
      <Section title="On vara5.travel">
        <p className="text-sm text-muted-foreground">
          Nothing yet. This fills in once the client signs in to the members&rsquo;
          site and opens a journey.
        </p>
      </Section>
    );
  }

  return (
    <Section title="On vara5.travel">
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

      {replays.length > 0 ? (
        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-xs tracking-[0.08em] text-muted-foreground uppercase">
            Recent visits
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {replays.map((replay) => (
              <li key={replay.sessionId}>
                <a
                  href={replay.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 hover:underline"
                >
                  <PlayCircle className="size-3.5 text-muted-foreground" />
                  <span>{formatDateTime(replay.startedAt)}</span>
                  <span className="text-muted-foreground">
                    ({readingTime(replay.seconds)})
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}
