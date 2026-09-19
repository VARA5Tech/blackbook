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
    label: "Members",
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

export function AppSidebar({ actor }: { actor: Actor }) {
  const pathname = usePathname();
  const shortcut = useSearchShortcut();
  const createItems = CREATE.filter((item) => roleCan(actor.role, item.capability));

  function openSearch() {
    document.dispatchEvent(new CustomEvent("vara5:open-command"));
  }

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="px-4 pt-6 pb-5">
        {/*
          The guide names the compact horizontal lockup for a CRM navbar, and
          ships it drawn in ink and in champagne. Both are rendered and CSS
          picks, so the mark is right on the first paint, before hydration.

          The SVG carries its own clear space, about a tenth of its width, so it
          is drawn larger than the mark and pulled left to line up with the nav.
        */}
        <Link href="/" aria-label="Blackbook home" className="-ml-1.5 inline-block">
          <Image
            src="/brand/blackbook-horizontal-compact-light.svg"
            alt="Blackbook"
            width={1100}
            height={180}
            priority
            className="h-9 w-auto dark:hidden"
          />
          <Image
            src="/brand/blackbook-horizontal-compact-dark.svg"
            alt=""
            aria-hidden
            width={1100}
            height={180}
            className="hidden h-9 w-auto dark:block"
          />
        </Link>
      </div>

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

      <nav className="flex-1 space-y-0.5 px-3">
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

      <div className="border-t border-sidebar-border p-3">
        <UserMenu actor={actor} />
      </div>
    </aside>
  );
}
