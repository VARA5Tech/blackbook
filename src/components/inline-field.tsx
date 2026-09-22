"use client";

import { Check, Loader2, Pencil, type LucideIcon } from "lucide-react";
import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/actions/action-result";
import { cn } from "@/lib/utils";

/**
 * One fact on a record, editable where it sits.
 *
 * Modelled on the property panels of Twenty, HubSpot and Attio: a fixed label
 * column, one fact per row, and the row itself is the control. Double-click a
 * value to change it — deliberately a double click, so that a single click is
 * still free to select and copy a phone number or an address. The pencil that
 * appears on hover does the same for anyone who does not know the gesture, and
 * Enter or F2 does it from the keyboard. Enter saves, Escape abandons.
 *
 * The caller supplies `save`, which goes through the record's ordinary server
 * action: validated, checked, and written to the audit trail as a field-level
 * change, exactly as the full edit form would.
 */

export type Editor =
  | { kind: "text"; placeholder?: string; inputMode?: "tel" | "email" | "text" }
  | { kind: "date" }
  | { kind: "textarea"; placeholder?: string }
  | { kind: "select"; options: readonly { value: string; label: string }[] };

export function InlineField({
  save,
  canEdit,
  field,
  label,
  icon: Icon,
  value,
  display,
  editor,
  tabular = false,
  multiline = false,
}: {
  /** Writes one field and reports back; the server stays the only validator. */
  save: (field: string, value: string) => Promise<ActionResult<unknown>>;
  canEdit: boolean;
  field: string;
  label: string;
  icon: LucideIcon;
  value: string | null | undefined;
  display?: (value: string) => string;
  editor: Editor;
  tabular?: boolean;
  multiline?: boolean;
}) {
  const current = value ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState<string | null>(null);
  /**
   * What was just saved, shown until the refreshed record arrives with it.
   * Remembered against the value it replaced, so the moment the server's copy
   * changes it wins on its own, with no effect needed to clear this.
   */
  const [saved, setSaved] = useState<{ over: string; value: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const rowRef = useRef<HTMLDivElement>(null);
  /**
   * Set the moment an edit is settled one way or the other. The input blurs as
   * it is disabled for the save and again as it is removed, and every blur
   * calls commit; without this an Enter saved twice and, worse, an Escape was
   * followed by a blur that saved the very draft it meant to throw away.
   */
  const settled = useRef(false);

  const shown = saved && saved.over === current ? saved.value : current;

  function open() {
    if (!canEdit || editing) return;
    settled.current = false;
    setDraft(shown);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    settled.current = true;
    setEditing(false);
    setError(null);
    rowRef.current?.focus();
  }

  function commit() {
    if (settled.current) return;
    const next = editor.kind === "text" || editor.kind === "textarea" ? draft.trim() : draft;
    settled.current = true;
    if (next === shown.trim()) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const result = await save(field, next);
      if (!result.ok) {
        // Still editing: let the next Enter or blur try again.
        settled.current = false;
        setError(result.fieldErrors?.[field]?.[0] ?? result.error);
        return;
      }
      setSaved({ over: current, value: next });
      setEditing(false);
      toast.success(`${label} ${next ? "saved" : "cleared"}`);
    });
  }

  function onEditorKey(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    const multi = editor.kind === "textarea";
    // A textarea keeps Enter for new lines; Ctrl or Cmd with it saves.
    if (event.key === "Enter" && (!multi || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commit();
    }
  }

  const empty = shown.trim() === "";
  const shownText = empty ? null : display ? display(shown) : shown;

  return (
    <div
      className={cn(
        "grid gap-x-4 px-4 py-2.5",
        multiline ? "grid-cols-1 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)]" : "grid-cols-[10rem_minmax(0,1fr)]",
      )}
    >
      <dt className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        {label}
      </dt>

      <dd className="min-w-0">
        {editing ? (
          <div className="space-y-1.5">
            {editor.kind === "textarea" ? (
              <textarea
                autoFocus
                rows={3}
                value={draft}
                disabled={pending}
                placeholder={editor.placeholder}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onEditorKey}
                onBlur={commit}
                className="w-full resize-y rounded-md border border-ring bg-background px-2.5 py-1.5 text-sm outline-none ring-3 ring-ring/20 disabled:opacity-60"
              />
            ) : editor.kind === "select" ? (
              <select
                autoFocus
                value={draft}
                disabled={pending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onEditorKey}
                onBlur={commit}
                className="h-8 w-full rounded-md border border-ring bg-background px-2 text-sm outline-none ring-3 ring-ring/20 disabled:opacity-60"
              >
                {editor.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                autoFocus
                type={editor.kind === "date" ? "date" : editor.inputMode === "email" ? "email" : "text"}
                inputMode={editor.kind === "text" ? editor.inputMode : undefined}
                value={draft}
                disabled={pending}
                placeholder={editor.kind === "text" ? editor.placeholder : undefined}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onEditorKey}
                onBlur={commit}
                className={cn(
                  "h-8 w-full rounded-md border border-ring bg-background px-2.5 text-sm outline-none ring-3 ring-ring/20 disabled:opacity-60",
                  tabular && "tabular",
                )}
              />
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {pending ? (
                <>
                  <Loader2 className="size-3 animate-spin" /> Saving…
                </>
              ) : error ? (
                <span className="text-destructive">{error}</span>
              ) : (
                <>
                  <Check className="size-3" />
                  {editor.kind === "textarea" ? "Ctrl+Enter to save" : "Enter to save"} · Esc to cancel
                </>
              )}
            </p>
          </div>
        ) : (
          <div
            ref={rowRef}
            role={canEdit ? "button" : undefined}
            tabIndex={canEdit ? 0 : undefined}
            aria-label={canEdit ? `${label}: ${shownText ?? "empty"}. Double-click or press Enter to edit` : undefined}
            onDoubleClick={open}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "F2") {
                event.preventDefault();
                open();
              }
            }}
            title={canEdit ? "Double-click to edit" : undefined}
            className={cn(
              "group -mx-2 flex min-h-8 items-start justify-between gap-2 rounded-md px-2 py-1 text-sm outline-none",
              canEdit && "cursor-text transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40",
            )}
          >
            <span
              className={cn(
                "min-w-0 break-words",
                multiline && "whitespace-pre-line",
                tabular && "tabular",
                empty && "text-muted-foreground/70 italic",
              )}
            >
              {shownText ?? (canEdit ? `Add ${label.toLowerCase()}` : "Not recorded")}
            </span>
            {canEdit ? (
              <button
                type="button"
                tabIndex={-1}
                aria-hidden
                onClick={open}
                className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
            ) : null}
          </div>
        )}
      </dd>
    </div>
  );
}
