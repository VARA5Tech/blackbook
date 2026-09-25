"use client";

import { Check, Fingerprint, Pencil, Plus, X } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { updateClientDnaAction } from "@/actions/client-actions";
import { Section } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type DnaProps = {
  customerId: string;
  clientDna: string | null;
  dos: string[];
  donts: string[];
  canEdit: boolean;
};

/**
 * The "Know Me" section. Given the most visual weight on the screen because it
 * is the part an ops employee reads first and the part structured fields
 * cannot capture.
 *
 * `chrome` is how the same panel serves two places. As a `section` it is the
 * card it has always been; as `plain` it drops the card so it can sit inside
 * the dialog the strip above opens, where a bordered box within a box reads as
 * a mistake.
 */
export function ClientDnaPanel({
  customerId,
  clientDna,
  dos: initialDos,
  donts: initialDonts,
  canEdit,
  chrome = "section",
}: DnaProps & { chrome?: "section" | "plain" }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

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
      <DnaShell
        chrome={chrome}
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
      </DnaShell>
    );
  }

  return (
    <DnaShell
      chrome={chrome}
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
    </DnaShell>
  );
}

/**
 * Defined here rather than inside the panel: a component declared during a
 * render is a new type every render, so React would throw the textarea away
 * and take the cursor with it on every keystroke.
 */
function DnaShell({
  chrome,
  action,
  children,
}: {
  chrome: "section" | "plain";
  action: ReactNode;
  children: ReactNode;
}) {
  if (chrome === "section") {
    return (
      <Section title="Client DNA" icon={Fingerprint} action={action}>
        {children}
      </Section>
    );
  }

  return (
    <div className="space-y-4">
      {action ? <div className="flex justify-end gap-2">{action}</div> : null}
      {children}
    </div>
  );
}

/**
 * Client DNA where it is actually read: at the top, in two lines, before the
 * leads and the fields.
 *
 * It was the first thing a curator wanted and the first thing pushed below the
 * fold once leads arrived above it. A record nobody scrolls to is a record
 * nobody reads, so what fits in a glance sits in a glance and the whole of it
 * is one click away — which is also where it is edited, so the strip is not a
 * teaser for a panel somewhere else.
 */
export function ClientDnaStrip({
  open,
  onOpenChange,
  ...props
}: DnaProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const directives = props.dos.length + props.donts.length;

  return (
    /*
     * Opened from outside as well as from the strip itself: a written "do" or
     * "don't" in At a glance is a line of this record, so pressing one has to
     * land here rather than in a catalogue section that does not hold it.
     */
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="w-full rounded-lg border border-border bg-card px-4 py-3 text-left shadow-xs transition-colors hover:border-foreground/20 hover:bg-muted/40"
        >
          <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Fingerprint className="size-3.5" />
            Client DNA
            {directives > 0 ? (
              <span className="tabular font-normal">
                · {props.dos.length} do · {props.donts.length} don&rsquo;t
              </span>
            ) : null}
            <span className="ml-auto font-normal">
              {props.clientDna || directives > 0 ? "Read it all" : "Add"}
            </span>
          </span>

          {props.clientDna ? (
            // Two lines, which is a sentence and a half: enough to know who
            // this is, short enough that leads stay on the same screen.
            <span className="mt-1 line-clamp-2 block font-display text-base leading-snug text-pretty">
              {props.clientDna}
            </span>
          ) : (
            <span className="mt-1 block text-sm text-muted-foreground">
              Nothing recorded yet. This is where the nuances live.
            </span>
          )}
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl tracking-tight">
            <Fingerprint className="size-4 text-muted-foreground" />
            Client DNA
          </DialogTitle>
        </DialogHeader>

        <ClientDnaPanel {...props} chrome="plain" />
      </DialogContent>
    </Dialog>
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
