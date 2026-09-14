import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { accounts, users, verifications } from "@/db/schema";
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
import { DomainError } from "@/services/client-service";
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
   * An email is opened on a phone, far from the laptop that sent it, so every
   * asset must come from the public site. A localhost logo is a broken image.
   */
  it("loads its monogram as a hosted PNG from production, never from localhost", () => {
    expect(EMAIL_MONOGRAM_URL).toMatch(/^https:\/\/blackbook\.vara5\.travel\/.+\.png$/);
    expect(email.html).toContain(EMAIL_MONOGRAM_URL);
    expect(email.html).not.toContain("localhost");
    // Gmail and Outlook render no SVG; both refuse data: images; Gmail web
    // ignores cid: attachments.
    expect(email.html).not.toMatch(/\.svg|data:image|cid:/);
  });

  /** With images switched off, the email still opens on the brand name. */
  it("sets the wordmark as live text, so it survives blocked images", () => {
    expect(email.subject).toContain("Blackbook");
    expect(email.html).toMatch(/>BLACKBOOK<\/div>/);
    expect(email.html).toContain('alt=""');
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
