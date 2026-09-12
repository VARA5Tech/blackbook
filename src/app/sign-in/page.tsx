import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { logger } from "@/lib/logger";
import { needsSetup } from "@/services/setup-service";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

// Asks the database whether any account exists, on every request.
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";

  /**
   * A brand new instance has no account to sign in with, and every route sends
   * an unauthenticated visitor here. Without this, the first thing anyone sees
   * on a fresh deployment is a login form that cannot possibly work, and
   * `/setup` is reachable only by knowing to type it.
   *
   * Swallowing the error is deliberate. If the database is unreachable this
   * page is the one thing still proving the application is up, and replacing it
   * with a stack trace would hide that. The reason goes to the log instead.
   */
  let setupNeeded = false;
  try {
    setupNeeded = await needsSetup();
  } catch (error) {
    logger.error("sign_in.setup_check_failed", error);
  }
  // Outside the catch: `redirect` signals by throwing, and swallowing that
  // would turn the redirect into a silently rendered sign-in form.
  if (setupNeeded) redirect("/setup");

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/*
        A fixed brand surface, not `bg-primary`. Primary inverts between themes,
        so in dark mode this panel turned champagne and swallowed the champagne
        logo completely. Black in both themes is also what the guide asks for:
        the champagne mark belongs on a dark ground, and champagne is never
        meant to be a large fill.
      */}
      <section className="hidden flex-col justify-between bg-[var(--brand-surface)] p-12 text-[var(--brand-surface-foreground)] lg:flex">
        {/* The guide reserves the full lockup for hero and opening screens. */}
        <Image
          src="/brand/blackbook-logo-dark.svg"
          alt="Blackbook"
          width={900}
          height={636}
          priority
          className="h-auto w-44"
        />

        <div className="max-w-md space-y-6">
          <h1 className="font-display text-4xl leading-tight tracking-tight">
            Know every client before you say hello.
          </h1>
          <p className="text-sm leading-relaxed opacity-70">
            Client 360, households, milestones and preferences in one place, so
            every conversation starts already personal.
          </p>
        </div>

        <p className="text-xs opacity-50">
          Internal system. Access is granted by a Vara5 administrator.
        </p>
      </section>

      {/*
        Its own surface, not the page background. In dark mode the page ground
        is the same black as the brand panel, so without this the two columns
        merged into one black rectangle with no division.
      */}
      <section className="flex items-center justify-center bg-card px-6 py-16">
        <div className="w-full max-w-sm">
          {/* Narrow screens have no brand panel, so the mark follows the theme. */}
          <Image
            src="/brand/blackbook-horizontal-compact-light.svg"
            alt="Blackbook"
            width={1100}
            height={180}
            priority
            className="h-6 w-auto lg:hidden dark:hidden"
          />
          <Image
            src="/brand/blackbook-horizontal-compact-dark.svg"
            alt=""
            aria-hidden
            width={1100}
            height={180}
            className="hidden h-6 w-auto dark:block dark:lg:hidden"
          />

          <h2 className="mt-8 font-display text-2xl tracking-tight lg:mt-0">
            Sign in
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Use your Vara5 email address.
          </p>

          <SignInForm next={next} />
        </div>
      </section>
    </main>
  );
}
