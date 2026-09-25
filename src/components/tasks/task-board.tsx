"use client";

import { ArrowUpRight, Plus, Sparkles } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  customerRef: string | null;
  assigneeName: string | null;
  leadId: string | null;
  leadTitle: string | null;
  leadStatus: string | null;
  createdAt: Date | string;
  completedAt: Date | string | null;
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
  /** The task whose details are open, if any. */
  const [open, setOpen] = useState<TaskRow | null>(null);
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
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10" />
                <TableHead>Task</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Raised for</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {tasks.map((task) => {
                const done = task.status === "done";
                const overdue =
                  !done &&
                  task.dueDate !== null &&
                  new Date(task.dueDate) < new Date(new Date().toDateString());

                return (
                  <TableRow
                    key={task.id}
                    /* The whole row opens the task: a list somebody has to aim
                       at a single small link is a list they stop using. */
                    className="cursor-pointer align-top"
                    onClick={() => setOpen(task)}
                  >
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={done}
                        disabled={!canManage || pending}
                        aria-label={`Mark ${task.title} done`}
                        onCheckedChange={(value) => toggle(task, value === true)}
                      />
                    </TableCell>

                    <TableCell className="max-w-72">
                      <span className={cn("block truncate text-sm", done && "text-muted-foreground line-through")}>
                        {task.title}
                      </span>
                      {task.details ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {task.details}
                        </span>
                      ) : null}
                    </TableCell>

                    <TableCell className="max-w-40">
                      {task.customerId ? (
                        <span className="block truncate text-sm">{task.customerName}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                      {task.customerRef ? (
                        <span className="tabular block text-xs text-muted-foreground">
                          {task.customerRef}
                        </span>
                      ) : null}
                    </TableCell>

                    <TableCell className="max-w-40">
                      {task.leadTitle ? (
                        <span className="flex items-center gap-1.5 text-sm">
                          <Sparkles
                            className="size-3.5 shrink-0"
                            style={{ color: "var(--chart-1)" }}
                          />
                          <span className="truncate">{task.leadTitle}</span>
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    <TableCell className="tabular whitespace-nowrap text-sm">
                      {task.dueDate ? formatDate(task.dueDate) : "—"}
                    </TableCell>

                    <TableCell className="max-w-32">
                      <span className="block truncate text-sm">
                        {task.assigneeName ?? "Nobody"}
                      </span>
                    </TableCell>

                    <TableCell className="text-right">
                      <span className="inline-flex flex-wrap justify-end gap-1.5">
                        {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                        {task.priority === "high" ? (
                          <Badge variant="secondary">High</Badge>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {TASK_STATUS_LABELS[task.status]}
                        </span>
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <TaskDetail task={open} onClose={() => setOpen(null)} />
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

/**
 * One task in full, opened from the row.
 *
 * The list answers "what is outstanding"; this answers "what is this". It
 * carries the links out to the client and to the lead it was raised for,
 * because a task that cannot tell you why it exists is a task nobody trusts.
 */
function TaskDetail({
  task,
  onClose,
}: {
  task: TaskRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={task !== null} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        {task ? (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6 text-left">{task.title}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              {task.details ? (
                <p className="text-muted-foreground">{task.details}</p>
              ) : null}

              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <dt className="text-muted-foreground">Status</dt>
                <dd>{TASK_STATUS_LABELS[task.status]}</dd>

                <dt className="text-muted-foreground">Priority</dt>
                <dd className="capitalize">{task.priority}</dd>

                <dt className="text-muted-foreground">Due</dt>
                <dd className="tabular">
                  {task.dueDate ? formatDate(task.dueDate) : "No date"}
                </dd>

                <dt className="text-muted-foreground">Assigned</dt>
                <dd>{task.assigneeName ?? "Nobody"}</dd>

                <dt className="text-muted-foreground">Raised</dt>
                <dd className="tabular">{formatDate(task.createdAt)}</dd>

                {task.completedAt ? (
                  <>
                    <dt className="text-muted-foreground">Finished</dt>
                    <dd className="tabular">{formatDate(task.completedAt)}</dd>
                  </>
                ) : null}
              </dl>

              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                {task.customerId ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/clients/${task.customerId}`}>
                      {task.customerName}
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                  </Button>
                ) : null}

                {/* The lead lives on the client's own page, which is where the
                    rest of the answer is. */}
                {task.leadId && task.customerId ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/clients/${task.customerId}`}>
                      <Sparkles className="size-3.5" style={{ color: "var(--chart-1)" }} />
                      {task.leadTitle}
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
