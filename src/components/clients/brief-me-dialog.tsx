"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Streams a briefing built from the client's CRM record.
 *
 * The dialog is explicit that the bullets are CRM facts and the closing line is
 * a suggestion, because the handover requires the two to be distinguishable.
 */
export function BriefMeDialog({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function generate() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setText("");
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/ai/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? "Could not generate a brief.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setText((current) => current + decoder.decode(value, { stream: true }));
      }
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") {
        setError("Could not generate a brief.");
      }
    } finally {
      setLoading(false);
    }
  }

  /**
   * Generation is started by the click that opens the dialog, not by an effect
   * watching `open`. One user action produces exactly one model call, and
   * closing the dialog aborts any stream still in flight.
   */
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      if (text.length === 0 && !loading) void generate();
    } else {
      abortRef.current?.abort();
    }
  }

  const [facts, suggestion] = splitBrief(text);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Sparkles />
          Brief me
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl tracking-tight">
            {customerName}
          </DialogTitle>
          <DialogDescription>
            Built from this client&rsquo;s CRM record.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={generate}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {facts ? (
              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                {facts}
              </div>
            ) : null}

            {loading && text.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Reading the record...
              </p>
            ) : null}

            {suggestion ? (
              <div className="rounded-md border border-accent bg-accent/40 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-accent-foreground uppercase">
                  <Sparkles className="size-3" />
                  Suggestion, not a stored fact
                </p>
                <p className="mt-1.5 text-sm">{suggestion}</p>
              </div>
            ) : null}

            {!loading && text.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={generate}>
                Regenerate
              </Button>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Separates the stored-fact bullets from the model's own recommendation so the
 * two can be styled differently and never be mistaken for one another.
 */
function splitBrief(text: string): [string, string | null] {
  const marker = "Suggested next action:";
  const index = text.indexOf(marker);
  if (index === -1) return [text.trim(), null];

  return [
    text.slice(0, index).trim(),
    text.slice(index + marker.length).trim() || null,
  ];
}
