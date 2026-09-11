"use client";

import { ChevronsUpDown, LogOut, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import type { Actor } from "@/auth/session";
import { ROLE_LABELS } from "@/auth/permissions";
import { signOut } from "@/auth/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  getServerTheme,
  getTheme,
  setTheme,
  subscribeToTheme,
} from "@/lib/theme";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ actor }: { actor: Actor }) {
  const router = useRouter();
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getTheme,
    getServerTheme,
  );
  const dark = theme === "dark";

  function toggleTheme() {
    setTheme(dark ? "light" : "dark");
  }

  async function handleSignOut() {
    await signOut();
    router.push("/sign-in");
    router.refresh();
  }

  const initials = actor.name
    .split(" ")
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full justify-start gap-2 px-2 py-2"
        >
          <Avatar className="size-7">
            <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium">
              {actor.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {ROLE_LABELS[actor.role]}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-medium">{actor.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {actor.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={toggleTheme}>
          {dark ? <Sun /> : <Moon />}
          {dark ? "Light theme" : "Dark theme"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
