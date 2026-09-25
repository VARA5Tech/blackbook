import { createHash, createHmac, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as privateAccessLookup } from "@/app/api/private-access/lookup/route";
import { auth } from "@/auth";
import { db } from "@/db";
import { accounts, customers, users, verifications } from "@/db/schema";
import {
  EMAIL_CODE_MINUTES,
  STAFF_DOMAIN_MESSAGE,
  isStaffEmail,
  normaliseStaffEmail,
  staffEmailLocalPart,
  staffEmailSchema,
} from "@/domain/staff";
import {
  EMAIL_MONOGRAM_URL,
  EmailNotConfiguredError,
  signInCodeEmail,
  sendEmail,
  staffInvitationEmail,
} from "@/lib/email";
import { POST as privateAccessInterest } from "@/app/api/private-access/interest/route";
import {
  archiveCustomer,
  createCustomer,
  DomainError,
  getClient360,
  getClientInterest,
  lookupPrivateAccessGuest,
  updateCustomer,
} from "@/services/client-service";
import {
  createStaffUser,
  inviteStaff,
  listAllUsers,
  listStaff,
  purgeExpiredInvitations,
  resendInvitation,
  revokeInvitation,
} from "@/services/user-service";
import { actingAs, resetData, seedStaff, type StaffFixtures } from "./helpers";

/**
 * Getting into Blackbook: who may hold an account, joining by invitation, and
 * the emails behind them. Nothing here reaches Resend; the test setup blanks the
 * key, so every email is printed instead and read back.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

describe("sign-in code email", () => {
  const email = signInCodeEmail({ code: "704155" });

  it("carries the code in both the HTML and the plain-text versions", () => {
    expect(email.html).toContain("704155");
    expect(email.text).toContain("704155");
  });

  it("says how long the code works, matching the auth configuration", () => {
    expect(email.text).toContain(`${EMAIL_CODE_MINUTES} minutes`);
    expect(email.html).toContain(`${EMAIL_CODE_MINUTES} minutes`);
  });

  /**
   * A link in a mailbox is a credential a scanner or a preview pane can spend.
   * A six-digit code is useless without the browser that asked for it.
   */
  it("offers a code and never a link that would sign somebody in", () => {
    expect(email.html).not.toMatch(/href="https?:\/\/[^"]*(sign-in|invite|token)/i);
    expect(email.text).not.toMatch(/https?:\/\/\S*(sign-in|invite|token)/i);
  });

  it("says plainly what it is for", () => {
    expect(email.subject).toMatch(/sign[- ]in/i);
  });
});

describe("sending email", () => {
  const message = {
    to: "someone@vara5.com",
    subject: "Your Blackbook password reset code",
    html: "<p>482913</p>",
    text: "Your code is 482913",
    category: "password-reset",
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("refuses in production when Resend is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");

    await expect(sendEmail(message)).rejects.toThrow(EmailNotConfiguredError);
  });

  it("prints the email instead of sending it in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "");
    const printed = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(sendEmail(message)).resolves.toEqual({ sent: false });
    expect(String(printed.mock.calls[0][0])).toContain("482913");
  });
});

describe("who can hold an account", () => {
  let staff: StaffFixtures;

  beforeAll(async () => {
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
  });

  it("completes a bare name and accepts a pasted Vara5 address", () => {
    expect(normaliseStaffEmail("Priya.Nair")).toBe("priya.nair@vara5.com");
    expect(staffEmailSchema.parse(" Priya.Nair@VARA5.com ")).toBe("priya.nair@vara5.com");
    expect(staffEmailLocalPart("Priya.Nair@Vara5.com")).toBe("Priya.Nair");
    expect(staffEmailLocalPart("priya@gmail.com")).toBe("priya@gmail.com");
  });

  it("refuses every other domain, including subdomains and lookalikes", () => {
    for (const email of [
      "priya@gmail.com",
      "priya@vara5.com.example.net",
      "priya@mail.vara5.com",
      "priya@vara5.co",
      "priya@notvara5.com",
      "a@b@vara5.com",
      "@vara5.com",
    ]) {
      expect(isStaffEmail(email), email).toBe(false);
      expect(staffEmailSchema.safeParse(email).success, email).toBe(false);
    }
  });

  it("is enforced by the services, not only by the form", async () => {
    actingAs(staff.admin);

    await expect(
      createStaffUser({
        name: "Outsider",
        email: "outsider@gmail.com",
        role: "rm",
      }),
    ).rejects.toThrow(STAFF_DOMAIN_MESSAGE);

    await expect(
      inviteStaff({ name: "Outsider", email: "outsider@gmail.com", role: "rm" }),
    ).rejects.toThrow(STAFF_DOMAIN_MESSAGE);

    expect(
      await db.query.users.findFirst({ where: eq(users.email, "outsider@gmail.com") }),
    ).toBeUndefined();
  });

  it("is enforced by Better Auth for sign-in and for any account it writes", async () => {
    await expect(
      auth.api.signInEmail({
        body: { email: "someone@gmail.com", password: "a-sufficiently-long-password" },
      }),
    ).rejects.toThrow(STAFF_DOMAIN_MESSAGE);

    const context = await auth.$context;
    await expect(
      context.internalAdapter.createUser(
        { name: "Someone", email: "someone@gmail.com", emailVerified: true },
        { method: "admin" },
      ),
    ).rejects.toThrow(STAFF_DOMAIN_MESSAGE);
  });
});

/**
 * A live sign-in code is a credential for ten minutes. Whoever can read
 * `app_verification` — a backup, the Supabase service key, a psql session —
 * must not be able to read one back out of it.
 */
describe("signing in by emailed code", () => {
  const email = "code.test@vara5.com";
  let staff: StaffFixtures;

  beforeAll(async () => {
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
    // Accounts outlive resetData, so the first test's one is still here.
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!existing) await createStaffUser({ name: "Code Test", email, role: "rm" });
    await db.delete(verifications);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Asks for a code and reads it back out of the printed email. */
  async function requestCode(): Promise<string> {
    const printed = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    const output = printed.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    vi.restoreAllMocks();
    const code = /\b(\d{6})\b/.exec(output)?.[1];
    if (!code) throw new Error("No sign-in code was printed");
    return code;
  }

  async function storedValue(): Promise<string> {
    const rows = await db.select().from(verifications);
    const row = rows.find((r) => r.identifier.endsWith(email));
    if (!row) throw new Error("No verification row for the address");
    // Better Auth keeps "<stored code>:<attempts>".
    return row.value.slice(0, row.value.lastIndexOf(":"));
  }

  it("never keeps the code itself, nor a bare hash anyone could reverse", async () => {
    const code = await requestCode();
    const stored = await storedValue();

    expect(stored).not.toContain(code);
    // A plain SHA-256 of six digits is a million-entry lookup table away.
    const bare = createHash("sha256").update(code).digest("base64url");
    expect(stored).not.toBe(bare);
  });

  it("still signs someone in with the right code, and refuses a wrong one", async () => {
    const code = await requestCode();
    const wrong = code === "000000" ? "111111" : "000000";

    await expect(
      auth.api.signInEmailOTP({ body: { email, otp: wrong } }),
    ).rejects.toThrow();

    const signedIn = await auth.api.signInEmailOTP({ body: { email, otp: code } });
    expect(signedIn.user.email).toBe(email);
  });
});

describe("joining by invitation", () => {
  let staff: StaffFixtures;

  beforeAll(async () => {
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  

  async function invite(local: string) {
    return inviteStaff({ name: "Priya Nair", email: local, role: "rm" });
  }


  const lookUp = (id: string) => db.query.users.findFirst({ where: eq(users.id, id) });

  /**
   * The signal is `emailVerified`, and it is the only one left: nobody has a
   * password to hold an account open. An invitation nobody uses lapses; an
   * account somebody has signed in to has proved its address and stays.
   */
  it("deletes an invited account nobody used within two days, and nothing else", async () => {
    const stale = await invite(`stale-${randomUUID()}`);
    const fresh = await invite(`fresh-${randomUUID()}`);
    const established = await createStaffUser({
      name: "Established",
      email: `established-${randomUUID()}`,
      role: "rm",
    });

    const threeDaysAgo = new Date(Date.now() - 3 * DAY_MS);
    await db.update(users).set({ createdAt: threeDaysAgo }).where(eq(users.id, stale.id));
    // Just as old, but this one has signed in, which is what verified it.
    await db
      .update(users)
      .set({ createdAt: threeDaysAgo })
      .where(eq(users.id, established.id));

    await purgeExpiredInvitations();

    expect(await lookUp(stale.id)).toBeUndefined();
    expect(await lookUp(fresh.id)).toBeDefined();
    expect(await lookUp(established.id)).toBeDefined();
  });

  /**
   * An invitation is now only an account nobody has used yet: no link, no
   * token, nothing to set up. Team has to be able to tell that state apart, or
   * an administrator cannot see who has actually arrived.
   */
  it("shows an invited colleague as invited, with nothing to sign in with", async () => {
    const { id, email } = await invite(`pending-${randomUUID()}`);

    const row = await lookUp(id);
    expect(row?.emailVerified).toBe(false);

    const credentials = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, id));
    expect(credentials).toHaveLength(0);

    const listed = (await listAllUsers()).find((user) => user.email === email);
    expect(listed?.inviteExpiresAt).toBeInstanceOf(Date);

    // Not yet somebody a client can be assigned to.
    expect((await listStaff()).some((member) => member.id === id)).toBe(false);
  });

  it("restarts the window when the invitation is sent again", async () => {
    const { id } = await invite(`resent-${randomUUID()}`);
    const threeDaysAgo = new Date(Date.now() - 3 * DAY_MS);
    await db.update(users).set({ createdAt: threeDaysAgo }).where(eq(users.id, id));

    await resendInvitation(id);
    await purgeExpiredInvitations();

    expect(await lookUp(id)).toBeDefined();
  });

  it("deletes the invited account when withdrawn", async () => {
    const { id } = await invite(`withdrawn-${randomUUID()}`);
    await revokeInvitation(id);
    expect(await lookUp(id)).toBeUndefined();
  });

  it("will not invite an address that already has an account or an open invitation", async () => {
    const email = `existing-${randomUUID()}@vara5.com`;
    await createStaffUser({
      name: "Existing",
      email,
      role: "rm",
    });
    await expect(inviteStaff({ name: "Existing", email, role: "rm" })).rejects.toThrow(DomainError);

    const open = await invite(`open-${randomUUID()}`);
    await expect(
      inviteStaff({ name: "Again", email: open.email, role: "rm" }),
    ).rejects.toThrow(DomainError);
  });

  it("writes an invitation email that names the role, the lapse and escapes the name", () => {
    const message = staffInvitationEmail({
      name: "<b>Priya</b> Nair",
      invitedBy: "Sudhansu",
      roleLabel: "Relationship Manager",
      signInUrl: "https://blackbook.vara5.travel/sign-in",
    });
    expect(message.html).toContain("https://blackbook.vara5.travel/sign-in");
    expect(message.text).toContain("https://blackbook.vara5.travel/sign-in");
    expect(message.text).toContain("Relationship Manager");
    expect(message.text).toContain("2 days");
    expect(message.html).not.toContain("<b>Priya</b>");
    expect(message.html).toContain(EMAIL_MONOGRAM_URL);
  });
});

/**
 * Guests getting into vara5.com's private Inspirations: the website asks
 * Blackbook whether a number belongs to an active client, signing every request
 * with a secret only the two of them hold.
 */
describe("private access lookup for the website", () => {
  const SECRET = "test-private-access-secret-of-a-realistic-length";
  const since = "2026-01-01";
  let staff: StaffFixtures;

  beforeAll(async () => {
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
    vi.stubEnv("PRIVATE_ACCESS_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** A request signed the way the website signs it. */
  function signed(
    body: unknown,
    { secret = SECRET, timestamp = Math.floor(Date.now() / 1000) } = {},
  ) {
    const raw = JSON.stringify(body);
    const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
    return new Request("http://localhost/api/private-access/lookup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-blackbook-timestamp": String(timestamp),
        "x-blackbook-signature": `v1=${signature}`,
      },
      body: raw,
    });
  }

  async function lookup(request: Request) {
    const response = await privateAccessLookup(request);
    return { status: response.status, body: await response.json() };
  }

  it("names an active client and the number to send their code to, and nothing else", async () => {
    const client = await createCustomer({
      firstName: "Priya",
      lastName: "Nair",
      preferredName: "Pri",
      mobile: "+91 98100 11223",
      whatsapp: "+91 98100 99887",
      email: "priya@example.com",
      city: "Delhi",
      customerSince: since,
    });

    const { status, body } = await lookup(signed({ phone: "+919810011223" }));

    expect(status).toBe(200);
    // The id is the website's session key and its analytics identity; the phone
    // is the handset they are holding; the email is the fallback when WhatsApp
    // refuses the message. Nothing else about the client leaves.
    expect(body).toEqual({
      found: true,
      id: client.id,
      ref: client.ref,
      name: "Pri",
      phone: "+919810011223",
      email: "priya@example.com",
    });
  });

  /**
   * The website re-checks by id on every page load, so staff correcting a
   * client's number mid-session cannot sign that client out of the site.
   */
  it("answers by customer id, and stops the moment the client is archived", async () => {
    const client = await createCustomer({
      firstName: "Priya",
      mobile: "+91 98100 11223",
      customerSince: since,
    });

    expect((await lookup(signed({ customerId: client.id }))).body).toMatchObject({
      found: true,
      id: client.id,
      ref: client.ref,
      name: "Priya",
    });

    // A staff edit to the number leaves the same client findable by id.
    await updateCustomer({ id: client.id, mobile: "+91 98100 44556" });
    expect((await lookup(signed({ customerId: client.id }))).body).toMatchObject({
      found: true,
      id: client.id,
    });

    await archiveCustomer(client.id);
    expect((await lookup(signed({ customerId: client.id }))).body).toEqual({
      found: false,
    });
  });

  it("refuses a request that names neither a number nor a client", async () => {
    expect((await lookup(signed({}))).status).toBe(400);
    expect((await lookup(signed({ customerId: "not-a-uuid" }))).body).toEqual({
      found: false,
    });
  });

  it("sends to whichever of the client's own numbers was typed", async () => {
    await createCustomer({
      firstName: "Rishabh",
      mobile: "+91 95600 76361",
      whatsapp: "+91 92055 90866",
      customerSince: since,
    });

    // Both numbers belong to the same client, and either is a valid destination.
    expect((await lookup(signed({ phone: "+919560076361" }))).body).toMatchObject({
      found: true,
      name: "Rishabh",
      phone: "+919560076361",
      email: null,
    });
    expect((await lookup(signed({ phone: "+919205590866" }))).body).toMatchObject({
      found: true,
      name: "Rishabh",
      phone: "+919205590866",
      email: null,
    });
  });

  it("matches a client who has only one of the two numbers on file", async () => {
    await createCustomer({ firstName: "Arjun", mobile: "+65 8123 4567", customerSince: since });
    await createCustomer({ firstName: "Meera", whatsapp: "+971 50 123 4567", customerSince: since });

    expect((await lookup(signed({ phone: "+6581234567" }))).body).toMatchObject({
      found: true,
      name: "Arjun",
      phone: "+6581234567",
      email: null,
    });
    expect((await lookup(signed({ phone: "+971501234567" }))).body).toMatchObject({
      found: true,
      name: "Meera",
      phone: "+971501234567",
      email: null,
    });
  });

  it("never guesses a country: the same digits under another country code find nobody", async () => {
    await createCustomer({ firstName: "Priya", mobile: "+91 98100 11223", customerSince: since });
    expect((await lookup(signed({ phone: "+19810011223" }))).body).toEqual({ found: false });
  });

  it("keeps archived and inactive clients out", async () => {
    const archived = await createCustomer({
      firstName: "Archived",
      mobile: "+91 98100 11111",
      customerSince: since,
    });
    await archiveCustomer(archived.id);
    await createCustomer({
      firstName: "Inactive",
      mobile: "+91 98100 22222",
      status: "inactive",
      customerSince: since,
    });

    expect((await lookup(signed({ phone: "+919810011111" }))).body).toEqual({ found: false });
    expect((await lookup(signed({ phone: "+919810022222" }))).body).toEqual({ found: false });
  });

  it("refuses a number two clients share rather than choosing one", async () => {
    // Both the service and the table now refuse this, so a pair like it can
    // only pre-date the rule. The trigger comes off to recreate one.
    await db.execute(sql`alter table customer disable trigger customer_phone_is_unique`);
    try {
      await db.insert(customers).values([
        { firstName: "One", whatsapp: "+91 98100 33333", customerSince: since },
        { firstName: "Two", whatsapp: "+91 98100 33333", customerSince: since },
      ]);
    } finally {
      await db.execute(sql`alter table customer enable trigger customer_phone_is_unique`);
    }

    expect((await lookup(signed({ phone: "+919810033333" }))).body).toEqual({ found: false });
  });

  it("refuses a request not signed with the shared secret", async () => {
    await createCustomer({ firstName: "Priya", mobile: "+91 98100 11223", customerSince: since });

    const wrongSecret = await lookup(
      signed({ phone: "+919810011223" }, { secret: "someone-elses-secret-of-a-similar-length-too" }),
    );
    expect(wrongSecret).toEqual({ status: 401, body: { error: "unauthorised" } });

    const unsigned = await lookup(
      new Request("http://localhost/api/private-access/lookup", {
        method: "POST",
        body: JSON.stringify({ phone: "+919810011223" }),
      }),
    );
    expect(unsigned.status).toBe(401);
  });

  it("refuses a signature more than five minutes old, so a captured request cannot be replayed later", async () => {
    const stale = await lookup(
      signed({ phone: "+919810011223" }, { timestamp: Math.floor(Date.now() / 1000) - 6 * 60 }),
    );
    expect(stale.status).toBe(401);
  });

  it("refuses a body changed after it was signed", async () => {
    const original = signed({ phone: "+919810011223" });
    const tampered = new Request(original.url, {
      method: "POST",
      headers: original.headers,
      body: JSON.stringify({ phone: "+919810099999" }),
    });
    expect((await lookup(tampered)).status).toBe(401);
  });

  it("stays closed when the secret is not configured", async () => {
    vi.stubEnv("PRIVATE_ACCESS_SECRET", "");
    expect((await lookup(signed({ phone: "+919810011223" }))).status).toBe(503);
  });

  it("wants the number with its country code", async () => {
    expect((await lookup(signed({ phone: "9810011223" }))).status).toBe(400);
  });
});

/**
 * What a client reads on vara5.com, reported back through the same signed
 * channel so the desk sees it in Blackbook rather than in an analytics tool.
 */
describe("interest reported by the website", () => {
  const SECRET = "test-private-access-secret-of-a-realistic-length";
  const since = "2026-01-01";
  let staff: StaffFixtures;

  beforeAll(async () => {
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
    vi.stubEnv("PRIVATE_ACCESS_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function signed(body: unknown, secret = SECRET) {
    const raw = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
    return new Request("http://localhost/api/private-access/interest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-blackbook-timestamp": String(timestamp),
        "x-blackbook-signature": `v1=${signature}`,
      },
      body: raw,
    });
  }

  async function report(body: unknown, secret = SECRET) {
    const response = await privateAccessInterest(signed(body, secret));
    return { status: response.status, body: await response.json() };
  }

  const antarctica = {
    destination: "antarctica",
    title: "Antarctica — White Silence",
  };

  it("builds one line per journey: opens, reading time, and the ask", async () => {
    const client = await createCustomer({
      firstName: "Priya",
      mobile: "+91 98100 11223",
      customerSince: since,
    });

    await report({ ...antarctica, customerId: client.id, kind: "opened" });
    await report({ ...antarctica, customerId: client.id, kind: "opened" });
    await report({ ...antarctica, customerId: client.id, kind: "read", seconds: 184 });
    await report({ ...antarctica, customerId: client.id, kind: "read", seconds: 96 });
    await report({ ...antarctica, customerId: client.id, kind: "video", seconds: 40 });
    await report({ ...antarctica, customerId: client.id, kind: "cta_clicked" });
    await report({
      customerId: client.id,
      destination: "courchevel",
      title: "Courchevel — Above the Cloud",
      kind: "opened",
    });

    const interest = await getClientInterest(client.id);

    // The journey they asked about leads, whatever else they read.
    expect(interest[0]).toMatchObject({
      destination: "antarctica",
      title: "Antarctica — White Silence",
      opens: 2,
      seconds: 280,
      videos: 1,
    });
    expect(interest[0].askedAt).toBeInstanceOf(Date);
    expect(interest[1]).toMatchObject({ destination: "courchevel", opens: 1, seconds: 0 });
    expect(interest[1].askedAt).toBeNull();
  });

  /** A curator needs the ask on the timeline. The reading would bury it. */
  it("puts only the Curator click on the timeline", async () => {
    const client = await createCustomer({
      firstName: "Priya",
      mobile: "+91 98100 11223",
      customerSince: since,
    });

    await report({ ...antarctica, customerId: client.id, kind: "opened" });
    await report({ ...antarctica, customerId: client.id, kind: "read", seconds: 120 });
    await report({ ...antarctica, customerId: client.id, kind: "cta_clicked" });

    const record = await getClient360(client.id);
    const summaries = record?.timeline.map((entry) => entry.summary) ?? [];

    expect(summaries).toContain("Texted the Curator about Antarctica — White Silence");
    // Three things were reported; only the ask belongs on the timeline.
    expect(summaries.filter((line) => line.includes("Curator"))).toHaveLength(1);
  });

  it("records nothing for a client who is archived, inactive or unknown", async () => {
    const archived = await createCustomer({
      firstName: "Archived",
      mobile: "+91 98100 22222",
      customerSince: since,
    });
    await archiveCustomer(archived.id);
    const inactive = await createCustomer({
      firstName: "Inactive",
      mobile: "+91 98100 33333",
      status: "inactive",
      customerSince: since,
    });

    expect((await report({ ...antarctica, customerId: archived.id, kind: "opened" })).body).toEqual({
      recorded: false,
    });
    expect((await report({ ...antarctica, customerId: inactive.id, kind: "opened" })).body).toEqual({
      recorded: false,
    });
    expect(
      (await report({ ...antarctica, customerId: randomUUID(), kind: "opened" })).body,
    ).toEqual({ recorded: false });

    expect(await getClientInterest(archived.id)).toHaveLength(0);
  });

  /**
   * A record marked `staff` exists so somebody at the desk can sign in and
   * check the site. They get through the gate like anybody else, and nothing
   * they do reaches the interest table, because it would be testing sitting in
   * the column the desk reads for demand.
   */
  it("lets a staff record through the gate", async () => {
    const tester = await createCustomer({
      firstName: "Tester",
      mobile: "+91 98100 44444",
      status: "staff",
      customerSince: since,
    });

    const guest = await lookupPrivateAccessGuest("+91 98100 44444");

    expect(guest).toMatchObject({ id: tester.id, name: "Tester" });
  });

  it("records nothing a staff record does on the site", async () => {
    const tester = await createCustomer({
      firstName: "Tester",
      mobile: "+91 98100 55555",
      status: "staff",
      customerSince: since,
    });

    expect((await report({ ...antarctica, customerId: tester.id, kind: "opened" })).body).toEqual({
      recorded: false,
    });
    // Even the Curator click, which is the one thing that reaches the timeline.
    expect(
      (await report({ ...antarctica, customerId: tester.id, kind: "cta_clicked" })).body,
    ).toEqual({ recorded: false });

    expect(await getClientInterest(tester.id)).toHaveLength(0);

    const record = await getClient360(tester.id);
    expect(record?.timeline.some((entry) => entry.summary.includes("Curator"))).toBe(false);
  });

  it("refuses an unsigned or wrongly signed report, and a nonsense kind", async () => {
    const client = await createCustomer({
      firstName: "Priya",
      mobile: "+91 98100 11223",
      customerSince: since,
    });

    const wrongSecret = await report(
      { ...antarctica, customerId: client.id, kind: "opened" },
      "someone-elses-secret-of-a-similar-length-too",
    );
    expect(wrongSecret).toEqual({ status: 401, body: { error: "unauthorised" } });

    const unsigned = await privateAccessInterest(
      new Request("http://localhost/api/private-access/interest", {
        method: "POST",
        body: JSON.stringify({ ...antarctica, customerId: client.id, kind: "opened" }),
      }),
    );
    expect(unsigned.status).toBe(401);

    expect((await report({ ...antarctica, customerId: client.id, kind: "hacked" })).body).toEqual({
      recorded: false,
    });
    expect(await getClientInterest(client.id)).toHaveLength(0);
  });
});

/**
 * The gate refuses a number two clients share rather than guessing between
 * them, so a collision locks both of them out of vara5.com. The service
 * checks for one; these cases go around it, straight to the table, the way an
 * import or a hand-written statement would.
 */
describe("one number, one client", () => {
  const since = "2026-01-01";
  let staff: StaffFixtures;

  beforeAll(async () => {
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
    actingAs(staff.admin);
  });

  /** Runs a statement expected to fail and hands back what Postgres said. */
  async function refusal(statement: Promise<unknown>): Promise<string> {
    try {
      await statement;
      return "";
    } catch (error) {
      return String((error as { cause?: unknown }).cause ?? error);
    }
  }

  it("refuses one client's mobile against another's WhatsApp", async () => {
    const first = await createCustomer({
      firstName: "Priya",
      whatsapp: "+91 98100 11223",
      customerSince: since,
    });

    // Drizzle wraps the driver's error; the reason is on the cause.
    await expect(
      refusal(db.insert(customers).values({ firstName: "Imported", mobile: "+919810011223" })),
    ).resolves.toContain(`already belongs to ${first.ref}`);

    await expect(
      refusal(db.insert(customers).values({ firstName: "Imported", whatsapp: "+91 98100 11223" })),
    ).resolves.toContain("already belongs to");
  });

  it("lets one client hold the same number as mobile and WhatsApp", async () => {
    const client = await createCustomer({
      firstName: "Priya",
      mobile: "+91 98100 11223",
      customerSince: since,
    });

    await expect(
      updateCustomer({ id: client.id, whatsapp: "+91 98100 11223" }),
    ).resolves.toMatchObject({ id: client.id });
  });

  /** Archiving releases the number, exactly as the old index did. */
  it("frees the number once the client is archived", async () => {
    const first = await createCustomer({
      firstName: "Priya",
      mobile: "+91 98100 11223",
      customerSince: since,
    });
    await archiveCustomer(first.id);

    const second = await createCustomer({
      firstName: "Arjun",
      whatsapp: "+91 98100 11223",
      customerSince: since,
    });

    expect(second.id).not.toBe(first.id);
  });
});
