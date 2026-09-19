"use client";

import { Crown, Plus, Unlink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addHouseholdMemberAction,
  removeHouseholdMemberAction,
  updateHouseholdAction,
} from "@/actions/crm-actions";
import { Section } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HOUSEHOLD_ROLES,
  HOUSEHOLD_ROLE_LABELS,
  displayName,
  initials,
  type ClientStatus,
  CLIENT_STATUS_LABELS,
} from "@/domain/customers";
import { age, timeAgo } from "@/lib/format";

type Member = {
  id: string;
  ref: string;
  firstName: string;
  lastName: string | null;
  preferredName: string | null;
  householdRole:
    | "primary"
    | "spouse"
    | "partner"
    | "child"
    | "parent"
    | "sibling"
    | "other"
    | null;
  dateOfBirth: string | null;
  status: ClientStatus;
  city: string | null;
  lastInteractionAt: Date | null;
  rmName: string | null;
};

type Candidate = { id: string; ref: string; label: string };

export function HouseholdMembers({
  householdId,
  primaryCustomerId,
  members,
  candidates,
  canManage,
}: {
  householdId: string;
  primaryCustomerId: string | null;
  members: Member[];
  candidates: Candidate[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function unlink(customerId: string, name: string) {
    startTransition(async () => {
      const result = await removeHouseholdMemberAction(householdId, customerId);
      if (result.ok) {
        toast.success(`${name} removed from the household`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function makePrimary(customerId: string) {
    startTransition(async () => {
      const result = await updateHouseholdAction({
        id: householdId,
        primaryCustomerId: customerId,
      });
      if (result.ok) {
        toast.success("Primary client updated");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Section
      title="Members"
      action={
        canManage ? (
          <AddMemberPopover
            householdId={householdId}
            candidates={candidates}
            onAdded={() => router.refresh()}
          />
        ) : null
      }
    >
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No members yet. Link an existing client to build the family.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {members.map((member) => (
            <li
              key={member.id}
              className="group flex items-center gap-3 py-3"
            >
              <Avatar className="size-9 shrink-0">
                <AvatarFallback className="text-[11px]">
                  {initials(member)}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/clients/${member.id}`}
                    className="font-medium hover:underline"
                  >
                    {displayName(member)}
                  </Link>
                  {member.id === primaryCustomerId ? (
                    <Badge variant="secondary" className="gap-1">
                      <Crown className="size-3" />
                      Primary
                    </Badge>
                  ) : null}
                  {member.status !== "active" ? (
                    <Badge variant="outline">{CLIENT_STATUS_LABELS[member.status]}</Badge>
                  ) : null}
                </div>

                <p className="tabular text-xs text-muted-foreground">
                  {[
                    member.householdRole
                      ? HOUSEHOLD_ROLE_LABELS[member.householdRole]
                      : null,
                    age(member.dateOfBirth) !== null
                      ? `${age(member.dateOfBirth)} years`
                      : null,
                    member.ref,
                    `Last contact ${timeAgo(member.lastInteractionAt)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              {canManage ? (
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  {member.id !== primaryCustomerId ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => makePrimary(member.id)}
                    >
                      Make primary
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${displayName(member)}`}
                    disabled={pending}
                    onClick={() => unlink(member.id, displayName(member))}
                  >
                    <Unlink className="size-3.5" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function AddMemberPopover({
  householdId,
  candidates,
  onAdded,
}: {
  householdId: string;
  candidates: Candidate[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<(typeof HOUSEHOLD_ROLES)[number]>("spouse");
  const [pending, startTransition] = useTransition();

  function add(customerId: string) {
    startTransition(async () => {
      const result = await addHouseholdMemberAction({
        householdId,
        customerId,
        householdRole: role,
      });

      if (result.ok) {
        toast.success("Member linked");
        setOpen(false);
        onAdded();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Plus className="size-3.5" />
          Link client
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0" align="end">
        <div className="border-b border-border p-3">
          <Select
            value={role}
            onValueChange={(value) =>
              setRole(value as (typeof HOUSEHOLD_ROLES)[number])
            }
          >
            <SelectTrigger aria-label="Role in household">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOUSEHOLD_ROLES.map((value) => (
                <SelectItem key={value} value={value}>
                  {HOUSEHOLD_ROLE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Command>
          <CommandInput placeholder="Find a client..." />
          <CommandList className="max-h-64">
            <CommandEmpty>
              No unlinked clients. A client can belong to one household at a
              time.
            </CommandEmpty>
            <CommandGroup>
              {candidates.map((candidate) => (
                <CommandItem
                  key={candidate.id}
                  value={`${candidate.label} ${candidate.ref}`}
                  disabled={pending}
                  onSelect={() => add(candidate.id)}
                >
                  <span className="flex-1 truncate">{candidate.label}</span>
                  <span className="tabular text-xs text-muted-foreground">
                    {candidate.ref}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
