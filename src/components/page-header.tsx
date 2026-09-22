import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="font-display text-2xl tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  plain = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Inside a Section, whose card already draws the edge. */
  plain?: boolean;
}) {
  return (
    <div
      className={cn(
        "px-6 text-center",
        plain ? "py-8" : "rounded-lg border border-dashed border-border py-12",
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Label-over-value pair used throughout the Client 360 screen. */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

/**
 * A titled block of the record: a bordered card with a filled header bar.
 *
 * It used to be a bare hairline under a small-caps label, which left every
 * screen reading as one undifferentiated column. A card gives each block an
 * edge, and the header band says where one ends and the next begins.
 *
 * `flush` drops the body padding, for content that brings its own edges, such
 * as a table or a list of rows that should run to the border.
 */
export function Section({
  title,
  icon: Icon,
  count,
  action,
  children,
  className,
  flush = false,
}: {
  title: string;
  icon?: LucideIcon;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card shadow-xs",
        className,
      )}
    >
      <div className="flex min-h-11 items-center justify-between gap-4 border-b border-border bg-muted px-4 py-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
          <span className="truncate">{title}</span>
          {count !== undefined ? (
            <span className="tabular rounded-full bg-background px-1.5 text-xs font-medium text-muted-foreground">
              {count}
            </span>
          ) : null}
        </h2>
        {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
      </div>
      <div className={flush ? undefined : "p-4"}>{children}</div>
    </section>
  );
}
