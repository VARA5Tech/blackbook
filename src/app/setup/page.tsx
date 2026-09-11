import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { needsSetup } from "@/services/setup-service";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up" };

// Whether this page exists at all depends on the database, every time.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  // Closed permanently the moment any account exists.
  if (!(await needsSetup())) notFound();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--brand-surface)] px-6 py-16 text-[var(--brand-surface-foreground)]">
      <div className="w-full max-w-sm">
        <Image
          src="/brand/blackbook-logo-dark.svg"
          alt="Blackbook"
          width={900}
          height={636}
          priority
          className="h-auto w-36"
        />

        <h1 className="mt-10 font-display text-2xl tracking-tight">
          Create the first administrator
        </h1>
        <p className="mt-2 text-sm opacity-70">
          This instance has no accounts yet. Whoever completes this form becomes
          the administrator, and this page then closes for good.
        </p>

        <SetupForm />
      </div>
    </main>
  );
}
