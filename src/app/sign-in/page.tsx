import type { Metadata } from "next";
import { AuthShell, SignInForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";

  return (
    <AuthShell title="Sign in" description="Use your Vara5 email address.">
      <SignInForm
        next={next}
        notice={
          params.reset === "1" ? "reset" : params.welcome === "1" ? "welcome" : null
        }
      />
    </AuthShell>
  );
}
