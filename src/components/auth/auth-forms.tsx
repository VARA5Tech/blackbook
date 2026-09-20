"use client";

import { Loader2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { authClient, signIn } from "@/auth/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  STAFF_DOMAIN_MESSAGE,
  isStaffEmail,
} from "@/domain/staff";

/**
 * Everything shown to someone who is not signed in: the shared frame, sign-in,
 * signing in with an emailed code.
 */

/* ---------------------------------------------------------------- sign in */

/** The two-column frame, so every signed-out screen is the same place. */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    // Exactly one screen tall on wide screens, so the page itself never
    // scrolls; a tall form scrolls inside its own column instead.
    <main className="grid min-h-dvh lg:h-dvh lg:grid-cols-[1.1fr_1fr] lg:overflow-hidden">
      {/*
        A fixed brand surface, not `bg-primary`. Primary inverts between themes,
        so in dark mode this panel turned champagne and swallowed the champagne
        logo completely. Black in both themes is also what the guide asks for:
        the champagne mark belongs on a dark ground, and champagne is never
        meant to be a large fill.
      */}
      <section className="hidden min-h-0 flex-col bg-[var(--brand-surface)] p-10 text-[var(--brand-surface-foreground)] lg:flex xl:p-12">
        {/*
          The guide reserves the full lockup, tagline included, for hero and
          opening screens, so here it is the hero, centred above the line. It is
          capped by the screen's height as well as its width, so it never pushes
          the panel past one screen.
        */}
        <div className="flex min-h-0 flex-1 items-center justify-center py-6">
          <Image
            src="/brand/blackbook-logo-dark.svg"
            alt="Blackbook"
            width={900}
            height={636}
            priority
            className="h-auto max-h-[36dvh] w-auto max-w-[24rem]"
          />
        </div>

        <div className="max-w-md space-y-3">
          <h1 className="font-display text-3xl leading-tight tracking-tight xl:text-4xl">
            Know every client before you say hello.
          </h1>
          <p className="text-sm leading-relaxed opacity-70">
            Client 360, households, milestones and preferences in one place, so
            every conversation starts already personal.
          </p>
        </div>

        <p className="mt-8 text-xs opacity-50">
          Internal system. Access is granted by a Vara5 administrator.
        </p>
      </section>

      {/*
        Its own surface, not the page background. In dark mode the page ground
        is the same black as the brand panel, so without this the two columns
        merged into one black rectangle with no division. `m-auto` centres the
        form and still lets a tall one scroll from its top.
      */}
      <section className="flex min-h-0 flex-col bg-card px-6 py-12 lg:overflow-y-auto">
        <div className="m-auto w-full max-w-sm">
          {/* Narrow screens have no brand panel, so the mark follows the theme. */}
          <Image
            src="/brand/blackbook-horizontal-compact-light.svg"
            alt="Blackbook"
            width={1100}
            height={180}
            priority
            className="-ml-2 h-10 w-auto lg:hidden dark:hidden"
          />
          <Image
            src="/brand/blackbook-horizontal-compact-dark.svg"
            alt=""
            aria-hidden
            width={1100}
            height={180}
            className="-ml-2 hidden h-10 w-auto dark:block dark:lg:hidden"
          />

          <h2 className="mt-8 font-display text-2xl tracking-tight lg:mt-0">
            {title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>

          {children}
        </div>
      </section>
    </main>
  );
}

function Problem({ message }: { message: string | null }) {
  return message ? (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  ) : null;
}

const SIGN_IN_NOTICES = {
  signedOut: "You have been signed out. Ask for a new code to come back in.",
} as const;

/** Ask for a code, then type it. There is no other way in. */
type SignInStep = { stage: "request" } | { stage: "enter"; email: string };

export function SignInForm({
  next,
  notice,
}: {
  next: string;
  /** Arrived here from a used invitation. */
  notice: keyof typeof SIGN_IN_NOTICES | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [step, setStep] = useState<SignInStep>({ stage: "request" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSent(null);

    const form = new FormData(event.currentTarget);
    const email =
      step.stage === "enter" ? step.email : String(form.get("email") ?? "").trim();

    // The server refuses these too; saying so here is only the kinder message.
    if (!isStaffEmail(email)) {
      setError(STAFF_DOMAIN_MESSAGE);
      return;
    }

    setPending(true);

    if (step.stage === "request") {
      /*
       * Moves on whether or not the address has an account, and says the same
       * thing either way. Anything else would let this page confirm which
       * addresses belong to Vara5 staff.
       */
      await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      setStep({ stage: "enter", email });
      setSent(`If ${email} has an account, a code is on its way.`);
      setPending(false);
      return;
    }

    const result = await signIn.emailOtp({
      email,
      otp: String(form.get("code") ?? "").trim(),
    });

    if (result.error) {
      setError("That code did not work. It may have expired.");
      setPending(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-5">
      {notice && !error ? (
        <Alert>
          <AlertDescription>{SIGN_IN_NOTICES[notice]}</AlertDescription>
        </Alert>
      ) : null}

      {sent && !error ? (
        <Alert>
          <AlertDescription>{sent}</AlertDescription>
        </Alert>
      ) : null}

      {/*
        Keyed apart on purpose. The two inputs occupy the same slot, so without
        distinct keys React reuses the same DOM node between the steps and the
        address that was just typed reappears inside the code box.
      */}
      {step.stage === "enter" ? (
        <div className="space-y-2">
          <Label htmlFor="code">Six-digit code</Label>
          <Input
            key="code"
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            autoFocus
            className="tabular text-center text-lg tracking-[0.4em]"
          />
          <button
            type="button"
            onClick={() => {
              setStep({ stage: "request" });
              setSent(null);
              setError(null);
            }}
            className="text-xs text-muted-foreground hover:underline"
          >
            Use a different address
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            key="email"
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            placeholder="you@vara5.com"
          />
        </div>
      )}

      <Problem message={error} />

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        {step.stage === "enter" ? "Sign in" : "Send OTP"}
      </Button>
    </form>
  );
}
