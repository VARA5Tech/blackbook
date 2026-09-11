"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { recordInteractionAction } from "@/actions/crm-actions";
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
import {
  INTERACTION_TYPES,
  INTERACTION_TYPE_LABELS,
} from "@/domain/engagement";
import { formatDateTime } from "@/lib/format";

type InteractionRow = {
  id: string;
  type: (typeof INTERACTION_TYPES)[number];
  summary: string;
  details: string | null;
  occurredAt: Date;
  loggedByName: string | null;
};

export function InteractionPanel({
  customerId,
  interactions,
  canLog,
}: {
  customerId: string;
  interactions: InteractionRow[];
  canLog: boolean;
}) {
  return (
    <Section
      title="Interactions"
      action={canLog ? <LogInteractionDialog customerId={customerId} /> : null}
    >
      {interactions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing recorded yet. Log a call or message to start the history.
        </p>
      ) : (
        <ol className="space-y-5">
          {interactions.map((interaction) => (
            <li key={interaction.id} className="space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium">
                  {INTERACTION_TYPE_LABELS[interaction.type]}
                </span>
                <span className="tabular text-xs text-muted-foreground">
                  {formatDateTime(interaction.occurredAt)}
                </span>
                {interaction.loggedByName ? (
                  <span className="text-xs text-muted-foreground">
                    by {interaction.loggedByName}
                  </span>
                ) : null}
              </div>
              <p className="text-sm">{interaction.summary}</p>
              {interaction.details ? (
                <p className="text-sm text-muted-foreground">
                  {interaction.details}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function LogInteractionDialog({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [type, setType] =
    useState<(typeof INTERACTION_TYPES)[number]>("call");
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [occurredAt, setOccurredAt] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await recordInteractionAction({
        customerId,
        type,
        summary,
        details,
        occurredAt: occurredAt || undefined,
      });

      if (result.ok) {
        toast.success("Interaction recorded");
        setOpen(false);
        setSummary("");
        setDetails("");
        setOccurredAt("");
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
          Log
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record interaction</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="interaction-type">Type</Label>
            <Select
              value={type}
              onValueChange={(value) =>
                setType(value as (typeof INTERACTION_TYPES)[number])
              }
            >
              <SelectTrigger id="interaction-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERACTION_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {INTERACTION_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interaction-summary">Summary</Label>
            <Input
              id="interaction-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Discussed Japan for cherry blossom season"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="interaction-details">Details</Label>
            <Textarea
              id="interaction-details"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="interaction-when">When</Label>
            <Input
              id="interaction-when"
              type="datetime-local"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank for now.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={pending || summary.trim().length === 0}
          >
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
