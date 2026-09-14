import "server-only";
import { Resend } from "resend";
import { INVITATION_DAYS, PASSWORD_RESET_CODE_MINUTES } from "@/domain/staff";
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
  subject: string;
  html: string;
  /** Plain-text version, for clients that do not render HTML and for spam scoring. */
  text: string;
  /** A short label shown in Resend, such as "password-reset". Letters, digits, dashes. */
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
 * Sends one email, or says exactly why it did not.
 *
 * Without a key, production refuses loudly: a password reset that quietly sends
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

  client ??= new Resend(key);

  const { data, error } = await client.emails.send({
    from: EMAIL_SENDER,
    to: [email.to],
    subject: email.subject,
    html: email.html,
    text: email.text,
    tags: [{ name: "category", value: email.category }],
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
 * Email clients are not browsers. Gmail and Outlook render no SVG, both refuse
 * base64 data: images, Gmail's web client does not resolve cid: inline
 * attachments, and Resend's own preview cannot show them either. A hosted PNG
 * is the one image form that works everywhere.
 *
 * Readers can still switch images off, so the logo is split: the book monogram
 * is that hosted PNG, and the BLACKBOOK wordmark beneath it is live text. With
 * images blocked the email still opens on the brand name rather than a broken
 * box, which is why the monogram has empty alternative text.
 *
 * Emails are read far from localhost, so assets always come from production,
 * and a new asset only works once it is deployed.
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
            <img src="${EMAIL_MONOGRAM_URL}" width="44" height="58" alt="" style="display:block;margin:0 auto;width:44px;height:58px;border:0;outline:none;text-decoration:none;">
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
 * A password reset code. A code rather than a link: it is typed into the reset
 * page the person already has open, so it survives a mail client that rewrites
 * or pre-fetches links, and it is useless to anyone who only sees the subject.
 */
export function passwordResetEmail({ code }: { code: string }) {
  const minutes = `${PASSWORD_RESET_CODE_MINUTES} minutes`;
  const subject = "Your Blackbook password reset code";

  const body = `
            ${heading("Reset your password")}
            ${paragraph(`Enter this code on the Blackbook password reset page to choose a new password. It works once and expires in ${minutes}.`, "0 0 30px")}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="background-color:${C.ivory};border:1px solid ${C.rule};padding:24px 12px 24px 22px;font-family:${MONO};font-size:34px;line-height:40px;letter-spacing:10px;color:${C.ink};">${escapeHtml(code)}</td>
              </tr>
            </table>
            ${note("If you did not ask to reset your password, you can ignore this email. Your password stays as it is.", "30px 0 0")}`;

  const text = [
    "Reset your password",
    "",
    `Your Blackbook password reset code is ${code}.`,
    "",
    `Enter it on the password reset page to choose a new password. It works once and expires in ${minutes}.`,
    "",
    "If you did not ask to reset your password, you can ignore this email. Your password stays as it is.",
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
 * An invitation to join. A link, unlike the reset code, because the person has
 * no Blackbook page open yet. Opening it only shows a form; the password is set
 * when the form is submitted, so a mail scanner that pre-fetches links cannot
 * use it up.
 */
export function staffInvitationEmail({
  name,
  invitedBy,
  roleLabel,
  link,
}: {
  name: string;
  invitedBy: string | null;
  roleLabel: string;
  link: string;
}) {
  const days = `${INVITATION_DAYS} days`;
  const subject = "You are invited to Blackbook";
  const firstName = name.split(/\s+/)[0] || name;
  const intro = `${invitedBy ? `${invitedBy} has invited you` : "You have been invited"} to Blackbook, the Vara5 client system, as ${roleLabel}.`;

  const body = `
            ${heading(`Welcome, ${firstName}`)}
            ${paragraph(intro)}
            ${paragraph(`Choose a password to finish setting up your account. The link works once and expires in ${days}.`, "0 0 30px")}
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="${C.ink}" style="background-color:${C.ink};">
                  <a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:${C.white};text-decoration:none;">Set up my account</a>
                </td>
              </tr>
            </table>
            <p style="margin:30px 0 6px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted};">If the button does not work, paste this link into your browser:</p>
            <p style="margin:0;font-family:${MONO};font-size:12px;line-height:18px;color:${C.body};word-break:break-all;">${escapeHtml(link)}</p>
            ${note("If you were not expecting this, you can ignore this email. The invitation lapses on its own.", "26px 0 0")}`;

  const text = [
    `Welcome, ${firstName}`,
    "",
    intro,
    "",
    `Choose a password to finish setting up your account. The link works once and expires in ${days}:`,
    "",
    link,
    "",
    "If you were not expecting this, you can ignore this email. The invitation lapses on its own.",
    "",
    "Blackbook, Vara5",
  ].join("\n");

  return {
    subject,
    text,
    html: renderEmail({
      title: subject,
      preheader: `Set up your Blackbook account. The link expires in ${days}.`,
      body,
    }),
  };
}
