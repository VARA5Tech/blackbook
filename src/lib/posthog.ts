import "server-only";
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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId)) {
    return [];
  }

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
