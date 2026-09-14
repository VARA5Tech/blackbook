"use client";

import { Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { acceptInvitationAction } from "@/actions/user-actions";
import { authClient, signIn } from "@/auth/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MIN_STAFF_PASSWORD_LENGTH,
  PASSWORD_RESET_CODE_MINUTES,
  STAFF_DOMAIN_MESSAGE,
  isStaffEmail,
  newPasswordProblem,
} from "@/domain/staff";

/**
 * Everything shown to someone who is not signed in: the shared frame, sign-in,
 * password reset and accepting an invitation.
 */

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

function NewPasswordFields({ autoFocus = false }: { autoFocus?: boolean }) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_STAFF_PASSWORD_LENGTH}
          required
          autoFocus={autoFocus}
        />
        <p className="text-xs text-muted-foreground">
          At least {MIN_STAFF_PASSWORD_LENGTH} characters.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={MIN_STAFF_PASSWORD_LENGTH}
          required
        />
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- sign in */

const SIGN_IN_NOTICES = {
  reset: "Password changed. Sign in with your new password.",
  welcome: "Your account is ready. Sign in with the password you just chose.",
} as const;

export function SignInForm({
  next,
  notice,
}: {
  next: string;
  /** Arrived here from a completed password reset or a used invitation. */
  notice: keyof typeof SIGN_IN_NOTICES | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();

    // The server refuses these too; saying so here is only the kinder message.
    if (!isStaffEmail(email)) {
      setError(STAFF_DOMAIN_MESSAGE);
      return;
    }

    setPending(true);
    const result = await signIn.email({
      email,
      password: String(form.get("password") ?? ""),
    });

    if (result.error) {
      // Deliberately vague: never reveal whether an address has an account.
      setError("Those details did not match an account.");
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

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="you@vara5.com"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-xs text-muted-foreground hover:underline"
          >
            Forgot your password?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <Problem message={error} />

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Sign in
      </Button>
    </form>
  );
}

/* --------------------------------------------------------- password reset */

type ResetStep = { stage: "request" } | { stage: "reset"; email: string };

/**
 * Two steps: ask for a code, then use it.
 *
 * The first step moves on whether or not the address has an account, and says
 * so conditionally. Anything else would let this page confirm which email
 * addresses belong to Vara5 staff.
 */
export function ForgotPasswordForm() {
  const router = useRouter();
  const [step, setStep] = useState<ResetStep>({ stage: "request" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendCode(email: string) {
    setError(null);
    setNotice(null);

    if (!isStaffEmail(email)) {
      setError(STAFF_DOMAIN_MESSAGE);
      return false;
    }

    setPending(true);
    const result = await authClient.emailOtp.requestPasswordReset({ email });
    setPending(false);

    if (result.error) {
      setError(
        result.error.status === 429
          ? "Too many requests. Wait a minute, then try again."
          : result.error.status === 403
            ? STAFF_DOMAIN_MESSAGE
            : "The code could not be sent. Check the address and try again.",
      );
      return false;
    }
    return true;
  }

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();

    if (await sendCode(email)) setStep({ stage: "reset", email });
  }

  async function handleReset(event: FormEvent<HTMLFormElement>, email: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const otp = String(form.get("otp") ?? "").replace(/\s/g, "");
    const password = String(form.get("password") ?? "");

    setNotice(null);
    const problem = newPasswordProblem(password, String(form.get("confirm") ?? ""));
    setError(problem);
    if (problem) return;

    setPending(true);
    const result = await authClient.emailOtp.resetPassword({ email, otp, password });

    if (result.error) {
      setPending(false);
      setError("That code is wrong or has expired. Send a new one and try again.");
      return;
    }

    router.push("/sign-in?reset=1");
  }

  if (step.stage === "request") {
    return (
      <form onSubmit={handleRequest} className="mt-8 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            placeholder="you@vara5.com"
          />
        </div>

        <Problem message={error} />

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Email me a code
        </Button>

        <p className="text-center text-sm">
          <Link href="/sign-in" className="text-muted-foreground hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    );
  }

  return (
    <form
      onSubmit={(event) => handleReset(event, step.email)}
      className="mt-8 space-y-5"
    >
      <Alert>
        <AlertDescription>
          If {step.email} has a Blackbook account, a code is on its way. It
          expires in {PASSWORD_RESET_CODE_MINUTES} minutes.
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label htmlFor="otp">Code</Label>
        <Input
          id="otp"
          name="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
          autoFocus
          placeholder="123456"
          className="tabular tracking-[0.3em]"
        />
      </div>

      <NewPasswordFields />

      <Problem message={error} />
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Set new password
      </Button>

      <div className="flex justify-between text-sm">
        <button
          type="button"
          className="text-muted-foreground hover:underline disabled:opacity-50"
          disabled={pending}
          onClick={async () => {
            if (await sendCode(step.email)) setNotice("A new code is on its way.");
          }}
        >
          Send a new code
        </button>
        <button
          type="button"
          className="text-muted-foreground hover:underline"
          onClick={() => {
            setError(null);
            setNotice(null);
            setStep({ stage: "request" });
          }}
        >
          Use a different email
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- invitation */

export function AcceptInvitationForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");

    const problem = newPasswordProblem(password, String(form.get("confirm") ?? ""));
    setError(problem);
    if (problem) return;

    setPending(true);
    const result = await acceptInvitationAction(token, password);
    if (!result.ok) {
      setPending(false);
      setError(result.fieldErrors?.password?.[0] ?? result.error);
      return;
    }

    router.push("/sign-in?welcome=1");
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-5">
      {/* Lets a password manager save the new password against the right address. */}
      <input
        type="email"
        name="username"
        autoComplete="username"
        value={email}
        readOnly
        hidden
      />

      <NewPasswordFields autoFocus />

      <Problem message={error} />

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Create my account
      </Button>
    </form>
  );
}
