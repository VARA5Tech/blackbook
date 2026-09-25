"use client";

import {
  Activity,
  CalendarHeart,
  ChartLine,
  House,
  LayoutDashboard,
  ListChecks,
  MailPlus,
  Plus,
  Search,
  UserCog,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import type { Actor } from "@/auth/session";
import { roleCan, type Capability } from "@/auth/permissions";
import { DeskHud, type DeskStatus } from "@/components/shell/desk-hud";
import { UserMenu } from "@/components/shell/user-menu";
import {
  AnimatedDropdown,
  type AnimatedDropdownItem,
} from "@/components/ui/animated-dropdown";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Hidden unless the signed-in user holds this capability. */
  capability?: Capability;
};

const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: LayoutDashboard, exact: true },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/households", label: "Households", icon: House },
  { href: "/milestones", label: "Milestones", icon: CalendarHeart },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/activity", label: "Activity", icon: Activity },
  {
    href: "/analytics",
    label: "Analytics",
    icon: ChartLine,
    capability: "analytics.read",
  },
  {
    href: "/settings/users",
    label: "Team",
    icon: UserCog,
    capability: "user.manage",
  },
];

/** The quick-create menu. Each entry only appears to someone who can use it. */
const CREATE: (AnimatedDropdownItem & { capability: Capability })[] = [
  {
    label: "New client",
    href: "/clients/new",
    icon: UserPlus,
    description: "Add someone to the client list",
    capability: "client.create",
  },
  {
    label: "New household",
    href: "/households/new",
    icon: House,
    description: "Group a family under one record",
    capability: "household.manage",
  },
  {
    label: "Invite a colleague",
    href: "/settings/users",
    icon: MailPlus,
    description: "Give someone at Vara5 access",
    capability: "user.manage",
  },
];

/**
 * The key that actually opens search on this machine.
 *
 * Only the browser knows which one it is, so the server renders nothing and the
 * label appears on hydration. The box is already its final size, so nothing
 * moves when it fills in. Rendering a guess instead would tell half the desk to
 * press a key their keyboard does not have.
 */
const noChanges = () => () => {};

function useSearchShortcut(): string {
  return useSyncExternalStore(
    noChanges,
    () => {
      const platform =
        (navigator as { userAgentData?: { platform?: string } }).userAgentData
          ?.platform ?? navigator.platform;
      return /mac|iphone|ipad/i.test(platform) ? "⌘K" : "Ctrl K";
    },
    () => "",
  );
}

/**
 * One column down the left, always there.
 *
 * It does not collapse. The reason is what sits at the top of it: a panel of
 * everything the desk has not answered yet, which is worth nothing if it can
 * be folded away, and a menu that hides is a menu somebody hides on the first
 * busy morning. The width it costs is the width of the thing that must not be
 * missed.
 *
 * Read top to bottom it is: the mark, what is outstanding, what you can start,
 * where you can go, and last, who you are.
 */
export function AppSidebar({ actor, desk }: { actor: Actor; desk: DeskStatus | null }) {
  const pathname = usePathname();
  const shortcut = useSearchShortcut();
  const createItems = CREATE.filter((item) => roleCan(actor.role, item.capability));

  function openSearch() {
    document.dispatchEvent(new CustomEvent("vara5:open-command"));
  }

  return (
    /*
     * Wider than a menu needs, because it is not only a menu. The desk panel
     * at the top carries a lead's title beside how long is left, and at the
     * old width both were cut: "Antarctica — White …" against "1 day left"
     * says neither thing properly.
     */
    <aside className="sticky top-0 hidden h-dvh w-82 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar md:flex">
      {/*
        The mark on its own black panel, flush into the corner of the window.

        On the sidebar's own background it was camouflage: ink on ivory, the
        same weight as the menu under it. A fixed brand surface is the answer,
        painted with `--brand-surface` rather than `--primary`, which inverts
        between themes — this panel is black in both, so one file is rendered
        rather than a light and dark pair and it is right before hydration.

        White rather than the champagne lockup, which is the guide's default on
        black: at this size the champagne sat too close to the panel to read
        cleanly, and the mark is the one thing on the screen that has to.

        Two of the edges are the window's own, so only the inner corner is
        rounded. The lockup is held to a fixed height rather than stretched to
        the panel: at full width it outweighed everything under it, and the
        masthead should announce the product, not compete with the desk.
      */}
      <Link
        href="/"
        aria-label="Blackbook home"
        className="block rounded-br-2xl bg-[color:var(--brand-surface)] px-5 py-3.5 transition-opacity hover:opacity-90"
      >
        <Image
          src="/brand/blackbook-horizontal-compact-white.svg"
          alt="Blackbook"
          width={1100}
          height={180}
          priority
          className="-ml-1.5 h-9 w-auto"
        />
      </Link>

      {desk ? (
        <div className="p-3">
          <DeskHud status={desk} />
        </div>
      ) : null}

      <div className="space-y-2 px-3 pb-3">
        {createItems.length > 0 ? (
          <AnimatedDropdown
            label="Create"
            icon={Plus}
            items={createItems}
            className="w-full"
            triggerClassName="h-9 w-full"
          />
        ) : null}
        <button
          type="button"
          onClick={openSearch}
          className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-background/60 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-background"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 truncate">Search clients</span>
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium">
            {shortcut}
          </kbd>
        </button>
      </div>

      {/* Scrolls on a short window, so the desk panel above and the user below
          both keep their place rather than being pushed off the screen. */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {NAV.filter(
          (item) => !item.capability || roleCan(actor.role, item.capability),
        ).map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <item.icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-2 border-t border-sidebar-border p-3">
        <UserMenu actor={actor} />
      </div>
    </aside>
  );
}
