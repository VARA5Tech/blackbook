# Tern bridge

Reads Tern for Blackbook, one client at a time, when someone asks.

Tern has no API. It has a signed-in browser, so the bridge drives one: a Chrome
on the office machine that a person signs in to by hand. Every read happens
inside that Tern tab as a same-origin `GET`, so the browser's own session does
the authenticating. **The bridge never holds a password, cookie or token.**

```
Blackbook (VPS) ── signed HTTPS ──▶ tunnel ──▶ bridge :8787 ──▶ Chrome :9222 ──▶ Tern
```

It only reads. Every request to Tern is a `GET`, including the edit forms it
reads for exact values: a `GET` renders a form and saves nothing. It never
clicks, submits, exports or navigates the visible tab.

## What it answers

| Route | Returns |
|---|---|
| `GET /health` | whether the Tern session is alive |
| `GET /contacts/search?q=` | matching contacts, both *my contacts* and *shared with me* |
| `GET /contacts/:id` | one contact: identity, travel IDs and preferences from the edit forms, every profile section raw, and the Trips, Notes, Activity log, Documents, Emails and Form responses tabs |
| `GET /trips/search?q=` | matching trips with owner, client, status and dates |
| `GET /trips/:id` | one trip: travellers (each tied to their Tern contact), overview, settings and the day-by-day itinerary |
| `GET /catalogue` | the option lists it can read |
| `GET /catalogue/:kind` | one list: `loyalty_programs`, `activity_interests`, `food_drink`, `contact_fields`, `other_travel_preferences`, `addresses`, `passports`, `trip_settings` |

Values Blackbook maps come out exact. Everything else comes out as the page's
sections, in order, so a field nobody has mapped yet is still carried.

## Speed

Reads run in parallel, never in a burst: at most three operations at once, each
fetching at most six pages at once, which is about what a person with a few
tabs open does. The last five minutes of contact and trip reads are kept in
memory — never on disk, since they carry passports — and `?prefetch=1` on a
contact starts reading its trips in the background. One client with ten trips
takes about seven seconds; one by one with pauses it took ninety.

`?fresh=1` on a contact or trip skips the memory.

Tern also has an API: `/api/v1/trips/:id` answers `401` rather than `404`, so it
exists and wants credentials a browser session is not. Nothing in the app
issues a key for it. If Tern will give the agency API access, reading through
it would be faster and sturdier than reading pages, and this bridge would
become a thin client for it.

## Signing

Every request carries

```
x-bridge-timestamp: <milliseconds since epoch>
x-bridge-signature: hex(HMAC-SHA256(TERN_BRIDGE_SECRET, "<timestamp>.GET <path-with-query>"))
```

The same pattern vara5.com uses to call Blackbook. The window is five minutes.
Unsigned, expired or tampered requests get `401`; anything but `GET` gets
`405`. The bridge refuses to start without a secret of at least 32 characters.

## Setting up the office machine (Ubuntu)

1. **Chrome with its own profile**, kept apart from anyone's personal browsing:

   ```sh
   google-chrome --remote-debugging-port=9222 \
     --user-data-dir="$HOME/.tern-bridge-profile" \
     https://app.tern.travel
   ```

   Sign in to Tern in that window **by hand**. Leave it running.

   The debugging port reaches only this profile, and only from the machine
   itself: Chrome binds it to localhost. Never expose `9222` to the network.

2. **The bridge**, on Node 22 or later. No dependencies to install:

   ```sh
   cd tern-bridge
   echo "TERN_BRIDGE_SECRET=$(openssl rand -hex 32)" > .env
   npm start
   ```

   Put the same secret in Blackbook's environment as `TERN_BRIDGE_SECRET`.

3. **A tunnel**, so nothing on the office network is opened to the internet:

   ```sh
   cloudflared tunnel --url http://127.0.0.1:8787
   ```

   Use a named tunnel for anything permanent. Its hostname goes in Blackbook
   as `TERN_BRIDGE_URL`.

4. Run Chrome, the bridge and the tunnel as `systemd` services so they come
   back after a reboot. Chrome needs a display; on a headless box run it under
   `xvfb-run`, and reach it for signing in through a remote desktop (noVNC or
   RustDesk), never by opening the debugging port.

5. **Put Cloudflare Access in front of the tunnel** with a service token, and
   give Blackbook the token as `TERN_BRIDGE_ACCESS_ID` and
   `TERN_BRIDGE_ACCESS_SECRET`, which it sends as `CF-Access-Client-Id` and
   `CF-Access-Client-Secret`.
   The tunnel's hostname is then unreachable to anyone without it, before a
   request ever gets to the bridge's own signature check: two locks, and the
   bridge is not even visible without the first.

## When the session ends

Tern signs people out eventually. The bridge then answers `503` with
`"signedOut": true`, and `/health` reports `"signedIn": false`. Sign in again
from the terminal — `node login.mjs` (see DEPLOY-UBUNTU.md) — and nothing else
needs restarting.

## Environment

| Variable | Default | |
|---|---|---|
| `TERN_BRIDGE_SECRET` | none | required, 32+ characters, shared with Blackbook |
| `TERN_BRIDGE_HOST` | `127.0.0.1` | keep it on localhost behind the tunnel |
| `TERN_BRIDGE_PORT` | `8787` | |
| `TERN_CDP_URL` | `http://127.0.0.1:9222` | where the signed-in Chrome listens |

## Care

- It answers with client data, passports included. It logs only the route
  pattern, the status and the time: never a body, a name, an id or a query.
- It reads a few pages at a time and never more: three operations, six pages
  each. Tern is somebody's working session, not a service built for load, and
  a burst from one account is what gets an account flagged.
- Blackbook calls it **on demand**. Nothing here imports in bulk.
