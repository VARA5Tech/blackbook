import type { Metadata } from "next";
import Link from "next/link";
import { AcceptInvitationForm, AuthShell } from "@/components/auth/auth-forms";
import { findInvitationByToken } from "@/services/user-service";

export const metadata: Metadata = {
  title: "Join Blackbook",
  // The token is in the path, so it must not leave in a Referer header.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await findInvitationByToken(token);

  if (!invitation) {
    return (
      <AuthShell
        title="This link no longer works"
        description="Invitations work once and lapse after two days. If you have already set your password, sign in. Otherwise ask a Vara5 administrator to invite you again."
      >
        <p className="mt-8 text-sm">
          <Link href="/sign-in" className="text-muted-foreground hover:underline">
            Go to sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  const firstName = invitation.name.split(/\s+/)[0] || invitation.name;

  return (
    <AuthShell
      title={`Welcome, ${firstName}`}
      description={`Choose a password for ${invitation.email} to finish setting up your account.`}
    >
      <AcceptInvitationForm token={token} email={invitation.email} />
    </AuthShell>
  );
}
