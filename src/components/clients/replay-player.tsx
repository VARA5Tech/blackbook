"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, PlayCircle, X } from "lucide-react";
import { loadReplayAction } from "@/actions/client-actions";
import type { SessionReplay } from "@/lib/posthog";
import { Button } from "@/components/ui/button";
import { formatDateTime, readingTime } from "@/lib/format";

/** What the compiled player exposes; see the note in the effect below. */
type RRwebPlayer = { $destroy: () => void };

/**
 * A client's visit, played inside Blackbook.
 *
 * Staff have no PostHog login and should not need one: the recording is
 * fetched through the service layer, which asserts `client.read` and refuses a
 * session belonging to anyone but this client. No share link is ever minted,
 * so a copied URL grants nothing.
 *
 * The player is a quarter of a megabyte of JavaScript and most visits to a
 * client's page never watch a recording, so it is imported on the click rather
 * than with the page.
 */
export function ReplayPlayer({
  customerId,
  replays,
  compact = false,
}: {
  customerId: string;
  replays: SessionReplay[];
  /** One button for the latest visit, for the strip at the top of a record. */
  compact?: boolean;
}) {
  const [watching, setWatching] = useState<SessionReplay | null>(null);

  if (replays.length === 0) return null;

  if (compact) {
    const latest = replays[0];
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          onClick={() => setWatching(watching ? null : latest)}
        >
          <PlayCircle className="size-3.5" />
          {watching ? "Hide visit" : "Watch last visit"}
        </Button>

        {watching ? (
          <div className="w-full">
            <Stage
              customerId={customerId}
              replay={watching}
              onClose={() => setWatching(null)}
            />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <p className="text-xs tracking-[0.08em] text-muted-foreground uppercase">
        Recent visits
      </p>

      <ul className="flex flex-wrap gap-2">
        {replays.map((replay) => (
          <li key={replay.sessionId}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setWatching(replay)}
            >
              <PlayCircle className="size-3.5" />
              <span>{formatDateTime(replay.startedAt)}</span>
              <span className="text-muted-foreground">
                {readingTime(replay.seconds)}
              </span>
            </Button>
          </li>
        ))}
      </ul>

      {watching ? (
        <Stage
          customerId={customerId}
          replay={watching}
          onClose={() => setWatching(null)}
        />
      ) : null}
    </div>
  );
}

function Stage({
  customerId,
  replay,
  onClose,
}: {
  customerId: string;
  replay: SessionReplay;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "playing" | "empty">("loading");

  useEffect(() => {
    let cancelled = false;
    /*
     * rrweb-player is a compiled Svelte 4 component. Svelte itself is bundled
     * into it, but the published types still import from `svelte`, which is not
     * a dependency here — so the exported class types as having no members and
     * `$destroy` is invisible to TypeScript. It is present at runtime, and
     * installing Svelte purely to describe it would add a package the build
     * never uses.
     */
    let player: RRwebPlayer | null = null;

    (async () => {
      const result = await loadReplayAction(customerId, replay.sessionId);
      if (cancelled) return;

      const events = result.ok ? result.data : [];
      // Two events is rrweb's own minimum; below that there is nothing to show.
      if (!host.current || events.length < 2) {
        setState("empty");
        return;
      }

      const { default: Player } = (await import("rrweb-player")) as unknown as {
        default: new (options: {
          target: HTMLElement;
          props: Record<string, unknown>;
        }) => RRwebPlayer;
      };
      await import("rrweb-player/dist/style.css");
      if (cancelled || !host.current) return;

      const width = host.current.clientWidth || 720;
      player = new Player({
        target: host.current,
        props: {
          events,
          width,
          height: Math.round((width * 9) / 16),
          autoPlay: true,
          // The pauses are already squeezed out server-side, so rrweb's own
          // idle skipping has nothing left to find and would only introduce
          // speed changes mid-visit.
          skipInactive: false,
          showController: true,
        },
      });
      setState("playing");
    })();

    return () => {
      cancelled = true;
      player?.$destroy();
    };
  }, [customerId, replay.sessionId]);

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm">
          <span className="font-medium">{formatDateTime(replay.startedAt)}</span>
          <span className="text-muted-foreground">
            {" · "}
            {readingTime(replay.seconds)}
            {replay.clicks > 0 ? ` · ${replay.clicks} clicks` : ""}
          </span>
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X className="size-4" />
          <span className="sr-only">Close the recording</span>
        </Button>
      </div>

      {state === "playing" ? (
        <p className="text-xs text-muted-foreground">
          Long pauses are removed, so the recording plays shorter than the visit
          lasted.
        </p>
      ) : null}

      {state === "loading" ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Fetching the recording…
        </p>
      ) : null}

      {state === "empty" ? (
        <p className="py-8 text-sm text-muted-foreground">
          This recording is no longer available. Recordings are kept for a
          limited time and then deleted.
        </p>
      ) : null}

      {/* rrweb writes its own markup here; React must not manage the children. */}
      <div ref={host} className="overflow-x-auto" />
    </div>
  );
}
