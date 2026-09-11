"use client";

import { Check, Pencil, Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateClientDnaAction } from "@/actions/client-actions";
import { Section } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ClientDirective } from "@/db/schema";

/**
 * The "Know Me" section. Given the most visual weight on the screen because it
 * is the part an ops employee reads first and the part structured fields
 * cannot capture.
 */
export function ClientDnaPanel({
  customerId,
  clientDna,
  directives,
  canEdit,
}: {
  customerId: string;
  clientDna: string | null;
  directives: ClientDirective[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const initialDos = directives
    .filter((directive) => directive.kind === "do")
    .map((directive) => directive.body);
  const initialDonts = directives
    .filter((directive) => directive.kind === "dont")
    .map((directive) => directive.body);

  const [dna, setDna] = useState(clientDna ?? "");
  const [dos, setDos] = useState<string[]>(initialDos);
  const [donts, setDonts] = useState<string[]>(initialDonts);

  function save() {
    startTransition(async () => {
      const result = await updateClientDnaAction({
        customerId,
        clientDna: dna,
        dos: dos.map((item) => item.trim()).filter(Boolean),
        donts: donts.map((item) => item.trim()).filter(Boolean),
      });

      if (result.ok) {
        toast.success("Client DNA saved");
        setEditing(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  function cancel() {
    setDna(clientDna ?? "");
    setDos(initialDos);
    setDonts(initialDonts);
    setEditing(false);
  }

  if (editing) {
    return (
      <Section
        title="Client DNA"
        action={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              Save
            </Button>
          </div>
        }
      >
        <Textarea
          value={dna}
          onChange={(event) => setDna(event.target.value)}
          rows={5}
          placeholder="What should a colleague know before speaking to this client?"
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <DirectiveEditor
            label="DO"
            items={dos}
            onChange={setDos}
            placeholder="Boutique properties under 60 keys"
          />
          <DirectiveEditor
            label="DON'T"
            items={donts}
            onChange={setDonts}
            placeholder="Large resorts"
          />
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Client DNA"
      action={
        canEdit ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
            Edit
          </Button>
        ) : null
      }
    >
      {clientDna ? (
        <p className="font-display text-lg leading-relaxed text-pretty">
          {clientDna}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing recorded yet. This is where the nuances live.
        </p>
      )}

      {initialDos.length + initialDonts.length > 0 ? (
        <div className="grid gap-6 pt-2 sm:grid-cols-2">
          <DirectiveList
            label="DO"
            items={initialDos}
            tone="text-[color:var(--polarity-prefer)]"
            icon={<Check className="size-3.5" />}
          />
          <DirectiveList
            label="DON'T"
            items={initialDonts}
            tone="text-[color:var(--polarity-avoid)]"
            icon={<X className="size-3.5" />}
          />
        </div>
      ) : null}
    </Section>
  );
}

function DirectiveList({
  label,
  items,
  tone,
  icon,
}: {
  label: string;
  items: string[];
  tone: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm">
              <span className={`mt-0.5 shrink-0 ${tone}`}>{icon}</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DirectiveEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </p>

      {items.map((item, index) => (
        // Index keys are correct here: the list is positional and reorderable.
        <div key={index} className="flex gap-2">
          <Input
            value={item}
            placeholder={placeholder}
            onChange={(event) => {
              const next = [...items];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...items, ""])}
      >
        <Plus className="size-3.5" />
        Add
      </Button>
    </div>
  );
}
