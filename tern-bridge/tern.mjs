// Everything the bridge knows about Tern.
//
// Tern has no API. What it has is a signed-in browser, so that is what this
// drives: a Chrome on the office machine that somebody signed into by hand,
// reached over the DevTools protocol. Every read runs *inside* the Tern page as
// a same-origin fetch, which means the page's own session does the
// authenticating. No cookie, token or password passes through this process,
// and none is ever stored.
//
// Read-only by construction: every request below is a GET. Tern's edit forms
// are read for their exact values, but a GET renders a form and saves nothing.
// Nothing here clicks, submits or navigates the visible tab.

const CDP = process.env.TERN_CDP_URL ?? "http://127.0.0.1:9222";
const ORIGIN = "https://app.tern.travel";

/* ------------------------------------------------------------ connection */

let socket = null;
let nextId = 1;
const pending = new Map();

async function pageTarget() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  let tab = list.find((t) => t.type === "page" && t.url.startsWith(ORIGIN));
  if (!tab) {
    // Opened in the background of the signed-in profile, so the session applies.
    tab = await (await fetch(`${CDP}/json/new?${ORIGIN}/dashboard`, { method: "PUT" })).json();
    await new Promise((r) => setTimeout(r, 2500));
  }
  return tab;
}

async function connect() {
  if (socket && socket.readyState === WebSocket.OPEN) return socket;
  const tab = await pageTarget();
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("Could not reach the Tern tab over the DevTools protocol."));
  });
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) return waiter.reject(new Error(msg.error.message));
    const r = msg.result;
    if (r.exceptionDetails) {
      return waiter.reject(new Error(r.exceptionDetails.exception?.description ?? "Tern page error"));
    }
    waiter.resolve(r.result.value);
  };
  socket.onclose = () => {
    socket = null;
    for (const [, w] of pending) w.reject(new Error("The Tern tab went away."));
    pending.clear();
  };
  return socket;
}

async function evaluate(expression) {
  const ws = await connect();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true, timeout: 180000 },
    }));
  });
}

/*
 * A few reads at a time, never a burst.
 *
 * Tern serves requests in parallel happily — its own pages load that way — but
 * it is a person's working session, not a service built for load. Three page
 * operations at once, each fetching at most six pages at once, is about what a
 * person with a few tabs open does, and it is what took a client with ten
 * trips from a minute and a half to seconds.
 */
const LIMIT = 3;
let running = 0;
const waiting = [];
function serial(work) {
  return new Promise((resolve, reject) => {
    const start = () => {
      running++;
      Promise.resolve().then(work).then(resolve, reject).finally(() => {
        running--;
        waiting.shift()?.();
      });
    };
    if (running < LIMIT) start();
    else waiting.push(start);
  });
}

/**
 * Runs one of the page operations below inside the Tern tab.
 *
 * `lib` and the operation are serialised with toString, so they must not close
 * over anything in this module: everything they use is passed in or defined in
 * `lib`.
 */
function inPage(op, arg) {
  return serial(() =>
    evaluate(`(async () => { const L = (${lib.toString()})(); return (${op.toString()})(L, ${JSON.stringify(arg ?? null)}); })()`),
  );
}

/* ------------------------------------------------------------ page library */

// Helpers available to every operation, as `L`. Runs in the browser.
function lib() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  // No fixed pause between pages: the cap on how many run at once is the pacing.
  const PACE = 0;

  /** Runs `work` over `items`, at most `limit` at a time, results in order. */
  async function pool(items, limit, work) {
    const out = new Array(items.length);
    let next = 0;
    const lane = async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i], i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
    return out;
  }

  async function grab(path) {
    if (PACE) await sleep(PACE);
    const res = await fetch(path, { credentials: "same-origin", headers: { Accept: "text/html" } });
    const html = await res.text();
    const signedOut = res.url.includes("/session") || /name="session\[/.test(html);
    return { status: res.status, signedOut, doc: new DOMParser().parseFromString(html, "text/html") };
  }

  async function grabStream(path, pace = PACE) {
    if (pace) await sleep(pace);
    const res = await fetch(path, { credentials: "same-origin", headers: { Accept: "text/vnd.turbo-stream.html, text/html" } });
    const html = await res.text();
    return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  }

  // The text an element carries itself, not its children's: an email sits in a
  // button next to a "Click to copy" span, and reading the whole button would
  // glue the two together.
  function ownText(el) {
    return clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "));
  }

  const idOf = (href, kind) => {
    const m = (href || "").match(new RegExp("^/" + kind + "/([0-9]+)(?:$|[/?#])"));
    return m ? m[1] : null;
  };

  const NOISE = new Set(["Click to copy", "Copy", "Edit", "Delete", "Remove", "Add", "Show more", "Show less",
    "Open menu", "Cancel", "Save", "Invite", "Use setting"]);

  /**
   * Every h2/h3 section of a page as an ordered list of tokens: each piece of
   * text with what it is (heading, label, value, badge) and any record it
   * links to. Nothing is interpreted here, so nothing is lost; callers read
   * the sections they understand and the rest is kept as it came.
   */
  function sections(root) {
    const out = [];
    let current = null;
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.currentNode; el; el = walker.nextNode()) {
      if (el.closest("script,style,template,svg,select,[aria-hidden=true]")) continue;
      // Only an h2 opens a section. Tern uses h3 for field names inside one —
      // "Email", "Phone", "Birthday" on a traveller card — and splitting there
      // would scatter one person across four sections.
      if (el.tagName === "H2") {
        current = { heading: clean(el.textContent), tokens: [] };
        out.push(current);
        continue;
      }
      const text = ownText(el);
      if (!text || NOISE.has(text)) continue;
      // Content before any heading — a tab that is one bare list — still counts.
      if (!current) {
        current = { heading: null, tokens: [] };
        out.push(current);
      }
      const a = el.closest("a[href]");
      const cls = el.className && typeof el.className === "string" ? el.className : "";
      current.tokens.push({
        text,
        role: /^H[34]$|^LABEL$/.test(el.tagName) || /font-bold|text-bold|font-semibold/.test(cls) ? "label"
          : /rounded-full|w-fit|badge/.test(cls) ? "badge" : "value",
        contact: a ? idOf(a.getAttribute("href"), "contacts") : null,
        trip: a ? idOf(a.getAttribute("href"), "trips") : null,
        href: a ? a.getAttribute("href").split("?")[0] : null,
      });
    }
    return out.filter((s) => s.tokens.length);
  }

  /** Every named field of a form with its current value, exactly as Tern holds it. */
  function formValues(doc) {
    const out = {};
    const form = doc.querySelector("main form") || doc.querySelector("form[action*=contacts]") || doc;
    for (const el of form.querySelectorAll("input[name], select[name], textarea[name]")) {
      if (/authenticity_token|_method|commit/.test(el.name)) continue;
      const key = el.name.replace(/^[a-z_]+\[/, "").replace(/\]\[/g, ".").replace(/[\[\]]/g, "");
      if (el.type === "radio") {
        if (el.checked) out[key] = clean(el.closest("label")?.textContent) || el.value;
        continue;
      }
      if (el.type === "checkbox") {
        if (el.checked) (out[key] = Array.isArray(out[key]) ? out[key] : []).push(clean(el.closest("label")?.textContent) || el.value);
        continue;
      }
      if (el.tagName === "SELECT") {
        const chosen = [...el.selectedOptions].map((o) => clean(o.textContent)).filter(Boolean);
        if (el.value) out[key] = el.multiple ? chosen : chosen[0] ?? el.value;
        continue;
      }
      if (el.type === "hidden" && !el.value) continue;
      if (el.value) out[key] = el.value;
    }
    return out;
  }

  /** A Tern table view, every page of it, as rows of cells plus the row's own id. */
  async function readTable(path, rowPrefix, maxPages = 40) {
    const rows = [];
    let headers = null;
    for (let page = 1; page <= maxPages; page++) {
      const { doc, signedOut } = await grab(`${path}${path.includes("?") ? "&" : "?"}page=${page}`);
      if (signedOut) throw new Error("SIGNED_OUT");
      if (!headers) {
        const head = [...doc.querySelectorAll(".table-row")].find((r) => !r.id && r.children.length > 3);
        headers = head ? [...head.children].map((c) => clean(c.textContent)) : [];
      }
      const found = [...doc.querySelectorAll(`[id^="${rowPrefix}"]`)]
        .filter((r) => new RegExp("^" + rowPrefix + "[0-9]+$").test(r.id));
      if (!found.length) break;
      for (const r of found) {
        const cells = [...r.children].map((c) => ({
          text: clean(c.textContent),
          parts: [...c.querySelectorAll("p,span,a")].map((x) => ownText(x)).filter(Boolean),
          // Every separate piece of text in the cell, whatever element holds it:
          // an avatar's initials and the name beside it are two divs, not one.
          leaves: [c, ...c.querySelectorAll("*")].map((x) => ownText(x)).filter(Boolean),
          contact: idOf(c.querySelector('a[href^="/contacts/"]')?.getAttribute("href"), "contacts"),
        }));
        rows.push({ id: r.id.slice(rowPrefix.length), cells });
      }
    }
    return { headers, rows };
  }

  return { sleep, clean, pool, grab, grabStream, ownText, idOf, sections, formValues, readTable };
}

/* ------------------------------------------------------------ operations */

async function opHealth(L) {
  const { status, signedOut } = await L.grab("/dashboard");
  return { reachable: status < 500, signedIn: status === 200 && !signedOut };
}

/**
 * The canary. Reads the first contact and the first trip and checks that the
 * anchors the parser depends on are still there — the Rails DOM ids, the edit
 * form's field names, the section headings.
 *
 * Tern has no API, so the bridge reads Tern's HTML; the one real risk is Tern
 * redesigning a page and the parser then returning empty data that looks like
 * an empty client. This turns that silent failure into a loud one: Blackbook
 * checks this and refuses to import while it is failing, rather than writing
 * blanks over a real record.
 */
async function opSchemaCheck(L) {
  const checks = [];
  const ok = (name, pass) => checks.push({ name, pass: Boolean(pass) });

  const list = await L.grab("/contacts?tab=shared_with_me");
  const contactRow = list.doc.querySelector('[id^="table_row_contact_"]');
  ok("contacts list rows", contactRow);

  const cid = contactRow?.id.match(/(\d+)$/)?.[1];
  if (cid) {
    const edit = await L.grab(`/contacts/${cid}/edit`);
    const fields = L.formValues(edit.doc);
    // The DB-column-backed field names the identity mapping relies on.
    ok("contact edit form: first_name", "first_name" in fields || edit.doc.querySelector('[name="contact[first_name]"]'));
    ok("contact edit form: contact_type", edit.doc.querySelector('[name="contact[contact_type]"]'));

    const profile = await L.grab(`/contacts/${cid}`);
    const headings = [...profile.doc.querySelectorAll("h2")].map((h) => L.clean(h.textContent));
    // Headings every contact has, supplier or client. "Travelers" is only on a
    // trip, so it is not checked here — that is the trip anchors below.
    ok("contact section: Contact Information", headings.includes("Contact Information"));
    ok("contact section: Preferences", headings.includes("Preferences"));
  }

  const tlist = await L.grab("/trips?tab=shared_with_me&view=table");
  const tripRow = tlist.doc.querySelector('[id^="table_row_trip_"]');
  ok("trips list rows", tripRow);
  const tid = tripRow?.id.match(/(\d+)$/)?.[1];
  if (tid) {
    const acts = await L.grab(`/trips/${tid}/activities`);
    ok("trip day anchors", acts.doc.querySelector('[id^="trip_day_"]'));
    ok("trip activity anchors", acts.doc.querySelector('[id^="trip_activity_"]'));
  }

  return { ok: checks.every((c) => c.pass), checks };
}

async function opSearchContacts(L, q) {
  const byId = new Map();
  for (const tab of ["shared_with_me", "my_contacts"]) {
    const { headers, rows } = await L.readTable(`/contacts?tab=${tab}&q=${encodeURIComponent(q)}`, "table_row_contact_", 3);
    const col = (name) => headers.findIndex((h) => h.toLowerCase() === name);
    for (const r of rows) {
      if (byId.has(r.id)) continue;
      const cell = (name) => (col(name) >= 0 ? r.cells[col(name)]?.text || null : null);
      /*
       * The first-name cell also holds the avatar, whose initials sit in the
       * same cell: read whole, "Arpit" came back as "AGArpit". The name is the
       * cell's last piece of text that is not just the initials.
       */
      const firstCell = col("first name") >= 0 ? r.cells[col("first name")] : null;
      // The avatar comes first in the cell and the name last. Taking the last
      // piece keeps a first name that is itself short capitals, like "GBS".
      const firstName = firstCell?.leaves?.at(-1) ?? cell("first name");
      byId.set(r.id, {
        ternId: r.id,
        firstName,
        lastName: cell("last name"),
        email: cell("email"),
        nextTrip: cell("next trip"),
        birthday: cell("birthday"),
        owner: cell("owner"),
        tags: cell("tags") ? cell("tags").split(/\s*,\s*|\s{2,}/).filter(Boolean) : [],
        tab,
      });
    }
  }
  return [...byId.values()];
}

async function opSearchTrips(L, q) {
  const byId = new Map();
  for (const tab of ["shared_with_me", "my_trips"]) {
    const { rows } = await L.readTable(`/trips?tab=${tab}&view=table&q=${encodeURIComponent(q)}`, "table_row_trip_", 5);
    for (const r of rows) {
      if (byId.has(r.id)) continue;
      /*
       * Found by what they contain, not by position. A row whose client is
       * unset, or whose trip sits inside another, has one cell fewer, and
       * reading by position put a date where the status belongs.
       */
      const STATUSES = ["Inbound", "Planning", "Booked", "Traveling", "Traveled", "Cancelled", "Archived"];
      const status = r.cells.find((c) => STATUSES.includes(c.text));
      const dates = r.cells.find((c) => c !== status && /(19|20)[0-9]{2}|Multiple Date Ranges/.test(c.text));
      const client = r.cells.find((c) => /\([0-9]+ (person|people)\)/.test(c.text));
      byId.set(r.id, {
        ternId: r.id,
        name: r.cells[0]?.text || null,
        owner: r.cells[1]?.text || null,
        client: client?.parts?.[0] || null,
        party: client?.parts?.find((p) => /\(/.test(p)) || null,
        status: status?.text || null,
        dates: dates?.text || null,
        tab,
      });
    }
  }
  return [...byId.values()];
}

/**
 * One contact, all of it.
 *
 * Exact values come from the edit forms, which carry them as named fields.
 * The profile's sections come raw, so the lists that have no form of their own
 * (phones, emails, addresses, passports, loyalty, preferences, relationships,
 * tags) arrive whole, and a field Blackbook does not map yet is still kept.
 * The tabs come as tables or sections the same way.
 */
async function opContact(L, id) {
  const base = `/contacts/${id}`;
  const profile = await L.grab(base);
  if (profile.signedOut) throw new Error("SIGNED_OUT");
  if (profile.status === 404) return null;

  const forms = {};
  const formPaths = ["edit", "travel_information/edit", "other_travel_preferences/edit"];
  const formPages = await L.pool(formPaths, 6, (f) => L.grab(`${base}/${f}`));
  formPaths.forEach((f, i) => {
    if (formPages[i].status === 200) forms[f.replace("/edit", "") || "identity"] = L.formValues(formPages[i].doc);
  });
  forms.identity = forms.edit;
  delete forms.edit;

  /*
   * Each item of a list — every email, phone, passport, address and loyalty
   * membership — has an edit form of its own with exact named fields, so each
   * is read from that rather than guessed from how the profile lays it out.
   * A passport card on the profile is three unlabelled values in a row; its
   * form says which is the number and which the expiry.
   */
  const itemRoutes = new Map();
  const note = (href) => {
    const m = (href || "").match(new RegExp("^/contacts/[0-9]+/([a-z_]+)/([0-9]+)"));
    if (m && m[1] !== "trips" && m[1] !== "notes") itemRoutes.set(`${m[1]}/${m[2]}`, { list: m[1], itemId: m[2] });
  };
  for (const a of profile.doc.querySelectorAll("a[href]")) note(a.getAttribute("href"));
  for (const f of profile.doc.querySelectorAll("form[action]")) note(f.getAttribute("action"));
  const items = {};
  const routes = [...itemRoutes.values()];
  const itemPages = await L.pool(routes, 6, ({ list, itemId }) => L.grab(`${base}/${list}/${itemId}/edit`));
  routes.forEach(({ list, itemId }, i) => {
    if (itemPages[i].status !== 200) return;
    (items[list] ??= []).push({ ternId: itemId, ...L.formValues(itemPages[i].doc) });
  });

  const tabs = {};
  const tabNames = ["trips", "notes", "activity_logs", "documents", "conversations", "form_responses"];
  const tabPages = await L.pool(tabNames, 6, (t) => L.grab(`${base}/${t}`));
  for (const [ti, t] of tabNames.entries()) {
    const { doc, status } = tabPages[ti];
    if (status !== 200) continue;
    const main = doc.querySelector("main") || doc.body;
    /*
     * Activity logs, emails and form responses arrive in lazy frames: the page
     * holds an empty placeholder and the browser fetches its content once it
     * scrolls into view. The first scrape saved the placeholders and lost the
     * content, so here every such frame is fetched and put in its place.
     */
    const frames = [...main.querySelectorAll("turbo-frame[src]")].filter((f) => (f.getAttribute("src") || "").startsWith("/"));
    const filled = await L.pool(frames, 6, (frame) => L.grabStream(frame.getAttribute("src")));
    frames.forEach((frame, i) => {
      frame.innerHTML = filled[i].body.innerHTML;
      frame.removeAttribute("src");
    });
    tabs[t] = {
      sections: L.sections(main),
      trips: t === "trips"
        ? [...new Set([...main.querySelectorAll('a[href^="/trips/"]')].map((a) => L.idOf(a.getAttribute("href"), "trips")).filter(Boolean))]
        : undefined,
      /*
       * Each trip's row as the Trips tab shows it — name, status, dates — so a
       * preview can list what would come across without opening every trip.
       */
      tripRows: t === "trips"
        ? [...new Map([...main.querySelectorAll('a[href^="/trips/"]')].map((a) => {
            const id = L.idOf(a.getAttribute("href"), "trips");
            const row = a.closest('[id^="table_row_"], .table-row, li, tr') || a.parentElement;
            const texts = row ? [...row.querySelectorAll("*")].map((e) => L.ownText(e)).filter(Boolean) : [L.clean(a.textContent)];
            return [id, { ternId: id, texts }];
          }).filter(([id]) => id)).values()]
        : undefined,
      documents: t === "documents"
        /*
         * Real files only: a stored blob, a download, or one document by its
         * number. The tab's own links — "Documents", "Add Document" — point at
         * the list and the upload form, and read as files they were noise.
         */
        ? [...new Map([...main.querySelectorAll("a[href]")]
            .filter((a) => {
              const href = a.getAttribute("href") || "";
              return /rails\/active_storage|\/blobs?\/|\/download|\/documents\/[0-9]+/.test(href) && !/\/new(\?|$)/.test(href);
            })
            .map((a) => [a.getAttribute("href").split("?")[0], { name: L.clean(a.textContent) || "Document", href: a.getAttribute("href").split("?")[0] }])).values()]
        : undefined,
    };
  }

  return {
    ternId: String(id),
    fetchedAt: new Date().toISOString(),
    forms,
    items,
    profile: L.sections(profile.doc.querySelector("main") || profile.doc.body),
    tabs,
  };
}

/**
 * One trip, all of it: the overview (travellers, itinerary summary, bookings,
 * commission, settings) and the day-by-day itinerary with every activity.
 */
async function opTrip(L, id) {
  const base = `/trips/${id}`;
  const [overview, acts] = await Promise.all([L.grab(base), L.grab(`${base}/activities`)]);
  if (overview.signedOut) throw new Error("SIGNED_OUT");
  if (overview.status === 404) return null;
  const o = overview.doc;

  /*
   * The travellers, walked in document order from the "Travelers" heading to
   * the next one. A card opens with the person's name, may carry a Primary
   * badge, and then pairs an h3 label (Email, Phone, Birthday) with the value
   * after it. This is the reading that held across all 86 trips of the first
   * scrape, 346 cards, without a miss.
   */
  const travelers = [];
  let inside = false;
  let card = null;
  let pending = null;
  const walker = o.createTreeWalker(o.body, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    if (el.tagName === "H2") {
      if (inside) break;
      inside = L.clean(el.textContent) === "Travelers";
      continue;
    }
    if (!inside || el.closest("script,style,svg")) continue;
    const t = L.ownText(el);
    if (!t || t === "Click to copy" || t === "Manage Travelers") continue;
    if (el.tagName === "H3" && ["Email", "Phone", "Birthday"].includes(t)) {
      pending = t.toLowerCase();
      continue;
    }
    if (pending && card) {
      card[pending] ??= t;
      pending = null;
      continue;
    }
    if (t === "Primary" && card) {
      card.primary = true;
      continue;
    }
    if (el.tagName === "P" && /capsize/.test(el.className || "") && /^[A-Z]/.test(t) && t.split(" ").length <= 6) {
      const link = el.closest("a[href^='/contacts/']") || el.parentElement?.querySelector("a[href^='/contacts/']");
      card = {
        name: t,
        contactId: L.idOf(link?.getAttribute("href"), "contacts"),
        primary: false,
        email: null,
        phone: null,
        birthday: null,
      };
      travelers.push(card);
    }
  }

  const settings = {};
  for (const sel of o.querySelectorAll("select[name]")) {
    const chosen = sel.selectedOptions[0];
    if (chosen && sel.value) settings[sel.name.replace(/^[a-z_]+\[/, "").replace(/\]/g, "")] = L.clean(chosen.textContent);
  }

  const a = acts.doc;
  const days = [];
  for (const day of a.querySelectorAll('[id^="trip_day_"]')) {
    if (!/^trip_day_[0-9]+$/.test(day.id)) continue;
    /*
     * The day header wraps Tern's edit forms and menus, so its textContent is
     * "Trip DetailsInformation SectionTitleCancelSave…". The real day name is
     * the value of the `trip_day[title]` input; the location, where a day has
     * one, is the `_location` field's own value. Read those, not the wrapper.
     */
    const titleInput = day.querySelector('input[name="trip_day[title]"], textarea[name="trip_day[title]"]');
    const locInput = day.querySelector('input[name*="[location]"], input[name*="location"]');
    const locEl = day.querySelector('[id$="_location"]');
    days.push({
      ternId: day.id.slice("trip_day_".length),
      title: L.clean(titleInput?.value) || null,
      location: L.clean(locInput?.value) || (locEl ? L.clean(locEl.getAttribute("value") || L.ownText(locEl)) : null) || null,
      items: [...day.querySelectorAll('[id^="trip_activity_"]')]
        .filter((r) => /^trip_activity_[0-9]+$/.test(r.id))
        .map((r) => ({
          ternId: r.id.slice("trip_activity_".length),
          texts: [...r.querySelectorAll("*")].map((e) => L.ownText(e)).filter((t) => t && !/^(Edit|Delete|Duplicate|Move|Hide from travelers|Open tripactivity more actions menu)$/.test(t)),
          hiddenFromTravelers: /Hide from travelers/.test(r.textContent) === false && /hidden/i.test(r.className || ""),
        })),
    });
  }

  // The trip's own name, as the trips list shows it. The itinerary carries a
  // title of its own that often differs ("Europe Holiday" vs "Nath Family").
  const titleInput = o.querySelector('input[name="trip[name]"], input[name="trip[title]"]');
  const title = L.clean(titleInput?.value) || L.clean(o.querySelector("h1")?.textContent) || null;

  return {
    ternId: String(id),
    fetchedAt: new Date().toISOString(),
    title,
    overview: L.sections(o.querySelector("main") || o.body),
    travelers,
    settings,
    days,
  };
}

/*
 * Tern's own option lists, so Blackbook's catalogue can offer what Tern offers.
 *
 * The autocomplete-backed ones answer a typed prefix, so they are walked a
 * letter at a time and the answers pooled. The form-backed ones are read off
 * a form that is rendered and never submitted.
 */
const AUTOCOMPLETE = {
  loyalty_programs: "/loyalty_programs/autocomplete",
};

/*
 * These two answer JSON — `[[id, label], …]` — and an empty query returns the
 * whole list in one request. Asking for HTML instead sends Tern's dashboard
 * back with a 200, which is how a first walk spent fifty minutes collecting
 * nothing.
 *
 * Read the contents before using them: they are free text typed by advisors
 * across every agency on Tern ("0627 550", "17 March Birthday", dinner times),
 * not a curated vocabulary. Blackbook does not load them into its catalogue;
 * Populate brings over only the entries that sit on the client being read.
 */
const JSON_LISTS = {
  activity_interests: "/activity_interest_options/autocomplete?permit_custom=true&q=",
  food_drink: "/food_drink_options/autocomplete?permit_custom=true&q=",
};

async function opJsonList(L, path) {
  await L.sleep(300);
  const res = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
  const rows = await res.json();
  return rows.map(([value, label]) => ({ value: String(value), label: L.clean(label) }));
}

/**
 * One batch of autocomplete probes. The walk as a whole is driven from Node,
 * a batch at a time, because all of it takes minutes and a single evaluation
 * inside the page is cut off long before that.
 */
async function opAutocompleteBatch(L, { path, prefixes }) {
  const found = [];
  for (const q of prefixes) {
    const doc = await L.grabStream(`${path}?q=${q}`, 120);
    for (const el of doc.querySelectorAll("[data-autocomplete-value]")) {
      const value = el.getAttribute("data-autocomplete-value");
      const label = L.clean(el.getAttribute("data-autocomplete-label") || el.textContent);
      if (value && label) found.push({ value, label });
    }
  }
  return found;
}

async function opCatalogue(L, { kind, formPath }) {
  const { doc, status } = await L.grab(formPath);
  if (status !== 200) return { kind, options: [], status };
  const fields = {};
  for (const sel of doc.querySelectorAll("select[name]")) {
    fields[sel.name] = [...sel.options].map((o) => ({ value: o.value, label: L.clean(o.textContent) })).filter((o) => o.value);
  }
  for (const input of doc.querySelectorAll("input[type=radio][name], input[type=checkbox][name]")) {
    const label = L.clean(input.closest("label")?.textContent || doc.querySelector(`label[for="${input.id}"]`)?.textContent);
    (fields[input.name] ??= []).push({ value: input.value, label: label || input.value });
  }
  return { kind, fields };
}

/** Any one contact and trip, so a form can be rendered to read its options. */
async function opSamples(L) {
  const contacts = await L.grab("/contacts?tab=shared_with_me");
  const trips = await L.grab("/trips?tab=shared_with_me&view=table");
  const first = (doc, prefix) =>
    [...doc.querySelectorAll(`[id^="${prefix}"]`)].map((r) => r.id.slice(prefix.length)).find((x) => /^[0-9]+$/.test(x)) ?? null;
  return { contact: first(contacts.doc, "table_row_contact_"), trip: first(trips.doc, "table_row_trip_") };
}

/* ------------------------------------------------------------ public API */

let samples = null;

/*
 * The last few minutes of reads, in memory only.
 *
 * A preview and the import that follows it ask for the same contact and the
 * same trips within a minute of each other, and reading Tern twice for that is
 * the slowest thing the bridge could do. Kept five minutes and never written
 * to disk: these answers carry passports, and a cache on disk would be a copy
 * of them nobody meant to keep. `fresh` skips it.
 */
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();
function remembered(key, fresh, read) {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = read().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { at: Date.now(), value });
  // A bounded map: the oldest reads go first.
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}

export const tern = {
  health: () => inPage(opHealth),
  schemaCheck: () => inPage(opSchemaCheck),
  searchContacts: (q) => inPage(opSearchContacts, String(q ?? "")),
  searchTrips: (q) => inPage(opSearchTrips, String(q ?? "")),
  /**
   * One contact. With `prefetch`, the contact's trips are read in the
   * background as well, so the import that follows a preview finds them ready.
   */
  contact(id, { fresh = false, prefetch = false } = {}) {
    const read = remembered(`contact:${id}`, fresh, () => inPage(opContact, String(id)));
    if (prefetch) {
      read.then((c) => {
        for (const tripId of c?.tabs?.trips?.trips ?? []) this.trip(tripId).catch(() => {});
      }).catch(() => {});
    }
    return read;
  },
  trip: (id, { fresh = false } = {}) => remembered(`trip:${id}`, fresh, () => inPage(opTrip, String(id))),

  catalogueKinds: () => [...Object.keys(AUTOCOMPLETE), ...Object.keys(JSON_LISTS), "contact_fields", "other_travel_preferences", "addresses", "passports", "trip_settings"],

  /**
   * One of Tern's option lists.
   *
   * The autocomplete-backed ones answer only a query of two characters or
   * more, and match anywhere in a name, so every pair of letters, pooled, is
   * the whole list: any name with two letters in a row contains one of them.
   * An empty or one-letter query gets the whole page back instead, which is
   * how a first attempt read Tern's own menus as options.
   *
   * `onProgress` is told how far the walk has got, for the caller to report.
   */
  async catalogue(kind, onProgress = () => {}) {
    if (JSON_LISTS[kind]) {
      const options = await inPage(opJsonList, JSON_LISTS[kind]);
      onProgress(1);
      return { kind, curated: false, options: options.sort((x, y) => x.label.localeCompare(y.label)) };
    }
    if (AUTOCOMPLETE[kind]) {
      const letters = "abcdefghijklmnopqrstuvwxyz";
      const seen = new Map();
      for (let i = 0; i < letters.length; i++) {
        const prefixes = [...letters].map((b) => letters[i] + b);
        for (const o of await inPage(opAutocompleteBatch, { path: AUTOCOMPLETE[kind], prefixes })) {
          if (!seen.has(o.value)) seen.set(o.value, o);
        }
        onProgress((i + 1) / letters.length);
      }
      return { kind, options: [...seen.values()].sort((x, y) => x.label.localeCompare(y.label)) };
    }
    samples ??= await inPage(opSamples);
    const { contact: sampleContactId, trip: sampleTripId } = samples;
    const forms = {
      contact_fields: `/contacts/${sampleContactId}/edit`,
      other_travel_preferences: `/contacts/${sampleContactId}/other_travel_preferences/edit`,
      addresses: `/contacts/${sampleContactId}/addresses/new`,
      passports: `/contacts/${sampleContactId}/passports/new`,
      trip_settings: `/trips/${sampleTripId}`,
    };
    if (!forms[kind]) return null;
    return inPage(opCatalogue, { kind, formPath: forms[kind] });
  },
};
