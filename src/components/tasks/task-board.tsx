"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createTaskAction, setTaskStatusAction } from "@/actions/task-actions";
import { EmptyState } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { TASK_PRIORITIES, TASK_STATUS_LABELS } from "@/domain/engagement";
import { formatDate, humanise } from "@/lib/format";
import { cn } from "@/lib/utils";

const UNASSIGNED = "__unassigned__";

type TaskRow = {
  id: string;
  title: string;
  details: string | null;
  dueDate: string | null;
  status: "open" | "in_progress" | "done" | "cancelled";
  priority: "low" | "normal" | "high";
  customerId: string | null;
  customerName: string | null;
  assigneeName: string | null;
};

export function TaskBoard({
  tasks,
  staff,
  includeDone,
  canManage,
}: {
  tasks: TaskRow[];
  staff: { id: string; name: string }[];
  includeDone: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle(task: TaskRow, done: boolean) {
    startTransition(async () => {
      const result = await setTaskStatusAction(task.id, done ? "done" : "open");
      if (result.ok) router.refresh();
      else toast.error(result.error);
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={includeDone ? "/tasks" : "/tasks?done=1"}
          className="text-sm text-muted-foreground hover:underline"
        >
          {includeDone ? "Hide completed" : "Show completed"}
        </Link>

        {canManage ? <NewTaskDialog staff={staff} /> : null}
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks"
          description="Add a follow-up so nothing depends on someone remembering it."
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {tasks.map((task) => {
            const done = task.status === "done";
            const overdue =
              !done &&
              task.dueDate !== null &&
              new Date(task.dueDate) < new Date(new Date().toDateString());

            return (
              <li key={task.id} className="flex items-start gap-3 p-4">
                <Checkbox
                  checked={done}
                  disabled={!canManage || pending}
                  aria-label={`Mark ${task.title} done`}
                  onCheckedChange={(value) => toggle(task, value === true)}
                  className="mt-0.5"
                />

                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", done && "text-muted-foreground line-through")}>
                    {task.title}
                  </p>

                  {task.details ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {task.details}
                    </p>
                  ) : null}

                  <p className="tabular mt-1 text-xs text-muted-foreground">
                    {[
                      task.dueDate ? `Due ${formatDate(task.dueDate)}` : null,
                      task.assigneeName,
                      TASK_STATUS_LABELS[task.status],
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>

                  {task.customerId ? (
                    <Link
                      href={`/clients/${task.customerId}`}
                      className="mt-1 inline-block text-xs hover:underline"
                    >
                      {task.customerName}
                    </Link>
                  ) : null}
                </div>

                <div className="flex shrink-0 gap-2">
                  {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                  {task.priority === "high" ? (
                    <Badge variant="secondary">High</Badge>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NewTaskDialog({ staff }: { staff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState(UNASSIGNED);
  const [priority, setPriority] =
    useState<(typeof TASK_PRIORITIES)[number]>("normal");

  function submit() {
    startTransition(async () => {
      const result = await createTaskAction({
        title,
        details,
        dueDate,
        priority,
        assigneeId: assigneeId === UNASSIGNED ? null : assigneeId,
      });

      if (result.ok) {
        toast.success("Task added");
        setOpen(false);
        setTitle("");
        setDetails("");
        setDueDate("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          New task
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Call the Sharmas about Japan dates"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-details">Details</Label>
            <Textarea
              id="task-details"
              rows={3}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="task-due">Due date</Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-priority">Priority</Label>
              <Select
                value={priority}
                onValueChange={(value) =>
                  setPriority(value as (typeof TASK_PRIORITIES)[number])
                }
              >
                <SelectTrigger id="task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {humanise(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-assignee">Assign to</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger id="task-assignee">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {staff.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={pending || title.trim().length === 0}
          >
            Add task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
