import { Section } from "@/components/page-header";
import { FIELD_LABELS } from "@/domain/engagement";
import { formatDateTime, humanise } from "@/lib/format";

type Entry = {
  id: string;
  action: string;
  entityType: string;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: Date;
  actorName: string | null;
};

/**
 * Read-only audit trail. Field-level diffs are shown inline so a colleague can
 * see not just that a profile changed but what moved and who moved it.
 */
export function ActivityTimeline({ entries }: { entries: Entry[] }) {
  return (
    <Section title="History">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity recorded.</p>
      ) : (
        <ol className="space-y-5 border-l border-border pl-5">
          {entries.map((entry) => (
            <li key={entry.id} className="relative space-y-1">
              <span
                aria-hidden
                className="absolute top-1.5 -left-[23px] size-1.5 rounded-full bg-border"
              />

              <p className="text-sm">{entry.summary}</p>

              <p className="tabular text-xs text-muted-foreground">
                {formatDateTime(entry.createdAt)}
                {entry.actorName ? ` · ${entry.actorName}` : ""}
              </p>

              {entry.changes ? (
                <ul className="mt-1.5 space-y-0.5">
                  {Object.entries(entry.changes).map(([field, change]) => (
                    <li key={field} className="text-xs text-muted-foreground">
                      <span className="text-foreground">
                        {FIELD_LABELS[field] ?? humanise(field)}
                      </span>
                      {": "}
                      <span className="line-through">
                        {renderValue(change.from)}
                      </span>
                      {" → "}
                      <span>{renderValue(change.to)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
