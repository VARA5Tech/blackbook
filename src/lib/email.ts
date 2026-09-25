import "server-only";
import { Resend } from "resend";
import { EMAIL_CODE_MINUTES, INVITATION_DAYS } from "@/domain/staff";
import { logger } from "@/lib/logger";

/**
 * Everything Blackbook emails, in one place: the sender, the frame every
 * message sits in, and the messages themselves.
 *
 * One sender for everything the system sends on its own behalf. Delivery needs
 * vara5.travel verified as a sending domain in Resend.
 */
export const EMAIL_SENDER = "Blackbook <blackbook@vara5.travel>";

export type OutboundEmail = {
  to: string;
  /**
   * Copied in, for mail that is somebody's to act on and somebody else's to
   * know about. A lead is chased by its curator and watched by the managers,
   * and sending two separate emails would lose that it is one thread.
   */
  cc?: string[];
  subject: string;
  html: string;
  /** Plain-text version, for clients that do not render HTML and for spam scoring. */
  text: string;
  /** A short label shown in Resend, such as "sign-in-code". Letters, digits, dashes. */
  category: string;
};

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("RESEND_API_KEY is not set, so Blackbook cannot send email.");
    this.name = "EmailNotConfiguredError";
  }
}

let client: Resend | undefined;

/**
 * Nothing outside production reaches the person it names.
 *
 * Blackbook runs locally against a copy of the real database, so the curator
 * on a lead, the managers copied on it and the administrators it escalates to
 * are all real colleagues with real mailboxes. The lead sweep does not wait to
 * be asked: it fires on a timer, so a developer with the server running sends
 * live mail about fabricated clients to people who have no idea what it is.
 * That happened, and an apology is not a control.
 *
 * So outside production every message is re-addressed to one mailbox, named by
 * `DEV_EMAIL_TO`, and the copies are dropped rather than redirected — one
 * message, not four. Where it was bound for goes in the subject, so a test
 * still shows whether the routing is right.
 *
 * With no `DEV_EMAIL_TO` it sends nothing at all. Failing closed is the whole
 * point: the cost of a message not arriving on a laptop is a developer looking
 * at the terminal, and the cost of one arriving is this.
 */
export function forDevelopment(email: OutboundEmail): OutboundEmail | null {
  const mailbox = process.env.DEV_EMAIL_TO?.trim();
  if (!mailbox) return null;

  const copies = email.cc?.length ? `, cc ${email.cc.length}` : "";
  return {
    ...email,
    to: mailbox,
    cc: undefined,
    subject: `[dev → ${email.to}${copies}] ${email.subject}`,
  };
}

/**
 * Sends one email, or says exactly why it did not.
 *
 * Without a key, production refuses loudly: a sign-in code that quietly sends
 * nothing is a locked-out colleague with no error anywhere. Development prints
 * the message to the terminal instead, so the flow can be used on a laptop.
 *
 * Resend's SDK returns `{ data, error }` rather than throwing, so the error is
 * checked and rethrown here. A caller that awaited this can trust it was sent.
 */
export async function sendEmail(email: OutboundEmail): Promise<{ sent: boolean }> {
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    if (process.env.NODE_ENV === "production") throw new EmailNotConfiguredError();

    logger.warn("email.not_configured", { category: email.category });
    // The text body carries whatever the developer needs, such as a reset
    // code. Development only: the production branch above never reaches here.
    console.info(`\n[email not sent: no RESEND_API_KEY]\n${email.subject}\n\n${email.text}\n`);
    return { sent: false };
  }

  /*
   * Before the client is touched, so there is no path from a laptop to a
   * colleague's mailbox at all — not a flag to remember, not a list to keep.
   */
  let outbound = email;
  if (process.env.NODE_ENV !== "production") {
    const redirected = forDevelopment(email);
    if (!redirected) {
      logger.warn("email.withheld_outside_production", { category: email.category });
      console.info(
        `\n[email withheld: set DEV_EMAIL_TO to receive it]\n${email.subject}\n\n${email.text}\n`,
      );
      return { sent: false };
    }
    outbound = redirected;
  }

  client ??= new Resend(key);

  const { data, error } = await client.emails.send({
    from: EMAIL_SENDER,
    to: [outbound.to],
    // Duplicates and the recipient's own address are dropped: a curator who is
    // also a manager should not be copied on their own mail.
    ...(outbound.cc?.length
      ? { cc: [...new Set(outbound.cc)].filter((address) => address !== outbound.to) }
      : {}),
    subject: outbound.subject,
    html: outbound.html,
    text: outbound.text,
    tags: [{ name: "category", value: outbound.category }],
  });

  if (error) {
    // The recipient is personal data and stays out of the log. The category and
    // Resend's own error name are enough to find the failure in its dashboard.
    logger.error("email.send_failed", new Error(error.message), {
      category: email.category,
      resendError: error.name,
    });
    throw new Error(`Resend refused the email: ${error.message}`);
  }

  logger.info("email.sent", { category: email.category, resendId: data?.id });
  return { sent: true };
}

/* ------------------------------------------------------------------ frame */

/**
 * The book monogram is a hosted PNG, the one image form every client renders:
 * Gmail and Outlook show no SVG, and data: and cid: images each fail in one of
 * them. Emails are read far from localhost, so it always comes from production.
 *
 * Outlook holds remote images from a new sender behind "Trust sender", and some
 * readers switch images off. So the image carries styled alternative text: a
 * champagne serif B, the closest a letter comes to the mark, which Gmail,
 * Apple Mail and Outlook on the web draw in the image's place until the picture
 * is allowed. Outlook on Windows desktop shows it unstyled. Either way the
 * BLACKBOOK wordmark beneath is live text, so the brand reads before and after
 * anyone trusts the sender.
 */
export const EMAIL_MONOGRAM_URL =
  "https://blackbook.vara5.travel/brand/email/blackbook-monogram-dark@3x.png";

const C = {
  black: "#090909",
  ink: "#151411",
  body: "#3B3833",
  muted: "#6B665E",
  ivory: "#F7F4EE",
  white: "#FFFFFF",
  rule: "#E9E3D8",
  champagne: "#E8CFAB",
} as const;

const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', Menlo, Consolas, 'Courier New', monospace";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Nested tables, inline styles and typefaces every device already has, because
 * Outlook ignores CSS layout. Deliberately quiet: black band, champagne mark,
 * one champagne hairline, then ivory and ink.
 */
function renderEmail({
  title,
  preheader,
  body,
}: {
  title: string;
  /** The line inbox previews show after the subject. Hidden in the email itself. */
  preheader: string;
  /** Inner HTML, already escaped where it carries values. */
  body: string;
}): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.ivory};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.ivory};">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.ivory};">
  <tr>
    <td align="center" style="padding:48px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:${C.white};border:1px solid ${C.rule};">
        <tr>
          <td align="center" bgcolor="${C.black}" style="background-color:${C.black};padding:36px 24px 30px;">
            <img src="${EMAIL_MONOGRAM_URL}" width="44" height="58" alt="B" style="display:block;margin:0 auto;width:44px;height:58px;border:0;outline:none;text-decoration:none;background-color:${C.black};font-family:${SERIF};font-size:42px;line-height:58px;text-align:center;color:${C.champagne};">
            <div style="margin:18px 0 0;padding-left:7px;font-family:${SERIF};font-size:15px;line-height:18px;letter-spacing:7px;color:${C.champagne};">BLACKBOOK</div>
          </td>
        </tr>
        <tr>
          <td style="height:2px;line-height:2px;font-size:0;background-color:${C.champagne};">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:44px 44px 12px;">
${body}
          </td>
        </tr>
        <tr>
          <td style="padding:28px 44px 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-top:1px solid ${C.rule};padding-top:22px;font-family:${SANS};font-size:12px;line-height:19px;color:${C.muted};">
                  Blackbook &middot; Vara5<br>
                  An internal system for the Vara5 team.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

const heading = (text: string) =>
  `<h1 style="margin:0 0 16px;font-family:${SERIF};font-size:26px;line-height:34px;font-weight:normal;color:${C.ink};">${escapeHtml(text)}</h1>`;

const paragraph = (text: string, margin = "0 0 14px") =>
  `<p style="margin:${margin};font-family:${SANS};font-size:15px;line-height:24px;color:${C.body};">${escapeHtml(text)}</p>`;

const note = (text: string, margin: string) =>
  `<p style="margin:${margin};font-family:${SANS};font-size:14px;line-height:22px;color:${C.muted};">${escapeHtml(text)}</p>`;

/* --------------------------------------------------------------- messages */


/**
 * The code that signs somebody in.
 *
 * Deliberately not a link. A link in a mailbox is a credential that a scanner,
 * a preview pane or a forwarded thread can spend; a six-digit code is useless
 * without the browser that asked for it, which is already open at the sign-in
 * page.
 */
export function signInCodeEmail({ code }: { code: string }) {
  const minutes = `${EMAIL_CODE_MINUTES} minutes`;
  const subject = "Your Blackbook sign-in code";

  const body = `
            ${heading("Sign in to Blackbook")}
            ${paragraph(`Enter this code on the Blackbook sign-in page. It works once and expires in ${minutes}.`, "0 0 30px")}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="background-color:${C.ivory};border:1px solid ${C.rule};padding:24px 12px 24px 22px;font-family:${MONO};font-size:34px;line-height:40px;letter-spacing:10px;color:${C.ink};">${escapeHtml(code)}</td>
              </tr>
            </table>
            ${note("If you did not try to sign in, you can ignore this email. Nobody can get in with this code alone.", "30px 0 0")}`;

  const text = [
    "Sign in to Blackbook",
    "",
    `Your Blackbook sign-in code is ${code}.`,
    "",
    `Enter it on the sign-in page. It works once and expires in ${minutes}.`,
    "",
    "If you did not try to sign in, you can ignore this email.",
    "",
    "Blackbook, Vara5",
  ].join("\n");

  return {
    subject,
    text,
    html: renderEmail({
      title: subject,
      preheader: `${code} is your code. It expires in ${minutes}.`,
      body,
    }),
  };
}

/**
 * A note saying an account now exists.
 *
 * No link and nothing to set up. There is no password, so a link could only
 * sign somebody in, and a link that signs somebody in is a credential sitting
 * in a mailbox where a scanner, a preview pane or a forwarded thread can spend
 * it. The address is the whole invitation: they go to Blackbook and ask for a
 * code, exactly as they will every day after this.
 */
export function staffInvitationEmail({
  name,
  invitedBy,
  roleLabel,
  signInUrl,
}: {
  name: string;
  invitedBy: string | null;
  roleLabel: string;
  signInUrl: string;
}) {
  const days = `${INVITATION_DAYS} days`;
  const subject = "You are invited to Blackbook";
  const firstName = name.split(/\s+/)[0] || name;
  const intro = `${invitedBy ? `${invitedBy} has invited you` : "You have been invited"} to Blackbook, the Vara5 client system, as ${roleLabel}.`;

  const body = `
            ${heading(`Welcome, ${firstName}`)}
            ${paragraph(intro)}
            ${paragraph(`Go to Blackbook and enter this address. It will email you a six-digit code to sign in with. There is no password to choose.`, "0 0 30px")}
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="${C.ink}" style="background-color:${C.ink};">
                  <a href="${escapeHtml(signInUrl)}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:${C.white};text-decoration:none;">Go to Blackbook</a>
                </td>
              </tr>
            </table>
            <p style="margin:30px 0 6px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted};">Or paste this into your browser:</p>
            <p style="margin:0;font-family:${MONO};font-size:12px;line-height:18px;color:${C.body};word-break:break-all;">${escapeHtml(signInUrl)}</p>
            ${note(`If you were not expecting this, you can ignore this email. Nothing here signs anybody in, and an account nobody uses is removed after ${days}.`, "26px 0 0")}`;

  const text = [
    `Welcome, ${firstName}`,
    "",
    intro,
    "",
    "Go to Blackbook and enter this address. It will email you a six-digit code to sign in with. There is no password to choose.",
    "",
    signInUrl,
    "",
    `If you were not expecting this, you can ignore this email. Nothing here signs anybody in, and an account nobody uses is removed after ${days}.`,
    "",
    "Blackbook, Vara5",
  ].join("\n");

  return {
    subject,
    text,
    html: renderEmail({
      title: subject,
      preheader: "Your Blackbook account is ready. Sign in with an emailed code.",
      body,
    }),
  };
}

/* ------------------------------------------------------------------ leads */

type LeadMail = {
  clientName: string;
  clientRef: string;
  title: string;
  leadUrl: string;
  /** Formatted for reading, already in Indian Standard Time. */
  dueAt: string;
  curatorName?: string | null;
};

const leadButton = (url: string, label: string) => `
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="${C.ink}" style="background-color:${C.ink};">
                  <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:${C.white};text-decoration:none;">${escapeHtml(label)}</a>
                </td>
              </tr>
            </table>`;

/**
 * A client has asked for something and somebody owes them an answer.
 *
 * Sent to the curator with the managers copied, because the reply is one
 * person's job and the promise is the firm's. It says what was asked and by
 * when, and nothing about the client beyond their name and reference: this
 * leaves the building, and the record stays in Blackbook.
 */
export function leadRaisedEmail(lead: LeadMail) {
  const subject = `${lead.clientName} asked about ${lead.title}`;

  const body = `
            ${heading("A client is waiting")}
            ${paragraph(`${lead.clientName} (${lead.clientRef}) texted the Curator about ${lead.title}.`)}
            ${paragraph(`Reply and log it in Blackbook by ${lead.dueAt}.`, "0 0 30px")}
            ${leadButton(lead.leadUrl, "Open the client")}
            ${note("Logging a call, a message or a meeting against this client marks the lead as answered. If nothing is logged by then, the managers and administrators are told.", "30px 0 0")}`;

  const text = [
    "A client is waiting",
    "",
    `${lead.clientName} (${lead.clientRef}) texted the Curator about ${lead.title}.`,
    `Reply and log it in Blackbook by ${lead.dueAt}.`,
    "",
    lead.leadUrl,
    "",
    "Logging a call, a message or a meeting against this client marks the lead as answered.",
    "",
    "Blackbook, Vara5",
  ].join("\n");

  return {
    subject,
    text,
    html: renderEmail({
      title: subject,
      preheader: `Answer by ${lead.dueAt}.`,
      body,
    }),
  };
}

/**
 * Nobody answered inside the window.
 *
 * The curator is on it rather than copied, because it is still theirs to
 * answer; the managers and administrators are copied because at this point it
 * is the firm that is late, not a person.
 */
export function leadOverdueEmail(lead: LeadMail & { hoursLate: number }) {
  const subject = `Still unanswered: ${lead.clientName} on ${lead.title}`;
  const who = lead.curatorName ? `${lead.curatorName} is` : "Nobody is";

  const body = `
            ${heading("A client is still waiting")}
            ${paragraph(`${lead.clientName} (${lead.clientRef}) asked about ${lead.title}, and nothing has been logged against them since.`)}
            ${paragraph(`The answer was due ${lead.dueAt}. ${who} down as the curator.`, "0 0 30px")}
            ${leadButton(lead.leadUrl, "Open the client")}
            ${note("This stops as soon as somebody logs a call, a message or a meeting against the client.", "30px 0 0")}`;

  const text = [
    "A client is still waiting",
    "",
    `${lead.clientName} (${lead.clientRef}) asked about ${lead.title}, and nothing has been logged against them since.`,
    `The answer was due ${lead.dueAt}. ${who} down as the curator.`,
    "",
    lead.leadUrl,
    "",
    "Blackbook, Vara5",
  ].join("\n");

  return {
    subject,
    text,
    html: renderEmail({
      title: subject,
      preheader: `Due ${lead.dueAt}, still nothing logged.`,
      body,
    }),
  };
}

/**
 * A lead arrived for a client nobody is the curator of.
 *
 * Goes to the managers and administrators at once rather than waiting out the
 * window: a clock nobody owns runs out with nothing happening. It asks for an
 * assignment, because a curator does not pick their own work here.
 */
export function leadUnassignedEmail(lead: Omit<LeadMail, "curatorName">) {
  const subject = `Unassigned: ${lead.clientName} asked about ${lead.title}`;

  const body = `
            ${heading("A lead has no curator")}
            ${paragraph(`${lead.clientName} (${lead.clientRef}) texted the Curator about ${lead.title}, and the client has no relationship manager.`)}
            ${paragraph(`Give it to somebody. The two days start when you do, so the client is owed an answer by ${lead.dueAt} at the latest.`, "0 0 30px")}
            ${leadButton(lead.leadUrl, "Assign a curator")}
            ${note("Whoever you choose is emailed straight away.", "30px 0 0")}`;

  const text = [
    "A lead has no curator",
    "",
    `${lead.clientName} (${lead.clientRef}) texted the Curator about ${lead.title}, and the client has no relationship manager.`,
    `Give it to somebody. The client is owed an answer by ${lead.dueAt} at the latest.`,
    "",
    lead.leadUrl,
    "",
    "Blackbook, Vara5",
  ].join("\n");

  return {
    subject,
    text,
    html: renderEmail({
      title: subject,
      preheader: "Nobody is the curator for this client.",
      body,
    }),
  };
}
