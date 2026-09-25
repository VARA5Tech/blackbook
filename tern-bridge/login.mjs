// Sign the bridge's Chrome in to Tern, from the terminal.
//
// Run this on the machine that runs the bridge, whenever Blackbook says Tern
// has signed the desk out:
//
//   node login.mjs
//
// It asks for the Tern email and password here in the terminal, types them
// into the sign-in form inside the bridge's own Chrome, and submits. The
// browser handles the session cookie itself, exactly as if a person had typed
// it into a window. The password is never stored, never written to a file, and
// never logged — it goes straight from this prompt into Tern's form.
//
// No dependencies. Talks to Chrome over the DevTools protocol on localhost.
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";

const CDP = process.env.TERN_CDP_URL ?? "http://127.0.0.1:9222";
const ORIGIN = "https://app.tern.travel";

/* ------------------------------------------------------------ terminal input */

function ask(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

/** Reads a line without echoing it, so a password never appears on screen. */
function askHidden(question) {
  return new Promise((resolve) => {
    stdout.write(question);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    let value = "";
    const onData = (chunk) => {
      const s = chunk.toString("utf8");
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode?.(wasRaw);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") { stdout.write("\n"); process.exit(130); } // Ctrl-C
        if (ch === "\u007f" || ch === "\b") { value = value.slice(0, -1); continue; }
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

/* ------------------------------------------------------------ chrome */

let socket;
let nextId = 1;
const pending = new Map();

async function ternTab() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  let tab = list.find((t) => t.type === "page" && t.url.startsWith(ORIGIN));
  if (!tab) tab = list.find((t) => t.type === "page");
  if (!tab) throw new Error(`No browser tab found on ${CDP}. Is the tern-chrome service running?`);
  return tab;
}

async function connect() {
  const tab = await ternTab();
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = () => rej(new Error("Could not reach Chrome over the DevTools protocol.")); });
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const w = pending.get(msg.id);
    if (!w) return;
    pending.delete(msg.id);
    if (msg.error) return w.reject(new Error(msg.error.message));
    if (msg.result?.exceptionDetails) return w.reject(new Error(msg.result.exceptionDetails.exception?.description ?? "page error"));
    w.resolve(msg.result?.result?.value);
  };
}

function evaluate(expression) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Where the tab is now, and whether it looks signed in. */
function state() {
  return evaluate(`(() => ({
    url: location.href,
    signedIn: !/\\/session|\\/sign_in|\\/login/.test(location.pathname) && !document.querySelector('input[name="password"]'),
    hasPasswordForm: Boolean(document.querySelector('form[action="/session"] input[name="password"]')),
    error: (document.querySelector('.flash, [role=alert], .text-red-600, .text-error')?.innerText || '').trim().slice(0, 200),
    twoFactor: Boolean(document.querySelector('input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"]')),
  }))()`);
}

/* ------------------------------------------------------------ flow */

async function main() {
  console.log("Signing the Tern bridge in to Tern.\n");
  await connect();

  // Make sure we are on the sign-in page.
  await evaluate(`location.href = ${JSON.stringify(`${ORIGIN}/session/new`)}`);
  await sleep(2500);

  let s = await state();
  if (s.signedIn) {
    console.log("Already signed in. Nothing to do.");
    process.exit(0);
  }
  if (!s.hasPasswordForm) {
    console.log(`The page does not show a password form (it is at ${s.url}).`);
    console.log("If Tern uses Google sign-in for this account, sign in through a remote screen instead — see DEPLOY-UBUNTU.md step 4.");
    process.exit(1);
  }

  const email = await ask("Tern email: ");
  const password = await askHidden("Tern password (hidden): ");
  if (!email || !password) { console.log("Email and password are both required."); process.exit(1); }

  // Fill and submit the real form, so Chrome handles the cookie and redirects.
  await evaluate(`(() => {
    const form = document.querySelector('form[action="/session"]');
    form.querySelector('input[name="email"]').value = ${JSON.stringify(email)};
    form.querySelector('input[name="password"]').value = ${JSON.stringify(password)};
    form.requestSubmit ? form.requestSubmit() : form.submit();
    return true;
  })()`);

  // Poll until signed in, the two-factor step appears, or an error shows.
  // The code is asked for once; after it is submitted the loop keeps waiting
  // for the dashboard rather than asking again, because the page navigates a
  // moment later and a stale prompt was the old bug.
  let twoFactorAsked = false;

  const settle = async (label) => {
    process.stdout.write(label);
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      process.stdout.write(".");
      const now = await state();
      if (now.signedIn) return "in";
      if (now.error) return now.error;
      if (now.twoFactor && !twoFactorAsked) return "2fa";
    }
    return "timeout";
  };

  let outcome = await settle("Signing in");

  if (outcome === "2fa") {
    twoFactorAsked = true;
    console.log("\n");
    const code = await ask("Two-factor code from your app or SMS: ");
    /*
     * Fill the code only if the input is still there. Once Tern accepts it the
     * page navigates and the input is gone; setting a value on nothing is what
     * crashed before, so a missing input just means "already moving on".
     */
    await evaluate(`(() => {
      const i = document.querySelector('input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"]');
      if (!i) return "gone";
      i.value = ${JSON.stringify(code)};
      const f = i.closest("form") || document.querySelector("form");
      f && (f.requestSubmit ? f.requestSubmit() : f.submit());
      return "submitted";
    })()`).catch(() => {});
    outcome = await settle("Checking the code");
  }

  if (outcome === "in") { console.log("\n\n✓ Signed in. The bridge can now read Tern."); process.exit(0); }

  s = await state();
  if (s.signedIn) { console.log("\n\n✓ Signed in. The bridge can now read Tern."); process.exit(0); }
  if (outcome === "timeout") console.log(`\n\n✗ Did not reach the dashboard. The tab is at ${s.url}. Check the details and run it again.`);
  else console.log(`\n\n✗ Tern said: ${outcome}`);
  process.exit(1);
}

main().catch((error) => { console.error(`\nCould not sign in: ${error.message}`); process.exit(1); });
