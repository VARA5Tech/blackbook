import "server-only";
import { gunzipSync } from "node:zlib";
import { logger } from "@/lib/logger";

/**
 * Reading from PostHog.
 *
 * Blackbook sends nothing to PostHog: vara5.travel does that, and reports the
 * parts the desk needs straight into `client_interest` so the Interest panel
 * works whether or not this is configured. What is left here is the deep end —
 * the session replay of a client's visit — which lives in PostHog and is linked
 * to, never copied.
 *
 * The key is a personal API key with read scopes. It can read the whole
 * project, so it is an operator credential: server-side only, never
 * `NEXT_PUBLIC_`, never handed to the browser. Only this file holds it, and
 * only `src/services/client-service.ts` calls in.
 *
 * Everything fails soft. PostHog being slow, rate limited or unconfigured must
 * never break a client's record, so a failure is logged and read as "no
 * replays".
 */

const QUERY_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
/** PostHog allows 240 project queries a minute; a screen refresh must not race that. */
const MAX_REPLAYS = 10;
/** A recording is bigger than a query answer and worth waiting a little longer for. */
const REPLAY_TIMEOUT_MS = 20_000;
/** Roughly an hour of browsing. Beyond that the browser, not the network, is the limit. */
const MAX_REPLAY_BYTES = 8 * 1024 * 1024;

/** Private endpoints live on the app host, not the `.i.` ingestion host. */
function apiHost(): string {
  const host = process.env.POSTHOG_API_HOST?.trim() || "https://us.posthog.com";
  return host.replace(/\/+$/, "");
}

function credentials(): { projectId: string; key: string } | null {
  const projectId = process.env.POSTHOG_PROJECT_ID?.trim() ?? "";
  const key = process.env.POSTHOG_API_KEY?.trim() ?? "";
  if (!/^\d+$/.test(projectId) || key.length < 20) return null;
  return { projectId, key };
}

export function posthogIsConfigured(): boolean {
  return credentials() !== null;
}

/** Where a curator lands when they open a replay. */
export function replayUrl(sessionId: string): string | null {
  const configured = credentials();
  if (!configured) return null;
  return `${apiHost()}/project/${configured.projectId}/replay/${encodeURIComponent(sessionId)}`;
}

type CacheEntry = { at: number; rows: unknown[][] };
const cache = new Map<string, CacheEntry>();

/**
 * The website identifies a guest to PostHog by their Blackbook id, so a
 * distinct id is a UUID and nothing else. Checked rather than escaped: a value
 * that is not a UUID never reaches the query at all.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs one HogQL query and hands back its rows.
 *
 * Nothing interpolates into `query` except values this file has already proved
 * safe; HogQL has no parameter binding we can rely on across versions, so the
 * rule is a validated literal or nothing. See `sessionReplays`.
 */
async function runQuery(name: string, query: string): Promise<unknown[][] | null> {
  const configured = credentials();
  if (!configured) return null;

  const cached = cache.get(query);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

  try {
    const response = await fetch(`${apiHost()}/api/projects/${configured.projectId}/query/`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${configured.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query }, name }),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      // The body can quote the query, which names a client's id. Status only.
      logger.warn("posthog.query_refused", { name, status: response.status });
      return null;
    }

    const payload = (await response.json()) as { results?: unknown[][] };
    const rows = Array.isArray(payload.results) ? payload.results : [];
    cache.set(query, { at: Date.now(), rows });
    // The cache is per server instance and tiny; this keeps it that way.
    if (cache.size > 200) for (const key of cache.keys()) { cache.delete(key); break; }
    return rows;
  } catch (error) {
    logger.warn("posthog.query_failed", { name, reason: (error as Error).name });
    return null;
  }
}

export type SessionReplay = {
  sessionId: string;
  startedAt: Date;
  seconds: number;
  clicks: number;
  url: string;
};

/**
 * A client's recent visits to vara5.travel, newest first.
 *
 * The website identifies a guest to PostHog by their Blackbook id, so the
 * distinct id is a UUID and nothing else. That is checked rather than escaped:
 * a value that is not a UUID never reaches the query at all.
 */
export async function sessionReplays(customerId: string): Promise<SessionReplay[]> {
  if (!UUID.test(customerId)) return [];

  const rows = await runQuery(
    "blackbook_client_replays",
    `select session_id,
            min(min_first_timestamp) as started_at,
            dateDiff('second', min(min_first_timestamp), max(max_last_timestamp)) as seconds,
            sum(click_count) as clicks
     from raw_session_replay_events
     where distinct_id = '${customerId}'
       and min_first_timestamp > now() - interval 180 day
     group by session_id
     order by started_at desc
     limit ${MAX_REPLAYS}`,
  );
  if (!rows) return [];

  return rows.flatMap((row) => {
    const [sessionId, startedAt, seconds, clicks] = row as [string, string, number, number];
    const url = replayUrl(sessionId);
    if (!sessionId || !url) return [];
    const started = new Date(startedAt);
    if (Number.isNaN(started.getTime())) return [];
    return [
      {
        sessionId,
        startedAt: started,
        seconds: Math.max(0, Math.round(Number(seconds) || 0)),
        clicks: Math.max(0, Math.round(Number(clicks) || 0)),
        url,
      },
    ];
  });
}

/**
 * The signals PostHog holds that Postgres does not.
 *
 * The website reports five things to Blackbook because they are the five a
 * curator acts on. PostHog sees more: every card turned over, every section
 * scrolled into view, every button pressed by its label. Those never justified
 * a column each, but they answer "what caught their eye" on the client's page,
 * so they are read live rather than copied.
 */
export type ClientSignals = {
  /** Cards turned over, by journey. Reading without opening anything. */
  flips: Array<{ label: string; count: number }>;
  /** Which parts of a journey were actually scrolled to. */
  sections: Array<{ label: string; count: number }>;
  /** Buttons and links pressed, by the words on them. */
  clicks: Array<{ label: string; count: number }>;
  /** Taps on something that does not respond. A design problem, told plainly. */
  deadClicks: number;
};

const EMPTY_SIGNALS: ClientSignals = { flips: [], sections: [], clicks: [], deadClicks: 0 };

/** The four blocks of a journey, named the way the page names them. */
const SECTIONS: Record<string, string> = {
  stay: "Stay",
  dine: "Dine",
  experience: "Experience",
  take: "The VARA5 Take",
};

/**
 * Whether a captured label is a control someone pressed.
 *
 * Autocapture reports the text of whatever was clicked, which includes the
 * close glyph and, when a tap lands on a paragraph, the paragraph. Neither
 * tells a curator anything, and the second fills the panel with body copy.
 */
function isButtonish(text: string): boolean {
  if (text.length < 2 || text.length > 40) return false;
  if (/^(close|dismiss|back|next|previous)$/i.test(text)) return false;
  // An icon font renders its ligature name as text, so a lone lower-case word
  // of underscores is "volume_up", not anything a person read.
  if (/^[a-z]+(_[a-z]+)+$/.test(text)) return false;
  // Something with no letters is a glyph: an arrow, a cross.
  return /\p{L}/u.test(text);
}

/**
 * One query, folded here rather than four round trips.
 *
 * The label is chosen per event, not coalesced: `section_viewed` carries both
 * `section` and `destination`, so taking the first non-null would report which
 * journey was read rather than how far into it, and the panel would say "read
 * as far as Antarctica" instead of "as far as Stay and Dine".
 */
export async function clientSignals(customerId: string): Promise<ClientSignals> {
  if (!UUID.test(customerId)) return EMPTY_SIGNALS;

  const rows = await runQuery(
    "blackbook_client_signals",
    `select event,
            case event
              when 'section_viewed' then properties.section
              when 'journey_card_flipped' then properties.destination
              else properties.$el_text
            end as label,
            count() as n
     from events
     where distinct_id = '${customerId}'
       and timestamp > now() - interval 90 day
       and event in ('journey_card_flipped', 'section_viewed', '$autocapture', '$dead_click')
     group by event, label
     having n > 0
     order by n desc
     limit 60`,
  );
  if (!rows) return EMPTY_SIGNALS;

  const signals: ClientSignals = { flips: [], sections: [], clicks: [], deadClicks: 0 };

  for (const row of rows) {
    const [event, label, count] = row as [string, string, number];
    const n = Math.max(0, Math.round(Number(count) || 0));
    if (n === 0) continue;

    if (event === "$dead_click") {
      signals.deadClicks += n;
      continue;
    }
    // A label is the whole point of these rows; an unlabelled one says nothing.
    const text = String(label ?? "").trim();
    if (!text) continue;

    if (event === "journey_card_flipped") signals.flips.push({ label: text, count: n });
    else if (event === "section_viewed") signals.sections.push({ label: SECTIONS[text] ?? text, count: n });
    else if (isButtonish(text)) signals.clicks.push({ label: text, count: n });
  }

  return signals;
}

/** One rrweb event, as the player consumes it. */
export type ReplayEvent = { type: number; timestamp: number; data: unknown };

/**
 * Unpacks a snapshot PostHog stored compressed.
 *
 * The large events — the full snapshot of the page — arrive gzipped and
 * carried as a string, while the small incremental ones stay plain JSON. rrweb
 * accepts both without complaint and renders a blank white frame for the
 * compressed one, no error anywhere, so this has to happen before the events
 * reach the player.
 *
 * The bytes survive the JSON as code points below 256, which is why each
 * character maps back to one byte.
 */
function unpack(event: ReplayEvent): ReplayEvent | null {
  if (typeof event.data !== "string") return event;
  try {
    const packed = Uint8Array.from(event.data, (char) => char.charCodeAt(0) & 0xff);
    if (packed[0] !== 0x1f || packed[1] !== 0x8b) return null;
    return { ...event, data: JSON.parse(gunzipSync(packed).toString("utf8")) };
  } catch {
    // A snapshot that will not unpack cannot be drawn; dropping it is better
    // than handing the player something it renders as an empty page.
    return null;
  }
}

/**
 * The recording itself, so it can be watched inside Blackbook.
 *
 * Two things make this safe to expose to a staff screen. The recording's own
 * `distinct_id` is checked against the client being viewed, so a session id
 * guessed or copied from elsewhere returns nothing rather than another
 * client's visit. And the personal API key never leaves this file: the browser
 * receives rrweb events, not a PostHog credential and not a share link.
 *
 * A quarter of a megabyte covers a fifteen-minute session, so the whole thing
 * is fetched in one range request rather than blob by blob.
 */
export async function replayEvents(
  customerId: string,
  sessionId: string,
): Promise<ReplayEvent[]> {
  const configured = credentials();
  if (!configured || !UUID.test(customerId) || !UUID.test(sessionId)) return [];

  const base = `${apiHost()}/api/projects/${configured.projectId}/session_recordings/${sessionId}`;
  const headers = { Authorization: `Bearer ${configured.key}` };

  try {
    const meta = await fetch(base, {
      headers,
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    if (!meta.ok) {
      logger.warn("posthog.replay_refused", { status: meta.status });
      return [];
    }

    // The check that matters: this recording must belong to this client.
    const recording = (await meta.json()) as { distinct_id?: string };
    if (recording.distinct_id !== customerId) {
      logger.warn("posthog.replay_not_theirs", { customerId });
      return [];
    }

    const listed = await fetch(`${base}/snapshots`, {
      headers,
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    if (!listed.ok) return [];

    const sources = ((await listed.json()) as { sources?: Array<{ source: string; blob_key: string }> })
      .sources?.filter((source) => source.source === "blob_v2") ?? [];
    if (sources.length === 0) return [];

    // Both ends are required; asking for one key answers 400.
    const first = sources[0].blob_key;
    const last = sources[sources.length - 1].blob_key;
    const blob = await fetch(
      `${base}/snapshots?source=blob_v2&start_blob_key=${first}&end_blob_key=${last}`,
      { headers, signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS) },
    );
    if (!blob.ok) return [];

    const body = await blob.text();
    if (body.length > MAX_REPLAY_BYTES) {
      logger.warn("posthog.replay_too_large", { bytes: body.length });
      return [];
    }

    const events: ReplayEvent[] = [];
    for (const line of body.split("\n")) {
      if (!line.trim()) continue;
      try {
        // Each line is [windowId, event]; handing the pair to the player
        // renders a blank screen with no error.
        const [, event] = JSON.parse(line) as [string, ReplayEvent];
        if (!event || typeof event.type !== "number") continue;
        const usable = unpack(event);
        if (usable) events.push(usable);
      } catch {
        // One malformed line should not lose the recording.
      }
    }
    return events;
  } catch (error) {
    logger.warn("posthog.replay_failed", { reason: (error as Error).name });
    return [];
  }
}
