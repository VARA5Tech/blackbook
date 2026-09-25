import "server-only";
import { createHmac } from "node:crypto";
import { logger } from "@/lib/logger";

/**
 * Blackbook's side of the Tern bridge (`tern-bridge/` in this repository).
 *
 * The bridge runs on the office machine beside a Chrome signed in to Tern, and
 * answers one question at a time: find a contact, give me everything about
 * this one, give me this trip. Blackbook never talks to Tern and never holds a
 * Tern credential — it holds only the secret it signs these requests with.
 *
 * Optional, like PostHog: with `TERN_BRIDGE_URL` or `TERN_BRIDGE_SECRET` unset
 * every call reports "not configured" and the rest of the application is
 * untouched. Failures are reported as values, never thrown through a page, and
 * the log carries the route and the status only: the bridge answers with
 * passports, and none of that belongs in a log line.
 */

export type BridgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "not_configured" | "signed_out" | "not_found" | "unreachable" | "failed"; message: string };

export function ternConfigured(): boolean {
  return Boolean(process.env.TERN_BRIDGE_URL && (process.env.TERN_BRIDGE_SECRET?.length ?? 0) >= 32);
}

/**
 * How long one call may take. A contact with every tab is ten or so page
 * reads at a polite pace; a trip is two. The long walk — a whole client with
 * twenty trips — is never one call: the service asks for the contact, then
 * for each trip in turn.
 */
const TIMEOUT_MS = 120_000;

async function call<T>(path: string): Promise<BridgeResult<T>> {
  const base = process.env.TERN_BRIDGE_URL?.replace(/\/+$/, "");
  const secret = process.env.TERN_BRIDGE_SECRET ?? "";
  if (!base || secret.length < 32) {
    return { ok: false, reason: "not_configured", message: "The Tern bridge is not configured." };
  }

  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${timestamp}.GET ${path}`).digest("hex");
  const route = path.split("?")[0].replace(/\/[0-9]+/g, "/:id");

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      headers: {
        "x-bridge-timestamp": timestamp,
        "x-bridge-signature": signature,
        /*
         * Cloudflare Access in front of the tunnel, when it is set up: the
         * bridge's hostname then refuses anybody without this token before a
         * request reaches the bridge at all. The HMAC is the second lock.
         */
        ...(process.env.TERN_BRIDGE_ACCESS_ID && process.env.TERN_BRIDGE_ACCESS_SECRET
          ? {
              "CF-Access-Client-Id": process.env.TERN_BRIDGE_ACCESS_ID,
              "CF-Access-Client-Secret": process.env.TERN_BRIDGE_ACCESS_SECRET,
            }
          : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn("tern.bridge_unreachable", { route, error: (error as Error).name });
    return { ok: false, reason: "unreachable", message: "The Tern bridge could not be reached." };
  }

  if (res.ok) return { ok: true, data: (await res.json()) as T };

  logger.warn("tern.bridge_refused", { route, status: res.status });
  if (res.status === 503) {
    return { ok: false, reason: "signed_out", message: "Tern has signed the office machine out. Someone needs to sign in again there." };
  }
  if (res.status === 404) return { ok: false, reason: "not_found", message: "Tern has no such record." };
  return { ok: false, reason: "failed", message: "The Tern bridge could not answer." };
}

/* ------------------------------------------------------------ shapes */

/** One labelled piece of a Tern page, in page order. */
export type TernToken = {
  text: string;
  role: "label" | "value" | "badge";
  contact: string | null;
  trip: string | null;
  href: string | null;
};

export type TernSection = { heading: string | null; tokens: TernToken[] };

export type TernContactHit = {
  ternId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  nextTrip: string | null;
  birthday: string | null;
  owner: string | null;
  tags: string[];
};

export type TernContact = {
  ternId: string;
  fetchedAt: string;
  forms: {
    identity?: Record<string, string | string[]>;
    travel_information?: Record<string, string | string[]>;
    other_travel_preferences?: Record<string, string | string[]>;
  };
  /** Every email, phone, passport, address and membership, from its own edit form. */
  items: Record<string, Record<string, string | string[]>[]>;
  profile: TernSection[];
  tabs: Record<string, {
    sections: TernSection[];
    trips?: string[];
    /** Each trip's row on the Trips tab: its name, status and dates, in order. */
    tripRows?: { ternId: string; texts: string[] }[];
    documents?: { name: string; href: string }[];
  }>;
};

export type TernTraveler = {
  name: string;
  contactId: string | null;
  primary: boolean;
  email: string | null;
  phone: string | null;
  birthday: string | null;
};

export type TernTrip = {
  ternId: string;
  fetchedAt: string;
  title: string | null;
  overview: TernSection[];
  travelers: TernTraveler[];
  settings: Record<string, string>;
  days: {
    ternId: string;
    title: string | null;
    location: string | null;
    items: { ternId: string; texts: string[] }[];
  }[];
};

/* ------------------------------------------------------------ calls */

export const ternBridge = {
  health: () => call<{ reachable: boolean; signedIn: boolean }>("/health"),
  /** Whether the page anchors the parser needs are still where Tern put them. */
  schemaCheck: () => call<{ ok: boolean; checks: { name: string; pass: boolean }[] }>("/schema-check"),
  searchContacts: (q: string) => call<TernContactHit[]>(`/contacts/search?q=${encodeURIComponent(q)}`),
  /**
   * One contact. `prefetch` asks the bridge to read the contact's trips in the
   * background too, so a preview's Import finds them already read.
   */
  contact: (id: string, options: { prefetch?: boolean } = {}) =>
    call<TernContact>(`/contacts/${encodeURIComponent(id)}${options.prefetch ? "?prefetch=1" : ""}`),
  trip: (id: string) => call<TernTrip>(`/trips/${encodeURIComponent(id)}`),
};
