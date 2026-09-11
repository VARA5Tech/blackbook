"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createStaffUserAction,
  setUserRoleAction,
} from "@/actions/user-actions";
import { ROLE_LABELS } from "@/auth/permissions";
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
import { formatDate } from "@/lib/format";

const ROLES: UserRole[] = ["viewer", "rm", "manager", "admin"];

type StaffRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  banned: boolean | null;
  createdAt: Date;
};

export function UserTable({
  users,
  currentUserId,
}: {
  users: StaffRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function changeRole(userId: string, role: UserRole) {
    startTransition(async () => {
      const result = await setUserRoleAction(userId, role);
      if (result.ok) {
        toast.success("Role updated");
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
                  </TableCell>

                  <TableCell className="hidden text-sm sm:table-cell">
                    {user.email}
                  </TableCell>

                  <TableCell className="tabular hidden text-sm md:table-cell">
                    {formatDate(user.createdAt)}
                  </TableCell>

                  <TableCell>
                    <Select
                      value={user.role}
                      disabled={pending}
                      onValueChange={(value) =>
                        changeRole(user.id, value as UserRole)
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
                            // An administrator demoting themselves would lock
                            // the last one out; the service refuses it too.
                            disabled={isSelf && role !== "admin"}
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
  const [role, setRole] = useState<UserRole>("rm");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function submit() {
    setFieldErrors({});
    startTransition(async () => {
      const result = await createStaffUserAction({
        name,
        email,
        role,
        password,
      });

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }

      toast.success("Account created");
      setOpen(false);
      setName("");
      setEmail("");
      setPassword("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            Nothing sends email yet, so set an initial password and pass it on.
            They can change it once they are in.
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
            <Input
              id="user-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="colleague@vara5.com"
            />
            {fieldErrors.email ? (
              <p className="text-xs text-destructive">{fieldErrors.email[0]}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="user-role">Role</Label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as UserRole)}
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

          <div className="space-y-2">
            <Label htmlFor="user-password">Initial password</Label>
            <Input
              id="user-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              At least 12 characters.
            </p>
            {fieldErrors.password ? (
              <p className="text-xs text-destructive">
                {fieldErrors.password[0]}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={pending || name.trim() === "" || email.trim() === ""}
          >
            Create account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
