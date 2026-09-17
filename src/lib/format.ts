import { differenceInCalendarDays, format, formatDistanceToNowStrict } from "date-fns";

/** "12 Oct 2026" - unambiguous for an India-based team reading US-format dates. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? parseIsoDate(value) : value;
  if (!date || Number.isNaN(date.getTime())) return "—";
  return format(date, "d MMM yyyy");
}

export function formatDayMonth(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? parseIsoDate(value) : value;
  if (!date || Number.isNaN(date.getTime())) return "—";
  return format(date, "d MMMM");
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "d MMM yyyy, h:mm a");
}

/** "41 days ago", or "Never" when there is nothing recorded. */
export function timeAgo(value: Date | string | null | undefined): string {
  if (!value) return "Never";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "Never";
  return `${formatDistanceToNowStrict(date)} ago`;
}

export function daysSince(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return Math.abs(differenceInCalendarDays(new Date(), date));
}

/**
 * "4 min", "1 hr 12 min" - how long someone spent reading, rounded the way a
 * curator would say it out loud. Anything under a minute is not worth a number.
 */
export function readingTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** "in 30 days", "tomorrow", "today". */
export function countdown(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/**
 * Postgres `date` columns arrive as "YYYY-MM-DD". Constructing a Date from that
 * string is parsed as UTC midnight, which can display as the previous day in
 * negative-offset timezones, so the parts are used directly instead.
 */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
}

export function age(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const born = parseIsoDate(dateOfBirth);
  if (!born) return null;

  const today = new Date();
  let years = today.getFullYear() - born.getFullYear();
  const monthDiff = today.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < born.getDate())) {
    years -= 1;
  }
  return years >= 0 ? years : null;
}

/** "budget_range" becomes "Budget range" for enum values without an explicit label. */
export function humanise(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/_/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

