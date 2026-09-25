import { redirect } from "next/navigation";
import { getActor } from "@/auth/session";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { CommandPalette } from "@/components/shell/command-palette";
import { deskStatus } from "@/services/lead-service";

/**
 * Every screen behind the shell reads the session and live client data, so
 * nothing here may be prerendered at build time.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");

  /*
   * Read here rather than per page, so what is outstanding is on every screen
   * and is fetched once. It fails soft: the panel is how the desk is reminded,
   * not how the work is recorded, and a slow count must not take the shell
   * down — the menu simply renders without it.
   */
  const status = await deskStatus().catch(() => null);

  return (
    <div className="flex min-h-dvh">
      <AppSidebar actor={actor} desk={status} />

      {/*
        One column of content beside one column of menu. There is nothing to
        reserve on the right any more: what used to float in that corner now
        lives at the top of the menu, where it cannot be folded away.
      */}
      <main className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 px-6 py-8 lg:px-10">
        {children}
      </main>

      <CommandPalette />
    </div>
  );
}
