# Reading the production database

`DATABASE_URL` looks like this:

```
postgresql://postgres:PASSWORD@crm-supabase-ndzmpz-db-1:5432/postgres
```

`crm-supabase-ndzmpz-db-1` is a Docker container name. It resolves on the
Dokploy host's container network and nowhere else on earth. From a laptop it is
not a hostname at all, so there is nothing to connect to with or without a
password.

That is the correct posture for a database holding home addresses, passport
details and children's birthdays. It is also complete blindness, and debugging
production by redeploying and reading logs is not debugging. This document is
how to get the reading back without giving the database a public door.

## Why the obvious fixes are wrong

**Publish port 5432 in Dokploy.** Dokploy runs on Docker Swarm, and Swarm
ignores the host IP in a port binding: published ports always land on
`0.0.0.0`. There is no `127.0.0.1:5432:5432` to be had, so publishing the port
means Postgres answering the open internet, and `ufw` does not help because
Docker writes its own iptables rules. Do not do this.

**Point `crmdb.vara5.travel` at Postgres.** That record goes through
Cloudflare's proxy, which speaks HTTP and HTTPS. Postgres speaks its own binary
protocol on a TCP socket. The proxy has nothing to do with those bytes and
drops them. This is the same reason the direct connection string never worked
from here.

**Use the Supabase service key for the application itself.** Tempting, and it
is how the sibling Falcon service works, but it is a rewrite rather than a
setting. Blackbook's data layer is Drizzle speaking SQL: multi-table
transactions, `tsvector` ranking, trigram search, and an auth library that takes
a Postgres connection and nothing else. PostgREST can serve all of it, but only
with the query logic moved into Postgres functions and the authorization moved
out of the service layer into RLS policies. That is a different application, not
a different connection string. The key remains the right tool for operators and
for diagnosis, which is what Option A is.

## Option A: the Supabase API (nothing to install, works today)

Blackbook shares its database with a Supabase stack, and that stack is already
published over HTTPS. Two doors come with it, and both work from anywhere:

```
POST https://crmdb.vara5.travel/pg/query
     {"query": "select ..."}
     headers: apikey + Authorization: Bearer <service role key>
```

That is postgres-meta, and it runs arbitrary SQL as the `postgres` role. Full
console, including DDL. Verified against the live stack.

```
GET  https://crmdb.vara5.travel/rest/v1/customer?select=id,ref&limit=10
```

That is PostgREST. It binds parameters properly, so it is the safe door for
anything taking user input.

Two things to know about the difference, because it decides which to use.

**`/pg/query` does not bind parameters.** `{"query":"select $1","params":[…]}`
answers `42P02: there is no parameter $1`. Values would have to be pasted into
the SQL text, which is an injection hole. Fine for an operator writing their own
SQL by hand. Never for application code.

**The service role key is not merely a read key.** It reaches `/pg/query`, so it
executes arbitrary SQL as `postgres`, schema included. Treat it as a root
password: server-side only, never `NEXT_PUBLIC_`, never in a browser bundle,
never committed. Kong rejects requests carrying no key at all, and the anon key
is refused by the RLS lock, so the service key is the whole of the perimeter.

This is why the tunnel below is optional rather than necessary. It buys local
Postgres *tooling* (Drizzle Studio, `psql`, `pnpm db:query:prod`), not access.

## Option B: Supabase Studio (nothing to install)

Studio is already deployed at `https://crmdb.vara5.travel` and has a SQL
editor. It runs over HTTPS, so Cloudflare's proxy is happy, and it can read and
write anything.

Use it for a quick look, a one-off count, or a data repair. It gives no local
tooling: no `pnpm db:query:prod`, no Drizzle Studio, no migrations from a
laptop.

One failure mode worth knowing, because it looks like a bug in the application.
Studio executes statements as its own role, so a schema pasted into the SQL
editor can end up owned by a role the application is not. Every table in
`public` has row-level security enabled with no policies; the owner bypasses
RLS and a non-owner without `BYPASSRLS` does not. The result is a database
where the tables plainly exist and the application reads nothing.

`scripts/sql/grants.sql` prints owner, RLS and privilege for every table at
once. Run it through Option A, or as `pnpm db:grants:prod` over a tunnel. On
this deployment it came back clean: all tables owned by `postgres`, which holds
`BYPASSRLS`.

## Option C: Cloudflare Tunnel (local Postgres tooling)

Cloudflare Tunnel carries arbitrary TCP inside an HTTPS/WebSocket connection,
which is exactly the gap the plain proxy leaves. `cloudflared` runs on both
ends: a container next to the database, and a command on the laptop that opens
a local port.

Nothing is published. The tunnel dials out from the server, so no inbound port
opens anywhere.

### 1. Create the tunnel

In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels → Create a
tunnel**, type `cloudflared`. Name it something like `vara5-db`. Copy the token
it gives you.

### 2. Run `cloudflared` inside the Supabase stack's network

Add this as a service in the same Dokploy stack as the Supabase compose file,
so it joins the same network and can resolve the container by name. That name
resolution is the whole point: no host port, no IP address to go stale.

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
```

Put the token in the stack's environment in Dokploy, not in the compose file.

### 3. Add a public hostname of type TCP

Back in the tunnel's configuration, **Published application routes → Add a
public hostname**:

| Field | Value |
| --- | --- |
| Subdomain | `pgdb` |
| Domain | `vara5.travel` |
| Type | `TCP` |
| URL | `crm-supabase-ndzmpz-db-1:5432` |

Cloudflare creates the DNS record itself, proxied. Leave it proxied: the proxy
is what terminates the HTTPS the tunnel travels inside.

### 4. Put Access in front of it

**This step is not optional.** Without it, anyone who guesses the hostname can
open a tunnel to the database and only the Postgres password stands between
them and the client list.

**Zero Trust → Access → Applications → Add an application → Self-hosted**,
domain `pgdb.vara5.travel`. Add one policy, action Allow, with a rule of
`Emails` and your own address, or `Emails ending in` `@vara5.com` for the team.
Nothing else.

### 5. Connect from the laptop

Install `cloudflared` once:

```bash
winget install --id Cloudflare.cloudflared
```

Open the forwarded port, and leave it running in its own terminal:

```bash
cloudflared access tcp --hostname pgdb.vara5.travel --url 127.0.0.1:6543
```

The first run opens a browser to authenticate against the Access policy. After
that, `127.0.0.1:6543` is the production database.

### 6. Tell the project about it

In `.env.local`:

```
PROD_TUNNEL_DATABASE_URL="postgresql://postgres:PASSWORD@127.0.0.1:6543/postgres"
```

Then:

```bash
pnpm db:check:prod
pnpm db:grants:prod
pnpm db:query:prod "select kind, count(*) from preference_option group by kind"
pnpm db:studio:prod
```

## What this cannot become by accident

`PROD_TUNNEL_DATABASE_URL` says `127.0.0.1`, and the guard rails do not believe
it.

- The running application never reads it. `resolveRuntimeDatabaseUrl` has no
  tunnel case at all, so a tunnel can never become the production connection.
- The test suite and the seed refuse it by identity, not by hostname. They drop
  tables and write fixture accounts; `assertSafeToMutate` checks the URL
  against both production variables before it looks at the host, so a tunnel
  that looks local is still rejected.
- `pnpm db:query:prod` sets the transaction `read only` before sending
  anything. Postgres refuses the write, with SQLSTATE `25006`. `--write`
  against production additionally needs `ALLOW_PROD_WRITE_QUERY` typed out in
  full, and it should stay unused: changes to live data belong in a migration
  or in the application, where they are reviewed and leave an audit row.
- `pnpm db:migrate:prod` still works and still applies only what is in
  `drizzle/`.

## Sources

- [Using Cloudflare Tunnel and Access with Postgres](https://blog.cloudflare.com/cloudflare-tunnel-for-postgres/)
- [Cloudflare Tunnel documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- [TCP tunneling with Cloudflare Tunnel](https://ryan-schachte.com/blog/cf_tunnel_tcp/)
- [Swarm mode publishes ports on 0.0.0.0 regardless of the host IP given](https://github.com/moby/moby/issues/32299)
