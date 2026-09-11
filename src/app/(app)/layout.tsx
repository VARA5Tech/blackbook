import { redirect } from "next/navigation";
import { getActor } from "@/auth/session";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { CommandPalette } from "@/components/shell/command-palette";

/**
 * Every screen behind the shell reads the session and live client data, so
 * nothing here may be prerendered at build time.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");

  return (
    <div className="flex min-h-dvh">
      <AppSidebar actor={actor} />

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-8 lg:px-10">
          {children}
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}
