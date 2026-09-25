"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  inviteStaffAction,
  resendInvitationAction,
  revokeInvitationAction,
  setUserRoleAction,
} from "@/actions/user-actions";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  roleCan,
  type AssignableRole,
} from "@/auth/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UserRole } from "@/db/schema";
import {
  INVITATION_DAYS,
  STAFF_EMAIL_SUFFIX,
  staffEmailLocalPart,
} from "@/domain/staff";
import { formatDate } from "@/lib/format";

/**
 * Offered least to most, and without `viewer`, which is retired. Somebody who
 * still holds it keeps it until they are changed; nobody can be given it.
 */
const ROLES: readonly UserRole[] = ASSIGNABLE_ROLES;

type StaffRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  banned: boolean | null;
  createdAt: Date;
  /** Set while the person has not used their invitation: when it lapses. */
  inviteExpiresAt: Date | null;
};

type ActionResult = { ok: true } | { ok: false; error: string };

export function UserTable({
  users,
  currentUserId,
}: {
  users: StaffRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function act(action: () => Promise<ActionResult>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <NewUserDialog />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Email</TableHead>
              <TableHead className="hidden md:table-cell">Added</TableHead>
              <TableHead className="w-52">Role</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              const invited = user.inviteExpiresAt !== null;

              return (
                <TableRow key={user.id}>
                  <TableCell>
                    <span className="font-medium">{user.name}</span>
                    {isSelf ? (
                      <Badge variant="secondary" className="ml-2">
                        You
                      </Badge>
                    ) : null}
                    {user.banned ? (
                      <Badge variant="outline" className="ml-2">
                        Suspended
                      </Badge>
                    ) : null}
                    {invited ? (
                      <>
                        <Badge variant="outline" className="ml-2">
                          Invited
                        </Badge>
                        <div className="mt-1 flex gap-3 text-xs">
                          <button
                            type="button"
                            className="text-muted-foreground hover:underline disabled:opacity-50"
                            disabled={pending}
                            onClick={() =>
                              act(
                                () => resendInvitationAction(user.id),
                                `A new link is on its way to ${user.email}`,
                              )
                            }
                          >
                            Send again
                          </button>
                          <button
                            type="button"
                            className="text-muted-foreground hover:underline disabled:opacity-50"
                            disabled={pending}
                            onClick={() =>
                              act(
                                () => revokeInvitationAction(user.id),
                                "Invitation withdrawn",
                              )
                            }
                          >
                            Withdraw
                          </button>
                        </div>
                      </>
                    ) : null}
                  </TableCell>

                  <TableCell className="hidden text-sm sm:table-cell">
                    {user.email}
                  </TableCell>

                  <TableCell className="tabular hidden text-sm md:table-cell">
                    {user.inviteExpiresAt
                      ? `Lapses ${formatDate(user.inviteExpiresAt)}`
                      : formatDate(user.createdAt)}
                  </TableCell>

                  <TableCell>
                    <Select
                      value={user.role}
                      disabled={pending}
                      onValueChange={(value) =>
                        act(
                          () => setUserRoleAction(user.id, value as UserRole),
                          "Role updated",
                        )
                      }
                    >
                      <SelectTrigger aria-label={`Role for ${user.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((role) => (
                          <SelectItem
                            key={role}
                            value={role}
                            /*
                              Dropping your own user management would lock the
                              last administrator out; the service refuses it
                              too. Asked as a capability, so a founder can move
                              to Admin and back without being stopped.
                            */
                            disabled={isSelf && !roleCan(role, "user.manage")}
                          >
                            {ROLE_LABELS[role]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}


function NewUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // Only a role that may be given: the form never offers the retired one.
  const [role, setRole] = useState<AssignableRole>("rm");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function reset() {
    setName("");
    setEmail("");
    setFieldErrors({});
  }

  function submit() {
    setFieldErrors({});
    startTransition(async () => {
      // The raw field goes to the server, which completes a bare name with
      // @vara5.com and refuses any other domain. Nothing here is trusted.
      const result = await inviteStaffAction({ name, email, role });

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }

      toast.success("Invitation sent");
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Add colleague
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a colleague</DialogTitle>
          <DialogDescription>
            They get an email saying the account exists. Signing in is an
            emailed code, so there is nothing for them to set up. An account
            nobody uses within {INVITATION_DAYS} days is removed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="user-name">Name</Label>
            <Input
              id="user-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {fieldErrors.name ? (
              <p className="text-xs text-destructive">{fieldErrors.name[0]}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="user-email">Email</Label>
            <InputGroup>
              <InputGroupInput
                id="user-email"
                value={email}
                // Pasting a full Vara5 address keeps only the name before @.
                onChange={(event) => setEmail(staffEmailLocalPart(event.target.value))}
                placeholder="firstname.lastname"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={Boolean(fieldErrors.email)}
              />
              {email.includes("@") ? null : (
                <InputGroupAddon align="inline-end">{STAFF_EMAIL_SUFFIX}</InputGroupAddon>
              )}
            </InputGroup>
            {fieldErrors.email ? (
              <p className="text-xs text-destructive">{fieldErrors.email[0]}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Type the name, or paste the full address. Only {STAFF_EMAIL_SUFFIX}{" "}
                addresses can be added.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="user-role">Role</Label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as AssignableRole)}
            >
              <SelectTrigger id="user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={pending || name.trim() === "" || email.trim() === ""}
          >
            Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
