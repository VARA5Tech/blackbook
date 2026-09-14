import type { Metadata } from "next";
import { AuthShell, ForgotPasswordForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="We will email a six-digit code to your Vara5 address."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
