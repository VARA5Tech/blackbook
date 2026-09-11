"use client";

import {
  Activity,
  CalendarHeart,
  CheckSquare,
  Home,
  Search,
  Users,
  UsersRound,
  Shield,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Actor } from "@/auth/session";
import { roleCan, type Capability } from "@/auth/permissions";
import { UserMenu } from "@/components/shell/user-menu";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Home;
  exact?: boolean;
  /** Hidden unless the signed-in user holds this capability. */
  capability?: Capability;
};

const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/households", label: "Households", icon: UsersRound },
  { href: "/milestones", label: "Milestones", icon: CalendarHeart },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/activity", label: "Activity", icon: Activity },
  {
    href: "/settings/users",
    label: "Team",
    icon: Shield,
    capability: "user.manage",
  },
];

export function AppSidebar({ actor }: { actor: Actor }) {
  const pathname = usePathname();

  function openSearch() {
    document.dispatchEvent(new CustomEvent("vara5:open-command"));
  }

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="px-5 pt-6 pb-4">
        {/*
          The guide names the compact horizontal lockup for a CRM navbar, and
          ships it drawn in ink and in champagne. Both are rendered and CSS
          picks, so the mark is right on the first paint, before hydration.
        */}
        <Link href="/" aria-label="Blackbook home" className="inline-block">
          <Image
            src="/brand/blackbook-horizontal-compact-light.svg"
            alt="Blackbook"
            width={1100}
            height={180}
            priority
            className="h-[22px] w-auto dark:hidden"
          />
          <Image
            src="/brand/blackbook-horizontal-compact-dark.svg"
            alt=""
            aria-hidden
            width={1100}
            height={180}
            className="hidden h-[22px] w-auto dark:block"
          />
        </Link>
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={openSearch}
          className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-background/60 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-background"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 truncate">Search clients</span>
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium">
            ⌘K
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
