"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, PlayCircle, X } from "lucide-react";
import { openReplayAction } from "@/actions/client-actions";
import type { SessionReplay } from "@/lib/posthog";
import { Button } from "@/components/ui/button";
import { formatDateTime, readingTime } from "@/lib/format";

/**
 * A client's visit, played in PostHog's own player without leaving Blackbook.
 *
 * Blackbook used to rebuild the recording itself with rrweb. It worked, but it
 * was a second player that never quite matched the first — the same session
 * looked different in the two — and PostHog's heatmap was not there at all. So
 * this embeds PostHog's player instead, which is the one being compared
 * against, and gets the heatmap for nothing.
 *
 * The trade is a share token, which is a public URL for as long as it exists.
 * One is minted only when somebody presses play, and revoked the moment the
 * player closes: on the close button, on navigating away, and best effort when
 * the tab is shut. Nobody here needs a PostHog login and the API key still
 * never leaves the server.
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
  const [share, setShare] = useState<{ embedUrl: string; sharedUrl: string } | null>(
    null,
  );
  const [state, setState] = useState<"loading" | "playing" | "empty">("loading");

  /*
   * `fetch` with `keepalive` rather than a server action, because this has to
   * survive the page being torn down: an action cancelled halfway leaves the
   * public link standing, which is the one outcome worth avoiding.
   */
  const revoke = useCallback((sessionId: string) => {
    try {
      navigator.sendBeacon(
        "/api/replay/close",
        new Blob([JSON.stringify({ sessionId })], { type: "application/json" }),
      );
    } catch {
      void fetch("/api/replay/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
        keepalive: true,
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sessionId = replay.sessionId;

    (async () => {
      const result = await openReplayAction(customerId, sessionId);
      if (cancelled) {
        // Opened and abandoned before the answer arrived: take it back.
        if (result.ok && result.data) revoke(sessionId);
        return;
      }

      if (!result.ok || !result.data) {
        setState("empty");
        return;
      }

      setShare(result.data);
      setState("playing");
    })();

    const onHide = () => revoke(sessionId);
    window.addEventListener("pagehide", onHide);

    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", onHide);
      revoke(sessionId);
    };
  }, [customerId, replay.sessionId, revoke]);

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

        <div className="flex items-center gap-1">
          {share ? (
            <Button variant="ghost" size="sm" asChild>
              <a href={share.sharedUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                Heatmap
              </a>
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X className="size-4" />
            <span className="sr-only">Close the recording</span>
          </Button>
        </div>
      </div>

      {state === "loading" ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Opening the recording…
        </p>
      ) : null}

      {state === "empty" ? (
        <p className="py-8 text-sm text-muted-foreground">
          This recording is no longer available. Recordings are kept for a
          limited time and then deleted.
        </p>
      ) : null}

      {share ? (
        <iframe
          src={share.embedUrl}
          title={`Visit on ${formatDateTime(replay.startedAt)}`}
          allowFullScreen
          className="aspect-video w-full rounded border border-border bg-background"
        />
      ) : null}

      {state === "playing" ? (
        <p className="text-xs text-muted-foreground">
          Played by PostHog. The link closes when you close this.
        </p>
      ) : null}
    </div>
  );
}
