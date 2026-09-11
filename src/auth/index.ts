import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { db } from "@/db";
import { accounts, sessions, users, verifications } from "@/db/schema";

/**
 * Vara5 is an internal tool: there is no public sign-up.
 * Accounts are created by an administrator, or by the bootstrap seed script.
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

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
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
    // Must stay last: it writes Set-Cookie headers for server actions.
    nextCookies(),
  ],
});

export type Auth = typeof auth;
