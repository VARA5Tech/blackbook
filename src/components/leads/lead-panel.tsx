"use client";

import {
  AlertTriangle,
  Check,
  MessageSquarePlus,
  Plus,
  Sparkles,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  acknowledgeLeadAction,
  advanceLeadAction,
  assignLeadAction,
  createLeadAction,
  remarkLeadAction,
} from "@/actions/client-actions";
import { createTaskAction } from "@/actions/task-actions";
import { Section } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  MANUAL_LEAD_SOURCES,
  type LeadSource,
  type LeadStatus,
} from "@/domain/leads";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ClientLead = {
  id: string;
  title: string;
  destination: string;
  status: LeadStatus;
  dueAt: Date | string;
  acknowledgedAt: Date | string | null;
  droppedReason: string | null;
  outcomeNote: string | null;
  source: LeadSource;
  curatorName: string | null;
  createdAt: Date | string;
  followUps: {
    id: string;
    title: string;
    status: string;
    dueDate: string | null;
    assigneeName: string | null;
  }[];
};

/** Where a lead can go next. A closed one goes nowhere. */
type Onward = "planning" | "booking" | "won" | "dropped";

const NEXT: Record<LeadStatus, Onward[]> = {
  new: ["planning", "booking", "won", "dropped"],
  acknowledged: ["planning", "booking", "won", "dropped"],
  planning: ["booking", "won", "dropped"],
  booking: ["won", "dropped"],
  won: [],
  dropped: [],
};

const TONE: Record<LeadStatus, string> = {
  new: "bg-[color:var(--polarity-wishlist-bg)] text-[color:var(--polarity-wishlist)]",
  acknowledged: "bg-muted text-foreground",
  planning: "bg-muted text-foreground",
  booking: "bg-muted text-foreground",
  won: "bg-[color:var(--polarity-prefer-bg)] text-[color:var(--polarity-prefer)]",
  dropped: "bg-[color:var(--polarity-avoid-bg)] text-[color:var(--polarity-avoid)]",
};

/**
 * What the client has asked for, and what the desk has done about it.
 *
 * Lives on the client's own page rather than in a queue of its own, because a
 * lead is a thing that happened to a client and the curator answering it is
 * already looking at them.
 */
export function LeadPanel({
  customerId,
  leads,
  staff,
  canWork,
  canAssign,
}: {
  customerId: string;
  leads: ClientLead[];
  /** Who a lead can be handed to. Empty for anybody who may not hand one over. */
  staff: { id: string; name: string }[];
  canWork: boolean;
  canAssign: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <Section
      title="Leads"
      action={
        canWork ? (
          <Button variant="ghost" size="sm" onClick={() => setAdding((open) => !open)}>
            <Plus className="size-3.5" />
            New lead
          </Button>
        ) : null
      }
    >
      {adding ? (
        <CreateLead customerId={customerId} onDone={() => setAdding(false)} />
      ) : null}

      {leads.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">
          Nothing asked for yet. One appears when this client texts the Curator
          on vara5.com, or when somebody records an enquiry taken by telephone,
          email or in person.
        </p>
      ) : leads.length === 0 ? null : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {leads.map((lead) => (
            <LeadRow
              key={lead.id}
              customerId={customerId}
              lead={lead}
              staff={staff}
              canWork={canWork}
              canAssign={canAssign}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function LeadRow({
  customerId,
  lead,
  staff,
  canWork,
  canAssign,
}: {
  customerId: string;
  lead: ClientLead;
  staff: { id: string; name: string }[];
  canWork: boolean;
  canAssign: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [dropping, setDropping] = useState(false);
  const [noting, setNoting] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [followUpDue, setFollowUpDue] = useState("");
  const [remark, setRemark] = useState(lead.outcomeNote ?? "");

  const open = lead.status !== "won" && lead.status !== "dropped";
  const late = open && lead.status === "new" && new Date(lead.dueAt) < new Date();

  function move(status: Onward) {
    if (status === "dropped") {
      setDropping(true);
      return;
    }
    startTransition(async () => {
      const result = await advanceLeadAction({ leadId: lead.id, status });
      if (result.ok) toast.success(`Moved to ${LEAD_STATUS_LABELS[status]}`);
      else toast.error(result.error);
    });
  }

  function drop() {
    startTransition(async () => {
      const result = await advanceLeadAction({
        leadId: lead.id,
        status: "dropped",
        droppedReason: reason,
      });
      if (result.ok) {
        toast.success("Dropped");
        setDropping(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  function answer() {
    startTransition(async () => {
      const result = await acknowledgeLeadAction({ leadId: lead.id });
      if (result.ok) toast.success("Marked as contacted");
      else toast.error(result.error);
    });
  }

  function hand(assigneeId: string) {
    startTransition(async () => {
      const result = await assignLeadAction({ leadId: lead.id, assigneeId });
      if (result.ok) toast.success("Curator assigned");
      else toast.error(result.error);
    });
  }

  /**
   * A follow-up is a task under the lead, and a remark is a note on it. Both
   * are written from here: a curator who has just spoken to a client should
   * not have to go and find a separate screen to say what happens next.
   */
  function addFollowUp() {
    startTransition(async () => {
      const result = await createTaskAction({
        leadId: lead.id,
        customerId,
        title: followUp.trim(),
        dueDate: followUpDue || undefined,
      });
      if (result.ok) {
        toast.success("Follow-up added");
        setFollowUp("");
        setFollowUpDue("");
        setNoting(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  function saveRemark() {
    startTransition(async () => {
      const result = await remarkLeadAction({ leadId: lead.id, remark: remark.trim() });
      if (result.ok) toast.success("Remark saved");
      else toast.error(result.error);
    });
  }

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start gap-2">
        <Sparkles
          className="mt-0.5 size-4 shrink-0"
          style={{ color: "var(--chart-1)" }}
        />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{lead.title}</p>
          <p className="text-xs text-muted-foreground">
            {LEAD_SOURCE_LABELS[lead.source]} · asked {timeAgo(lead.createdAt)}
            {lead.curatorName ? ` · ${lead.curatorName}` : " · nobody assigned"}
            {open && lead.status === "new"
              ? ` · answer by ${formatDateTime(lead.dueAt)}`
              : ""}
            {lead.acknowledgedAt ? ` · contacted ${timeAgo(lead.acknowledgedAt)}` : ""}
          </p>
          {lead.droppedReason ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Dropped: {lead.droppedReason}
            </p>
          ) : null}
        </div>

        <span
          className={cn(
            "shrink-0 rounded-sm px-2 py-0.5 text-xs font-medium",
            TONE[lead.status],
          )}
        >
          {LEAD_STATUS_LABELS[lead.status]}
        </span>

        {late ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-[color:var(--polarity-avoid)]">
            <AlertTriangle className="size-3.5" />
            Late
          </span>
        ) : null}
      </div>

      {open && (canWork || canAssign) ? (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          {canWork && lead.status === "new" ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={pending}
              onClick={answer}
            >
              <Check className="size-3.5" />
              Contacted
            </Button>
          ) : null}

          {canWork && NEXT[lead.status].length > 0 ? (
            <Select disabled={pending} onValueChange={(value) => move(value as Onward)}>
              <SelectTrigger size="sm" className="h-7 w-40 text-xs">
                <SelectValue placeholder="Move to" />
              </SelectTrigger>
              <SelectContent>
                {NEXT[lead.status].map((status) => (
                  <SelectItem key={status} value={status}>
                    {LEAD_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {/* Only a lead nobody owns can be given out. A curator who has one
              is obliged to answer it, so there is nothing to hand back. */}
          {canAssign && !lead.curatorName && staff.length > 0 ? (
            <Select disabled={pending} onValueChange={hand}>
              <SelectTrigger size="sm" className="h-7 w-44 text-xs">
                <SelectValue placeholder="Assign a curator" />
              </SelectTrigger>
              <SelectContent>
                {staff.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {canWork ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-muted-foreground"
              onClick={() => setNoting((open) => !open)}
            >
              <MessageSquarePlus className="size-3.5" />
              Follow up
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* The work under the lead, where the lead is, rather than on a list
          somebody has to go and find. */}
      {lead.followUps.length > 0 ? (
        <ul className="space-y-1 pl-6">
          {lead.followUps.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  task.status === "done"
                    ? "bg-[color:var(--polarity-prefer)]"
                    : task.status === "cancelled"
                      ? "bg-border"
                      : "bg-[color:var(--chart-1)]",
                )}
              />
              <span className={cn("truncate", task.status !== "open" && "line-through")}>
                {task.title}
              </span>
              {task.dueDate ? <span className="tabular">{formatDate(task.dueDate)}</span> : null}
              {task.assigneeName ? <span>· {task.assigneeName}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {noting ? (
        <div className="space-y-2 pl-6">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={followUp}
              onChange={(event) => setFollowUp(event.target.value)}
              placeholder="What happens next?"
              className="h-8 w-64"
              autoFocus
            />
            <Input
              type="date"
              value={followUpDue}
              onChange={(event) => setFollowUpDue(event.target.value)}
              className="tabular h-8 w-40"
              aria-label="Due"
            />
            <Button
              size="sm"
              className="h-8"
              disabled={pending || !followUp.trim()}
              onClick={addFollowUp}
            >
              Add follow-up
            </Button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setNoting(false)}
          >
            Close
          </Button>
        </div>
      ) : null}

      {/*
        Always on screen, never behind a toggle. The remark is the part of a
        lead somebody reads before ringing a client, and a note you have to go
        looking for is a note nobody writes.
      */}
      <div className="space-y-2 pl-6">
        {/* The same box as Client DNA, shorter: a remark is a few lines about
            where this stands, not a single-line field somebody has to abbreviate
            into. */}
        <Textarea
          value={remark}
          onChange={(event) => setRemark(event.target.value)}
          rows={2}
          placeholder="Where does this stand? What should the next person know?"
          disabled={!canWork}
          className="resize-y text-sm"
        />

        {remark.trim() !== (lead.outcomeNote ?? "").trim() ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-8"
              disabled={pending || !remark.trim()}
              onClick={saveRemark}
            >
              Save remark
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground"
              onClick={() => setRemark(lead.outcomeNote ?? "")}
            >
              Cancel
            </Button>
          </div>
        ) : null}
      </div>

      {dropping ? (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          {/* A drop needs a reason: "why did we not pursue this" is the question
              somebody asks three months later. */}
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why was it dropped?"
            className="h-8 w-72"
            autoFocus
          />
          <Button size="sm" className="h-8" disabled={pending || !reason.trim()} onClick={drop}>
            Drop it
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setDropping(false)}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * An enquiry that did not come through the members' site.
 *
 * It creates exactly what the website creates — the same clock, the same task,
 * the same chasing — because a client who telephones is owed an answer just as
 * much as one who taps a button, and keeping the two apart would leave half
 * the asks outside the figures.
 */
function CreateLead({
  customerId,
  onDone,
}: {
  customerId: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [source, setSource] = useState<LeadSource>("phone");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await createLeadAction({
        customerId,
        title: title.trim(),
        source: source as Exclude<LeadSource, "website">,
        note: note.trim() || undefined,
      });

      if (result.ok) {
        toast.success("Lead created");
        setTitle("");
        setNote("");
        onDone();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="mb-3 space-y-2 rounded-md border border-border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">
        For an enquiry taken by telephone, email or in person. It is answered on
        the same two-day clock as one from vara5.com.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Courchevel, a safari, a birthday trip…"
          className="h-8 w-64"
          autoFocus
        />

        <Select value={source} onValueChange={(value) => setSource(value as LeadSource)}>
          <SelectTrigger size="sm" className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MANUAL_LEAD_SOURCES.map((option) => (
              <SelectItem key={option} value={option}>
                {LEAD_SOURCE_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What did they say? (optional)"
          className="h-8 w-64"
        />
        <Button size="sm" className="h-8" disabled={pending || !title.trim()} onClick={save}>
          Create lead
        </Button>
        <Button variant="ghost" size="sm" className="h-8" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
