"use client";

import {
  ChevronsUpDown,
  KeyRound,
  Loader2,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import type { Actor } from "@/auth/session";
import { ROLE_LABELS } from "@/auth/permissions";
import { authClient, signOut } from "@/auth/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_STAFF_PASSWORD_LENGTH, newPasswordProblem } from "@/domain/staff";
import {
  getServerTheme,
  getTheme,
  setTheme,
  subscribeToTheme,
} from "@/lib/theme";

export function UserMenu({ actor }: { actor: Actor }) {
  const router = useRouter();
  const [changingPassword, setChangingPassword] = useState(false);
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
    <>
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
          {/* Opened after the menu closes, so the dialog keeps focus. */}
          <DropdownMenuItem onSelect={() => setChangingPassword(true)}>
            <KeyRound />
            Change password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangePasswordDialog
        open={changingPassword}
        onOpenChange={setChangingPassword}
      />
    </>
  );
}

/**
 * Changes the signed-in person's own password.
 *
 * Every other session is signed out as part of the change. Someone changing a
 * password is often doing it because they suspect it is known; leaving their
 * other devices signed in would defeat the reason for changing it.
 */
function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function close(next: boolean) {
    if (!next) {
      setError(null);
      setDone(false);
    }
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("current") ?? "");
    const newPassword = String(form.get("password") ?? "");

    const problem =
      newPasswordProblem(newPassword, String(form.get("confirm") ?? "")) ??
      (newPassword === currentPassword
        ? "Choose a password different from the current one."
        : null);
    setError(problem);
    if (problem) return;

    setPending(true);
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setPending(false);

    if (result.error) {
      setError(
        result.error.status === 400 || result.error.status === 401
          ? "That is not your current password."
          : "Your password could not be changed. Try again.",
      );
      return;
    }

    setDone(true);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Your other devices will be signed out.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <>
            <Alert>
              <AlertDescription>
                Password changed. Use the new one next time you sign in.
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                name="current"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={MIN_STAFF_PASSWORD_LENGTH}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={MIN_STAFF_PASSWORD_LENGTH}
                required
              />
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                Change password
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
