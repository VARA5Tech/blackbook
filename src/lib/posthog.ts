import "server-only";
import { logger } from "@/lib/logger";
import {
  ANALYTICS_RANGES,
  EMPTY_ANALYTICS,
  type AnalyticsRange,
  type MemberAnalytics,
} from "@/domain/engagement";

/**
 * Reading from PostHog.
 *
 * Blackbook sends nothing to PostHog: vara5.com does that, and reports the
 * parts the desk needs straight into `client_interest` so the Interest panel
 * works whether or not this is configured. What is left here is the deep end —
 * the session replay of a client's visit, and how the members' site is doing
 * across every client at once.
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
/** How many recordings one sweep looks at. Comfortably past a month of visits. */
const SWEEP_LIMIT = 200;
/**
 * The replay table is slower to answer than the event table and misses the
 * eight-second budget often enough to matter, so this one query gets longer.
 * The screen that asks for it streams in separately and waits on nothing.
 */
const REPLAY_LIST_TIMEOUT_MS = 20_000;

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

/**
 * Recordings somebody currently has open.
 *
 * The sweep below revokes every share it finds except these, so a watcher is
 * not cut off mid-recording. It is per server instance and deliberately
 * forgetful: after a restart it is empty, the next sweep revokes everything,
 * and anyone watching presses play again. Erring towards revoking is the right
 * way round for a public link.
 */
const heldOpen = new Set<string>();

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
async function runQuery(
  name: string,
  query: string,
  timeoutMs = QUERY_TIMEOUT_MS,
): Promise<unknown[][] | null> {
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
      signal: AbortSignal.timeout(timeoutMs),
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
 * A client's recent visits to vara5.com, newest first.
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

/** A recording, opened in PostHog's own player. */
export type ReplayShare = { embedUrl: string; sharedUrl: string };

/**
 * Turns on PostHog's sharing for one recording and hands back the URLs.
 *
 * Blackbook used to rebuild the recording itself with rrweb, which meant the
 * browser never received a PostHog credential. It also meant a second player
 * that never quite matched the first: the same session looked different in the
 * two, and PostHog's heatmap was not there at all. This asks PostHog for its
 * own player instead, which is the one the desk is comparing against.
 *
 * The cost is real and worth stating: a share token is a public URL. Anyone
 * holding it can watch the recording with no PostHog login, and PostHog makes
 * no promises about what a recording contains. So a token is minted only when
 * somebody presses play, `revokeRecordingShare` takes it away again when they
 * close the player, and `sweepShares` cleans up after a browser that never got
 * the chance to say goodbye.
 *
 * The ownership check is the same one the events path used: PostHog's own
 * record of whose session this is must match the client being viewed, so an id
 * copied from another client's page mints nothing.
 */
export async function shareRecording(
  customerId: string,
  sessionId: string,
): Promise<ReplayShare | null> {
  const configured = credentials();
  if (!configured || !UUID.test(customerId) || !UUID.test(sessionId)) return null;

  const base = `${apiHost()}/api/projects/${configured.projectId}/session_recordings/${sessionId}`;
  const headers = {
    authorization: `Bearer ${configured.key}`,
    "content-type": "application/json",
  };

  try {
    const meta = await fetch(base, {
      headers,
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    if (!meta.ok) {
      logger.warn("posthog.replay_refused", { status: meta.status });
      return null;
    }

    const recording = (await meta.json()) as { distinct_id?: string };
    if (recording.distinct_id !== customerId) {
      logger.warn("posthog.replay_not_theirs", { customerId });
      return null;
    }

    const shared = await fetch(`${base}/sharing`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ enabled: true }),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    if (!shared.ok) {
      logger.warn("posthog.share_refused", { status: shared.status });
      return null;
    }

    const payload = (await shared.json()) as {
      access_token?: string;
      accessToken?: string;
    };
    const token = payload.access_token ?? payload.accessToken ?? "";
    if (!/^[A-Za-z0-9_-]{10,}$/.test(token)) {
      logger.warn("posthog.share_no_token", {});
      return null;
    }

    heldOpen.add(sessionId);
    return {
      embedUrl: `${apiHost()}/embedded/${token}`,
      sharedUrl: `${apiHost()}/shared/${token}`,
    };
  } catch (error) {
    logger.warn("posthog.share_failed", { reason: (error as Error).name });
    return null;
  }
}

/**
 * Takes the public link away again.
 *
 * Called when the player closes, and best-effort when the tab goes away. It
 * needs no ownership check: turning sharing off can only ever reduce what is
 * reachable, and refusing it would leave a link live.
 */
export async function revokeRecordingShare(sessionId: string): Promise<void> {
  const configured = credentials();
  if (!configured || !UUID.test(sessionId)) return;

  heldOpen.delete(sessionId);

  try {
    await fetch(
      `${apiHost()}/api/projects/${configured.projectId}/session_recordings/${sessionId}/sharing`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${configured.key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: false }),
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      },
    );
  } catch (error) {
    logger.warn("posthog.revoke_failed", { reason: (error as Error).name });
  }
}


/**
 * Revokes every share link nobody is watching.
 *
 * The player gives a token back when it closes, on unmount and by `sendBeacon`
 * when the tab goes. None of that runs if the browser is killed outright — a
 * crash, a force quit, a laptop lid — and what survives is a public URL to a
 * client's recording. This is the backstop: it asks PostHog which recordings
 * exist, checks each one's sharing state, and turns off any that is on and not
 * currently being watched.
 *
 * Runs on a timer from `src/instrumentation.ts`, because the deployment has no
 * host shell to schedule anything from. It is safe to run at any moment: the
 * worst it can do is close a link somebody just opened, and they press play
 * again.
 */
export async function sweepShares(): Promise<{ checked: number; revoked: number }> {
  const configured = credentials();
  if (!configured) return { checked: 0, revoked: 0 };

  const base = `${apiHost()}/api/projects/${configured.projectId}/session_recordings`;
  const headers = {
    authorization: `Bearer ${configured.key}`,
    "content-type": "application/json",
  };

  let checked = 0;
  let revoked = 0;

  try {
    // Recordings are deleted at the retention window, so nothing older can
    // still be shared and there is no point asking about it.
    const listed = await fetch(`${base}?limit=${SWEEP_LIMIT}`, {
      headers,
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    if (!listed.ok) {
      logger.warn("posthog.sweep_refused", { status: listed.status });
      return { checked, revoked };
    }

    const { results } = (await listed.json()) as { results?: { id?: string }[] };

    for (const recording of results ?? []) {
      const id = recording.id ?? "";
      if (!UUID.test(id) || heldOpen.has(id)) continue;
      checked++;

      const state = await fetch(`${base}/${id}/sharing`, {
        headers,
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      });
      if (!state.ok) continue;

      const { enabled } = (await state.json()) as { enabled?: boolean };
      if (!enabled) continue;

      await fetch(`${base}/${id}/sharing`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ enabled: false }),
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      });
      revoked++;
    }
  } catch (error) {
    logger.warn("posthog.sweep_failed", { reason: (error as Error).name });
  }

  // Worth a line either way: a sweep that keeps finding links means the player
  // is not closing them, which is the thing this exists to compensate for.
  logger.info("posthog.sweep", { checked, revoked });
  return { checked, revoked };
}


/**
 * A HogQL condition that leaves the desk's own testing out.
 *
 * PostHog has no join back to Blackbook, so it has to be told which references
 * to ignore. A reference is six digits behind `VARA-`, checked here rather than
 * escaped: anything else never reaches the query at all.
 */
function excluding(refs: string[]): string {
  const safe = refs.filter((ref) => /^VARA-\d{6}$/.test(ref));
  if (safe.length === 0) return "";
  return ` and person.properties.vara5_ref not in (${safe.map((ref) => `'${ref}'`).join(", ")})`;
}

/** A visit, whoever made it. The desk's view of who has been on the site. */
export type RecentVisit = {
  sessionId: string;
  customerId: string;
  startedAt: string;
  seconds: number;
  clicks: number;
};

/**
 * The last visits across every client, newest first.
 *
 * Read from the replay table rather than from events, because the two disagree
 * on identity: an event carries whichever distinct id the browser had at the
 * time, which for a guest who signed in mid-session is the anonymous one. The
 * replay row carries the identified id, which is the client's own, and that is
 * what a link into the CRM needs.
 *
 * Names are deliberately not taken from here. PostHog holds a first name only,
 * and the database holds the record: the service joins these ids to `customer`
 * rather than trusting an analytics tool for who somebody is.
 */
export async function recentVisits(
  limit = 12,
  excludeIds: string[] = [],
): Promise<RecentVisit[]> {
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 50);
  // Ids rather than references: the replay table carries no person
  // properties, only the identified distinct id.
  const skip = new Set(excludeIds);

  const rows = await runQuery(
    "posthog.recent_visits",
    `select
       session_id,
       any(distinct_id) as distinct_id,
       min(min_first_timestamp) as started,
       dateDiff('second', min(min_first_timestamp), max(max_last_timestamp)) as seconds,
       sum(click_count) as clicks
     from raw_session_replay_events
     where min_first_timestamp > now() - interval 30 day
     group by session_id
     order by started desc
     limit ${capped}`,
    REPLAY_LIST_TIMEOUT_MS,
  );

  return (rows ?? [])
    .map((row) => ({
      sessionId: String(row[0] ?? ""),
      customerId: String(row[1] ?? ""),
      startedAt: String(row[2] ?? ""),
      seconds: Number(row[3]) || 0,
      clicks: Number(row[4]) || 0,
    }))
    .filter(
      (visit) =>
        UUID.test(visit.sessionId) &&
        UUID.test(visit.customerId) &&
        !skip.has(visit.customerId),
    );
}

/* ------------------------------------------------------------------ *
 * The desk's view of the members' site, across every client at once.
 * ------------------------------------------------------------------ */

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Everything the analytics screen needs, in one authorized read.
 *
 * Six queries rather than one: HogQL will not group by day, by journey, by
 * section and by person in a single answer, and six parallel reads against a
 * cache that holds for five minutes is cheaper than the joins would be.
 *
 * `days` is a literal from `ANALYTICS_RANGES` and is checked again here, so the
 * interval can be interpolated without a binding mechanism HogQL does not have.
 */
export async function memberAnalytics(
  days: AnalyticsRange,
  excludeRefs: string[] = [],
): Promise<MemberAnalytics> {
  if (!credentials()) return EMPTY_ANALYTICS;
  if (!ANALYTICS_RANGES.includes(days)) {
    logger.warn("posthog.analytics_bad_range", {});
    return EMPTY_ANALYTICS;
  }

  const since = `now() - interval ${days} day`;
  // A guest is only a client once the gate has named them; anonymous browsing
  // of the public pages is a different question and not this screen's subject.
  const named = `person.properties.vara5_ref != ''${excluding(excludeRefs)}`;

  const [funnel, daily, journeys, sections, clients, devices] = await Promise.all([
    runQuery(
      "analytics.funnel",
      `select
         countIf(event = 'journey_card_flipped') as flipped,
         countIf(event = 'journey_opened') as opened,
         countIf(event = 'journey_read') as read_through,
         countIf(event = 'cta_clicked') as asked,
         count(distinct person_id) as clients,
         count(distinct $session_id) as visits,
         round(sumIf(toFloat(properties.seconds), event = 'journey_read')) as seconds
       from events
       where timestamp > ${since} and ${named}`,
    ),
    runQuery(
      "analytics.daily",
      `select toDate(timestamp) as day,
              count(distinct $session_id) as visits,
              count(distinct person_id) as clients
       from events
       where timestamp > ${since} and ${named}
       group by day order by day`,
    ),
    runQuery(
      "analytics.journeys",
      `select properties.destination as slug,
              any(properties.title) as title,
              countIf(event = 'journey_card_flipped') as flipped,
              countIf(event = 'journey_opened') as opened,
              countIf(event = 'journey_read') as read_through,
              countIf(event = 'cta_clicked') as asked,
              count(distinct person_id) as clients,
              round(sumIf(toFloat(properties.seconds), event = 'journey_read')) as seconds
       from events
       where timestamp > ${since} and ${named} and properties.destination != ''
       group by slug order by opened desc, flipped desc limit 20`,
    ),
    runQuery(
      "analytics.sections",
      `select properties.section as section,
              count() as views,
              count(distinct person_id) as clients
       from events
       where event = 'section_viewed' and timestamp > ${since}
         and properties.section != '' and ${named}
       group by section order by views desc`,
    ),
    runQuery(
      "analytics.clients",
      `select distinct_id,
              any(person.properties.vara5_ref) as ref,
              any(person.properties.name) as name,
              count(distinct $session_id) as visits,
              countIf(event = 'journey_opened') as opened,
              countIf(event = 'cta_clicked') as asked,
              round(sumIf(toFloat(properties.seconds), event = 'journey_read')) as seconds,
              max(timestamp) as last_seen
       from events
       where timestamp > ${since} and ${named}
       group by distinct_id
       order by asked desc, opened desc, visits desc limit 25`,
    ),
    runQuery(
      "analytics.devices",
      `select properties.$device_type as device, count(distinct $session_id) as sessions
       from events
       where timestamp > ${since} and ${named} and properties.$device_type != ''
       group by device order by sessions desc limit 5`,
    ),
  ]);

  const head = funnel?.[0] ?? [];

  return {
    funnel: {
      flipped: num(head[0]),
      opened: num(head[1]),
      read: num(head[2]),
      asked: num(head[3]),
      clients: num(head[4]),
      visits: num(head[5]),
      seconds: num(head[6]),
    },
    daily: (daily ?? []).map((row) => ({
      day: str(row[0]),
      visits: num(row[1]),
      clients: num(row[2]),
    })),
    journeys: (journeys ?? []).map((row) => ({
      slug: str(row[0]),
      // The website sends the title the client actually saw; fall back to the
      // slug only when an older event predates that property.
      title: str(row[1]) || prettySlug(str(row[0])),
      flipped: num(row[2]),
      opened: num(row[3]),
      read: num(row[4]),
      asked: num(row[5]),
      clients: num(row[6]),
      seconds: num(row[7]),
    })),
    sections: (sections ?? []).map((row) => ({
      key: str(row[0]),
      label: SECTIONS[str(row[0])] ?? prettySlug(str(row[0])),
      views: num(row[1]),
      clients: num(row[2]),
    })),
    clients: (clients ?? [])
      .filter((row) => UUID.test(str(row[0])) && str(row[1]) !== "")
      .map((row) => ({
        customerId: str(row[0]),
        ref: str(row[1]),
        name: str(row[2]),
        visits: num(row[3]),
        opened: num(row[4]),
        asked: num(row[5]),
        seconds: num(row[6]),
        lastSeen: str(row[7]),
      })),
    devices: (devices ?? []).map((row) => ({
      device: str(row[0]),
      sessions: num(row[1]),
    })),
  };
}

function prettySlug(slug: string): string {
  return slug.replace(/-/g, " ").replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase());
}
