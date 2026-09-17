import { createHash, createHmac, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as privateAccessLookup } from "@/app/api/private-access/lookup/route";
import { auth } from "@/auth";
import { db } from "@/db";
import { accounts, customers, users, verifications } from "@/db/schema";
import {
  PASSWORD_RESET_CODE_MINUTES,
  STAFF_DOMAIN_MESSAGE,
  isStaffEmail,
  normaliseStaffEmail,
  staffEmailLocalPart,
  staffEmailSchema,
} from "@/domain/staff";
import {
  EMAIL_MONOGRAM_URL,
  EmailNotConfiguredError,
  escapeHtml,
  passwordResetEmail,
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
  updateCustomer,
} from "@/services/client-service";
import {
  acceptInvitation,
  createStaffUser,
  findInvitationByToken,
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

describe("password reset email", () => {
  const email = passwordResetEmail({ code: "482913" });

  it("carries the code in both the HTML and the plain-text versions", () => {
    expect(email.html).toContain("482913");
    expect(email.text).toContain("482913");
  });

  it("says how long the code works, matching the auth configuration", () => {
    expect(email.text).toContain(`${PASSWORD_RESET_CODE_MINUTES} minutes`);
    expect(email.html).toContain(`${PASSWORD_RESET_CODE_MINUTES} minutes`);
  });

  /**
   * An email is opened far from the laptop that sent it, so the monogram comes
   * from production as a PNG, the one image form every client renders.
   */
  it("loads its monogram as a hosted PNG from production", () => {
    expect(EMAIL_MONOGRAM_URL).toMatch(/^https:\/\/blackbook\.vara5\.travel\/.+\.png$/);
    expect(email.html).toContain(`src="${EMAIL_MONOGRAM_URL}"`);
    expect(email.html).not.toMatch(/<svg|data:image|cid:|localhost/i);
  });

  /**
   * Outlook hides a new sender's images until they are trusted. Until then the
   * alternative text stands in, styled as a champagne serif B, and the wordmark
   * below is live text either way.
   */
  it("stands a styled B in for the monogram while images are blocked", () => {
    expect(email.html).toMatch(/<img[^>]*alt="B"[^>]*style="[^"]*font-family:[^"]*color:#E8CFAB/);
    expect(email.subject).toContain("Blackbook");
    expect(email.html).toMatch(/>BLACKBOOK<\/div>/);
  });

  it("escapes anything it interpolates", () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;",
    );
    const hostile = passwordResetEmail({ code: "<b>1</b>" });
    expect(hostile.html).not.toContain("<b>1</b>");
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
        password: "a-sufficiently-long-password",
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

  /** Runs something that emails an invitation, and reads the link back out. */
  async function captureLink(send: () => Promise<unknown>): Promise<string> {
    const printed = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    let output = "";
    try {
      await send();
      output = printed.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    } finally {
      vi.restoreAllMocks();
    }

    const token = output.match(/\/invite\/([A-Za-z0-9_-]{43})/)?.[1];
    if (!token) throw new Error("No invitation link was printed");
    return token;
  }

  async function invite(local: string) {
    let result: Awaited<ReturnType<typeof inviteStaff>> | undefined;
    const token = await captureLink(async () => {
      result = await inviteStaff({ name: "Priya Nair", email: local, role: "rm" });
    });
    return { ...result!, token };
  }

  const lookUp = (id: string) => db.query.users.findFirst({ where: eq(users.id, id) });

  it("holds an invited colleague as an unverified account with no password until the link is used", async () => {
    const local = `invitee-${randomUUID()}`;
    const { id, email, token } = await invite(local);
    expect(email).toBe(`${local}@vara5.com`);

    expect(await lookUp(id)).toMatchObject({ email, role: "rm", emailVerified: false });
    expect(await db.query.accounts.findFirst({ where: eq(accounts.userId, id) })).toBeUndefined();

    // On Team with a lapse date, but not offered as a relationship manager.
    expect((await listAllUsers()).find((user) => user.id === id)?.inviteExpiresAt).toBeInstanceOf(Date);
    expect((await listStaff()).some((user) => user.id === id)).toBe(false);

    // Only a hash of the token is kept, in Better Auth's own table.
    const [stored] = await db.select().from(verifications).where(eq(verifications.value, id));
    expect(stored.identifier).toBe(
      `staff-invite:${createHash("sha256").update(token).digest("hex")}`,
    );

    expect(await findInvitationByToken(token)).toEqual({ name: "Priya Nair", email });

    actingAs(null);
    await acceptInvitation({ token, password: "chosen-by-the-colleague" });

    expect(await lookUp(id)).toMatchObject({ emailVerified: true });
    const credential = await db.query.accounts.findFirst({ where: eq(accounts.userId, id) });
    const context = await auth.$context;
    expect(
      await context.password.verify({
        hash: credential!.password!,
        password: "chosen-by-the-colleague",
      }),
    ).toBe(true);

    actingAs(staff.admin);
    expect((await listAllUsers()).find((user) => user.id === id)?.inviteExpiresAt).toBeNull();
    expect((await listStaff()).some((user) => user.id === id)).toBe(true);

    // One use only.
    expect(await findInvitationByToken(token)).toBeNull();
    await expect(
      acceptInvitation({ token, password: "someone-elses-password" }),
    ).rejects.toThrow(DomainError);
  });

  it("refuses a link past its expiry", async () => {
    const { id, token } = await invite(`late-${randomUUID()}`);
    await db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verifications.value, id));

    actingAs(null);
    await expect(
      acceptInvitation({ token, password: "chosen-by-the-colleague" }),
    ).rejects.toThrow(DomainError);
    expect(await db.query.accounts.findFirst({ where: eq(accounts.userId, id) })).toBeUndefined();
  });

  it("deletes an invited account nobody set up within two days, and nothing else", async () => {
    const stale = await invite(`stale-${randomUUID()}`);
    const fresh = await invite(`fresh-${randomUUID()}`);
    const established = await createStaffUser({
      name: "Established",
      email: `established-${randomUUID()}`,
      role: "viewer",
      password: "a-sufficiently-long-password",
    });

    const threeDaysAgo = new Date(Date.now() - 3 * DAY_MS);
    await db.update(users).set({ createdAt: threeDaysAgo }).where(eq(users.id, stale.id));
    // Old and unverified, but it has a password, so it is a real account.
    await db
      .update(users)
      .set({ createdAt: threeDaysAgo, emailVerified: false })
      .where(eq(users.id, established.id));

    await purgeExpiredInvitations();

    expect(await lookUp(stale.id)).toBeUndefined();
    expect(await db.select().from(verifications).where(eq(verifications.value, stale.id))).toHaveLength(0);
    expect(await findInvitationByToken(stale.token)).toBeNull();
    expect(await lookUp(fresh.id)).toBeDefined();
    expect(await lookUp(established.id)).toBeDefined();
  });

  it("sends a new link and restarts the two days when sent again", async () => {
    const first = await invite(`twice-${randomUUID()}`);
    const oneDayAgo = new Date(Date.now() - DAY_MS);
    await db.update(users).set({ createdAt: oneDayAgo }).where(eq(users.id, first.id));

    const secondToken = await captureLink(() => resendInvitation(first.id));

    expect(await findInvitationByToken(first.token)).toBeNull();
    expect(await findInvitationByToken(secondToken)).toMatchObject({ email: first.email });
    expect((await lookUp(first.id))!.createdAt.getTime()).toBeGreaterThan(oneDayAgo.getTime());
  });

  it("deletes the invited account when withdrawn", async () => {
    const { id, token } = await invite(`withdrawn-${randomUUID()}`);
    await revokeInvitation(id);
    expect(await lookUp(id)).toBeUndefined();
    expect(await findInvitationByToken(token)).toBeNull();
  });

  it("never withdraws an account that has a password", async () => {
    const { id } = await createStaffUser({
      name: "Real Colleague",
      email: `real-${randomUUID()}`,
      role: "viewer",
      password: "a-sufficiently-long-password",
    });
    await expect(revokeInvitation(id)).rejects.toThrow(DomainError);
    expect(await lookUp(id)).toBeDefined();
  });

  it("will not invite an address that already has an account or an open invitation", async () => {
    const email = `existing-${randomUUID()}@vara5.com`;
    await createStaffUser({
      name: "Existing",
      email,
      role: "viewer",
      password: "a-sufficiently-long-password",
    });
    await expect(inviteStaff({ name: "Existing", email, role: "rm" })).rejects.toThrow(DomainError);

    const open = await invite(`open-${randomUUID()}`);
    await expect(
      inviteStaff({ name: "Again", email: open.email, role: "rm" }),
    ).rejects.toThrow(DomainError);
  });

  it("ignores anything that is not a well-formed token", async () => {
    expect(await findInvitationByToken("not-a-token")).toBeNull();
    expect(await findInvitationByToken("x".repeat(43))).toBeNull();
  });

  it("writes an invitation email that names the role, the lapse and escapes the name", () => {
    const message = staffInvitationEmail({
      name: "<b>Priya</b> Nair",
      invitedBy: "Sudhansu",
      roleLabel: "Relationship Manager",
      link: "https://blackbook.vara5.travel/invite/abc",
    });
    expect(message.html).toContain("https://blackbook.vara5.travel/invite/abc");
    expect(message.text).toContain("https://blackbook.vara5.travel/invite/abc");
    expect(message.text).toContain("Relationship Manager");
    expect(message.text).toContain("2 days");
    expect(message.html).not.toContain("<b>Priya</b>");
    expect(message.html).toContain(EMAIL_MONOGRAM_URL);
  });
});

/**
 * Guests getting into vara5.travel's private Inspirations: the website asks
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
 * What a client reads on vara5.travel, reported back through the same signed
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

    expect(summaries).toContain("Asked the Curator about Antarctica — White Silence on vara5.travel");
    expect(summaries.filter((line) => line.includes("vara5.travel"))).toHaveLength(1);
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
 * them, so a collision locks both of them out of vara5.travel. The service
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
