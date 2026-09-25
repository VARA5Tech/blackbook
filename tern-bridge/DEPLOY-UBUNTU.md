# Running the Tern bridge on Ubuntu 26.04 LTS

A start-to-finish guide for a fresh server. At the end you have a headless
machine that stays signed in to Tern and answers Blackbook's signed requests,
with no port open to the internet.

There is no Tern API and no API token to obtain. The "auth" is the ordinary
`_tern_session` cookie a browser gets when a person signs in. This machine
keeps a Chrome signed in; the bridge asks that Chrome to fetch Tern pages, so
the cookie never leaves the browser and is never copied anywhere. You sign in
by hand once, through a remote screen; after that it runs on its own until Tern
eventually expires the session, which is rare.

```
Blackbook (VPS) ──HTTPS, signed──▶ Cloudflare Tunnel+Access ──▶ bridge :8787
                                                                     │
                                            CDP :9222 (localhost) ───┘
                                                                     │
                                     Chrome (signed-in Tern) ────────┘
```

## 0. What you need

- An Ubuntu 26.04 server you can `ssh` into (1 vCPU / 1 GB is enough; 2 GB is
  comfortable — Chrome is the heavy part).
- A Cloudflare account with the Zero Trust (free) plan, and a domain on it.
- 20 minutes.

Everything below is run as a normal user with `sudo`. Replace `bridge` with
your username if different.

## 1. System packages

```sh
sudo apt update && sudo apt -y upgrade
sudo apt -y install curl gnupg xvfb x11vnc fonts-liberation ca-certificates

# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
node -v   # v22.x

# Google Chrome (stable, amd64)
curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update && sudo apt -y install google-chrome-stable
google-chrome --version
```

On an ARM server use Chromium instead: `sudo apt -y install chromium-browser`,
and use `chromium-browser` wherever this guide says `google-chrome`.

## 2. Put the bridge on the machine

Copy just the `tern-bridge/` folder (it has no dependencies to install):

```sh
mkdir -p ~/tern-bridge
# from your laptop, in the repo root:
#   scp -r tern-bridge/* bridge@YOUR_SERVER:~/tern-bridge/
```

Make the shared secret and store the settings. **Use the same secret in
Blackbook's `TERN_BRIDGE_SECRET`.**

```sh
cd ~/tern-bridge
cat > .env <<EOF
TERN_BRIDGE_SECRET=$(openssl rand -hex 32)
TERN_BRIDGE_HOST=127.0.0.1
TERN_BRIDGE_PORT=8787
TERN_CDP_URL=http://127.0.0.1:9222
EOF
chmod 600 .env
cat .env   # copy the secret into Blackbook now
```

## 3. Chrome as a service, on a fake screen

Chrome needs a display even headless-for-real is flaky for a logged-in app, so
run it under `Xvfb` (a virtual screen). A dedicated profile directory is what
makes the Tern login survive restarts — the cookie lives in that folder.

```sh
mkdir -p ~/.tern-profile
sudo tee /etc/systemd/system/tern-chrome.service >/dev/null <<EOF
[Unit]
Description=Chrome for the Tern bridge (virtual display)
After=network-online.target

[Service]
User=$USER
Environment=DISPLAY=:20
# Xvfb provides display :20; Chrome renders into it.
ExecStartPre=/usr/bin/pkill -f "Xvfb :20" ; /bin/true
ExecStart=/usr/bin/xvfb-run -n 20 -s "-screen 0 1280x1024x24" \\
  /usr/bin/google-chrome \\
  --remote-debugging-port=9222 \\
  --remote-debugging-address=127.0.0.1 \\
  --user-data-dir=$HOME/.tern-profile \\
  --no-first-run --no-default-browser-check \\
  --disable-background-networking --disable-features=Translate \\
  https://app.tern.travel
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now tern-chrome
sleep 5
curl -s http://127.0.0.1:9222/json/version | head -c 200; echo
```

The last line should print JSON with a `"Browser"` field. That is the
debugging port, bound to localhost only — never expose 9222.

## 4. Sign in to Tern — from the terminal

`login.mjs` signs the bridge's Chrome in to Tern without any screen. Run it on
the server:

```sh
node ~/tern-bridge/login.mjs
```

It asks for the Tern email and password here in the terminal (the password is
hidden as you type), types them into the sign-in form inside the bridge's
Chrome, and handles a two-factor code if Tern asks for one. On success it
prints `✓ Signed in`. The password is never stored, written to a file or
logged — it goes straight from the prompt into Tern's form.

The session then lives in `~/.tern-profile` and survives reboots. You run this
again only when Tern eventually signs the machine out, which Blackbook tells
you about with a banner.

**If this account signs in with Google** (`login.mjs` will say so), the
terminal cannot drive Google's page. Sign in through a temporary remote screen
instead:

```sh
x11vnc -display :20 -localhost -rfbport 5900 -nopw -once -bg   # on the server
ssh -L 5900:127.0.0.1:5900 bridge@YOUR_SERVER                  # from your laptop
# open a VNC viewer at localhost:5900, sign in, close it (it exits on disconnect)
```

## 5. The bridge as a service

```sh
sudo tee /etc/systemd/system/tern-bridge.service >/dev/null <<EOF
[Unit]
Description=Tern bridge for Blackbook
After=tern-chrome.service
Requires=tern-chrome.service

[Service]
User=$USER
WorkingDirectory=$HOME/tern-bridge
ExecStart=/usr/bin/node --env-file=.env server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now tern-bridge
sudo systemctl status tern-bridge --no-pager | head -5
```

Sanity check locally (this bypasses signing, which is fine on localhost only
for the unsigned paths — `/health` still needs a signature, so expect 401,
which proves the signature gate is on):

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/health   # 401 = gate working
```

## 6. The Cloudflare Tunnel + Access (no open ports)

Install cloudflared and log in:

```sh
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt -y install cloudflared
cloudflared tunnel login          # opens a URL; authorise your domain
cloudflared tunnel create tern-bridge
```

Route a hostname to the bridge and install it as a service:

```sh
cloudflared tunnel route dns vara5server tern-api.vara5.travel

sudo mkdir -p /etc/cloudflared
sudo tee /etc/cloudflared/config.yml >/dev/null <<EOF
tunnel: tern-bridge
credentials-file: /home/$USER/.cloudflared/$(ls ~/.cloudflared | grep json | head -1)
ingress:
  - hostname: tern-api.vara5.travel
    service: http://127.0.0.1:8787
  - service: http_status:404
EOF

sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Now lock the hostname behind a **service token** so only Blackbook can reach it:

1. Cloudflare dashboard → Zero Trust → Access → Service Auth → create a
   **Service Token**. Copy the Client ID and Client Secret.
2. Access → Applications → Add a **self-hosted** application for
   `tern-api.vara5.travel`.
3. Add one policy: Action **Service Auth**, include the service token you made.

Put the token in Blackbook's environment:

```
TERN_BRIDGE_URL=https://tern-api.vara5.travel
TERN_BRIDGE_ACCESS_ID=<client id>.access
TERN_BRIDGE_ACCESS_SECRET=<client secret>
```

Blackbook sends these as `CF-Access-Client-Id` / `CF-Access-Client-Secret`.
Anyone without them gets nothing from the hostname, before a request ever
reaches the bridge's own signature check.

## 7. Confirm from Blackbook

Set the four Blackbook variables (`TERN_BRIDGE_URL`, `TERN_BRIDGE_SECRET`,
`TERN_BRIDGE_ACCESS_ID`, `TERN_BRIDGE_ACCESS_SECRET`) in Dokploy and redeploy.
Open the Clients page: no banner means healthy. Then **Import from Tern**.

## Day to day

- **It runs itself.** Chrome, the bridge and the tunnel are all systemd
  services that restart on failure and after a reboot.
- **When Tern signs the machine out** (rare), Blackbook shows a banner on the
  Clients page. To fix it, repeat step 4 — VNC in, sign in again, disconnect.
  Nothing else restarts.
- **If Tern redesigns a page**, the bridge's `/schema-check` fails and Blackbook
  shows a different banner and refuses imports rather than writing blanks. That
  is the signal the reader needs a code update.
- **Logs**: `journalctl -u tern-bridge -f`. The bridge logs only the route, the
  status and the time — never names, ids, bodies or the query. Nothing to
  redact.

## Why not just copy the cookie?

You can read the `_tern_session` cookie out of the profile and send it from a
plain script. It works until Tern rotates it (often), and a bare script that is
not a real browser can trip Cloudflare's bot checks in front of Tern. Driving a
real signed-in Chrome means the cookie refreshes itself and every request looks
exactly like the browser Tern expects — which is why this is the reliable way,
not the cookie-copy way your first scraper used.
