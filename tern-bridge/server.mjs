// The Tern bridge: a small HTTP service on the office machine that answers
// Blackbook's questions about Tern, one client at a time, on demand.
//
//   GET /health                    is the Tern session alive
//   GET /schema-check              are the page anchors the parser needs still there
//   GET /contacts/search?q=        find a client in Tern
//   GET /contacts/:id              one contact, everything Tern holds
//   GET /trips/search?q=           find a trip
//   GET /trips/:id                 one trip with its full itinerary
//   GET /catalogue                 the option lists that can be read
//   GET /catalogue/:kind           one of them
//
// Every request must be signed by Blackbook with the shared secret, exactly as
// vara5.com signs its calls to Blackbook: HMAC-SHA256 over
// "<timestamp>.<METHOD> <path-with-query>", five-minute window. Without the
// secret the bridge refuses everything. It listens on localhost; the office
// network reaches it only through the tunnel in front of it.
//
// It answers with client data, including passports, so it never logs a body,
// a name or a query string — only the route, the status and the time taken.
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tern } from "./tern.mjs";

/*
 * Catalogues are built in the background and kept on disk.
 *
 * Walking an autocomplete list takes minutes — far longer than any request
 * should be held open — and the lists change rarely. So the first request
 * starts the walk and answers 202 with how far it has got; later requests get
 * the finished list until it is a week old. Option names are Tern's own
 * vocabulary, not anybody's data, which is why they may be kept on disk at all.
 */
const CACHE_DIR = new URL("./.catalogue-cache/", import.meta.url);
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
mkdirSync(CACHE_DIR, { recursive: true });
const jobs = new Map();

function cachedCatalogue(kind) {
  const file = new URL(`${kind}.json`, CACHE_DIR);
  try {
    if (Date.now() - statSync(file).mtimeMs > CACHE_MS) return null;
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function catalogue(kind, refresh) {
  if (!tern.catalogueKinds().includes(kind)) return { error: "Unknown catalogue.", status: 404 };
  if (!refresh) {
    const cached = cachedCatalogue(kind);
    if (cached) return cached;
  }
  let job = jobs.get(kind);
  if (!job) {
    job = { progress: 0, startedAt: new Date().toISOString(), error: null };
    jobs.set(kind, job);
    tern.catalogue(kind, (p) => { job.progress = p; })
      .then((result) => {
        writeFileSync(new URL(`${kind}.json`, CACHE_DIR), JSON.stringify({ ...result, builtAt: new Date().toISOString() }));
        jobs.delete(kind);
      })
      .catch((error) => {
        job.error = String(error?.message ?? error);
        console.error(`catalogue ${kind} failed: ${job.error}`);
        setTimeout(() => jobs.delete(kind), 60_000);
      });
  }
  return { building: true, kind, progress: Math.round(job.progress * 100), startedAt: job.startedAt, failed: job.error ? true : undefined, status: 202 };
}

const SECRET = process.env.TERN_BRIDGE_SECRET ?? "";
const HOST = process.env.TERN_BRIDGE_HOST ?? "127.0.0.1";
const PORT = Number(process.env.TERN_BRIDGE_PORT ?? 8787);
const WINDOW_MS = 5 * 60 * 1000;

if (SECRET.length < 32) {
  console.error("TERN_BRIDGE_SECRET must be set to at least 32 characters. Refusing to start.");
  process.exit(1);
}

function verify(req, url) {
  const ts = req.headers["x-bridge-timestamp"];
  const sig = req.headers["x-bridge-signature"];
  if (typeof ts !== "string" || typeof sig !== "string") return false;
  const when = Number(ts);
  if (!Number.isFinite(when) || Math.abs(Date.now() - when) > WINDOW_MS) return false;
  const expected = createHmac("sha256", SECRET).update(`${ts}.${req.method} ${url.pathname}${url.search}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const ID = /^[0-9]{1,12}$/;

/** Route pattern for the log, with every id and query stripped out. */
const routeOf = (path) => path.replace(/\/[0-9]+/g, "/:id");

async function handle(req, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const q = url.searchParams.get("q") ?? "";

  if (url.pathname === "/health") return tern.health();
  if (url.pathname === "/schema-check") return tern.schemaCheck();

  if (parts[0] === "contacts") {
    if (parts[1] === "search") {
      if (q.trim().length < 2) return { error: "Search for at least two characters.", status: 400 };
      return tern.searchContacts(q.trim());
    }
    if (ID.test(parts[1] ?? "")) {
      const fresh = url.searchParams.get("fresh") === "1";
      const prefetch = url.searchParams.get("prefetch") === "1";
      const result = await tern.contact(parts[1], { fresh, prefetch });
      return result ?? { error: "No such contact in Tern.", status: 404 };
    }
  }

  if (parts[0] === "trips") {
    if (parts[1] === "search") {
      if (q.trim().length < 2) return { error: "Search for at least two characters.", status: 400 };
      return tern.searchTrips(q.trim());
    }
    if (ID.test(parts[1] ?? "")) {
      const fresh = url.searchParams.get("fresh") === "1";
      return (await tern.trip(parts[1], { fresh })) ?? { error: "No such trip in Tern.", status: 404 };
    }
  }

  if (parts[0] === "catalogue") {
    if (!parts[1]) return { kinds: tern.catalogueKinds() };
    return catalogue(parts[1], url.searchParams.get("refresh") === "1");
  }

  return { error: "Not found.", status: 404 };
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, "http://bridge");
  let status = 200;
  let body;

  try {
    if (req.method !== "GET") {
      status = 405;
      body = { error: "The bridge only reads." };
    } else if (!verify(req, url)) {
      status = 401;
      body = { error: "Unsigned or expired request." };
    } else {
      body = await handle(req, url);
      if (body && typeof body === "object" && typeof body.status === "number") {
        status = body.status;
        delete body.status;
      }
    }
  } catch (error) {
    // Tern sent the sign-in page back: somebody has to sign in on this machine.
    if (String(error?.message).includes("SIGNED_OUT")) {
      status = 503;
      body = { error: "The Tern session on the bridge has ended. Sign in again on the office machine.", signedOut: true };
    } else {
      status = 502;
      body = { error: "The bridge could not read Tern." };
      console.error(`bridge error on ${routeOf(url.pathname)}: ${error?.message ?? error}`);
    }
  }

  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
  console.log(`${req.method} ${routeOf(url.pathname)} ${status} ${Date.now() - started}ms`);
});

server.listen(PORT, HOST, () => {
  console.log(`Tern bridge listening on http://${HOST}:${PORT}`);
});
