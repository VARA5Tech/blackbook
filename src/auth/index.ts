import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { emailOTP } from "better-auth/plugins/email-otp";
import { db } from "@/db";
import { accounts, sessions, users, verifications } from "@/db/schema";
import { STAFF_DOMAIN_MESSAGE, isStaffEmail } from "@/domain/staff";
import { uuidv7 } from "@/domain/shared";
import {
  EMAIL_CODE_MINUTES,
} from "@/domain/staff";
import { sendEmail, signInCodeEmail } from "@/lib/email";

function assertStaffEmail(email: unknown) {
  if (typeof email === "string" && !isStaffEmail(email)) {
    throw new APIError("FORBIDDEN", { message: STAFF_DOMAIN_MESSAGE });
  }
}

/**
 * Vara5 is an internal tool: there is no public sign-up.
 * Accounts are created by an administrator, by invitation, or by the seed script.
 */
export const auth = betterAuth({
  appName: "Blackbook",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",

  /**
   * Behind Dokploy's Traefik proxy the container sees plain HTTP, so the
   * origin has to be stated rather than inferred. A mismatch here is the usual
   * cause of a sign-in that appears to succeed and then bounces back.
   */
  trustedOrigins: [
    process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  ].filter(Boolean),

  advanced: {
    // Keyed to the actual scheme rather than NODE_ENV, so a production build
    // can still be exercised over plain HTTP locally. In the real deployment
    // BETTER_AUTH_URL is https, so the cookies are marked Secure.
    useSecureCookies: (process.env.BETTER_AUTH_URL ?? "").startsWith("https://"),

    database: {
      /**
       * UUIDv7 for the sessions and tokens Better Auth writes itself, the same
       * kind of key as every other table.
       *
       * Its own "uuid" setting is not that: it asks Postgres for
       * gen_random_uuid(), which is a random v4. Left at the default it would
       * mint a base62 string, a third format in the same database.
       */
      generateId: () => uuidv7(),
    },
  },

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),

  /**
   * Only @vara5.com, on the server, twice over.
   *
   * The request hook refuses any auth call that names another address: sign-in,
   * reset codes, the admin plugin's create-user. The database hooks catch
   * anything Better Auth writes itself, whatever the route. The services apply
   * the same rule to the accounts and invitations they create directly.
   */
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const body: unknown = ctx.body;
      if (body && typeof body === "object" && "email" in body) {
        assertStaffEmail(body.email);
      }
    }),
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          assertStaffEmail(user.email);
        },
      },
      update: {
        before: async (user) => {
          assertStaffEmail(user.email);
        },
      },
    },
  },

  /**
   * There is no password.
   *
   * Signing in is an emailed code and nothing else, so the credential provider
   * is switched off rather than left enabled with no rows behind it: disabled,
   * the endpoints refuse outright instead of answering "wrong password" to a
   * guess. Mail is the only factor, which is the trade that was accepted when
   * this replaced passwords.
   */
  emailAndPassword: {
    enabled: false,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    /**
     * Off deliberately.
     *
     * Caching the session in the cookie saves a read per request, but it also
     * caches the role, so a demotion or a suspension kept working for the life
     * of the cache. Verified: a user demoted in the database still reached an
     * administrator-only screen until it expired.
     *
     * At this headcount that read is nothing, and access changes taking effect
     * on the next request is worth more than avoiding it.
     */
    cookieCache: {
      enabled: false,
    },
  },

  plugins: [
    admin({
      defaultRole: "viewer",
      adminRoles: ["admin"],
    }),
    /**
     * Signing in by an emailed six-digit code, which is the only way in.
     *
     * Two of the plugin's four types are delivered. A code of any other type is
     * still generated and simply never sent, so it cannot be used, and
     * `disableSignUp` means no code can bring an account into existence: an
     * address with no account is answered with the same "invalid code" as a
     * wrong digit, which is also what stops the form from telling a stranger
     * who works here.
     *
     * Nobody has a password, so there is no second door and no reset to ask
     * for: an address either receives a code or it does not.
     */
    emailOTP({
      otpLength: 6,
      expiresIn: EMAIL_CODE_MINUTES * 60,
      allowedAttempts: 3,
      disableSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        // Only the one type is delivered. A code of any other kind is still
        // generated by the plugin and simply never sent, so it cannot be used.
        if (type !== "sign-in") return;

        const message = signInCodeEmail({ code: otp });
        await sendEmail({ to: email, category: "sign-in-code", ...message });
      },
    }),
    // Must stay last: it writes Set-Cookie headers for server actions.
    nextCookies(),
  ],
});

export type Auth = typeof auth;
