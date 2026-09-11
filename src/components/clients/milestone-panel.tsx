"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  archiveMilestoneAction,
  createMilestoneAction,
} from "@/actions/crm-actions";
import { Section } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Textarea } from "@/components/ui/textarea";
import { MILESTONE_TYPES, MILESTONE_TYPE_LABELS } from "@/domain/milestones";
import { countdown, formatDate } from "@/lib/format";

export type ClientMilestone = {
  id: string;
  customerId: string | null;
  householdId: string | null;
  type: (typeof MILESTONE_TYPES)[number];
  title: string;
  date: string;
  celebrationStyle: string | null;
  notes: string | null;
  nextOccurrence: string;
  daysUntil: number;
};

export function MilestonePanel({
  milestones,
  customerId,
  canManage,
}: {
  milestones: ClientMilestone[];
  customerId: string;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    startTransition(async () => {
      const result = await archiveMilestoneAction(id, customerId);
      if (result.ok) toast.success("Milestone removed");
      else toast.error(result.error);
    });
  }

  return (
    <Section
      title="Milestones"
      action={
        canManage ? (
          <AddMilestoneDialog customerId={customerId} />
        ) : null
      }
    >
      {milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No important dates recorded.
        </p>
      ) : (
        <ul className="space-y-3">
          {milestones.map((milestone) => (
            <li key={milestone.id} className="group flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{milestone.title}</p>
                <p className="tabular text-xs text-muted-foreground">
                  {formatDate(milestone.nextOccurrence)} ·{" "}
                  {countdown(milestone.daysUntil)}
                  {milestone.householdId ? " · Household" : ""}
                </p>
                <p className="tabular text-xs text-muted-foreground">
                  Originally {formatDate(milestone.date)}
                </p>
                {milestone.celebrationStyle ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {milestone.celebrationStyle}
                  </p>
                ) : null}
              </div>

              {canManage && milestone.customerId ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label={`Remove ${milestone.title}`}
                  disabled={pending}
                  onClick={() => remove(milestone.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function AddMilestoneDialog({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<(typeof MILESTONE_TYPES)[number]>("birthday");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [celebrationStyle, setCelebrationStyle] = useState("");
  const [notes, setNotes] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await createMilestoneAction({
        customerId,
        type,
        title: title.trim() || MILESTONE_TYPE_LABELS[type],
        date,
        celebrationStyle,
        notes,
      });

      if (result.ok) {
        toast.success("Milestone added");
        setOpen(false);
        setTitle("");
        setDate("");
        setCelebrationStyle("");
        setNotes("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Plus className="size-3.5" />
          Add
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add milestone</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="milestone-type">Type</Label>
            <Select
              value={type}
              onValueChange={(value) =>
                setType(value as (typeof MILESTONE_TYPES)[number])
              }
            >
              <SelectTrigger id="milestone-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MILESTONE_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {MILESTONE_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="milestone-title">Title</Label>
            <Input
              id="milestone-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={MILESTONE_TYPE_LABELS[type]}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="milestone-date">Date</Label>
            <Input
              id="milestone-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="milestone-style">Celebration style</Label>
            <Input
              id="milestone-style"
              value={celebrationStyle}
              onChange={(event) => setCelebrationStyle(event.target.value)}
              placeholder="Private dinner, nothing public"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="milestone-notes">Notes</Label>
            <Textarea
              id="milestone-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={pending || date.length === 0}
          >
            Add milestone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
