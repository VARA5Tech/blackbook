import { differenceInCalendarDays, formatDistanceToNowStrict } from "date-fns";

/**
 * Everything on screen is Indian Standard Time, whoever is reading it.
 *
 * The alternative is whatever timezone the code happens to run in, which is two
 * different answers for the same row: UTC when a server component renders it,
 * the reader's own zone when the browser does. A curator comparing a call time
 * with a visit time needs one clock, and the desk is in India.
 *
 * `Intl` rather than a date library with a timezone plugin: the zone database
 * is already in the runtime, and this is the only place that needs it.
 */
const IST = "Asia/Kolkata";

/** Day, month and a two-digit year, as the desk writes it: `19-09-26`. */
const istDate = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: IST,
});

const istTime = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: IST,
});

const istDayMonth = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: IST,
});

/** The calendar parts of the current moment in Delhi, not wherever this runs. */
const istYmd = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: IST,
});

/** `en-GB` separates with slashes; the house style is dashes. */
const dashed = (value: string) => value.replace(/\//g, "-");

/**
 * A `date` column has no time and no timezone: a birthday is the same day
 * everywhere. Shifting one into IST would move it across midnight for a reader
 * far enough east, so the parts are read straight off the string.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `19-09-26`. Day first, because the team reads it that way. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";

  if (typeof value === "string") {
    const parts = DATE_ONLY.exec(value.slice(0, 10));
    if (parts) return `${parts[3]}-${parts[2]}-${parts[1].slice(2)}`;
  }

  const date = typeof value === "string" ? parseIsoDate(value) : value;
  if (!date || Number.isNaN(date.getTime())) return "—";
  return dashed(istDate.format(date));
}

/** `19 September`, for the milestones that recur and have no useful year. */
export function formatDayMonth(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? parseIsoDate(value) : value;
  if (!date || Number.isNaN(date.getTime())) return "—";
  return istDayMonth.format(date);
}

/** `19-09-26, 4:53 pm`, in Indian Standard Time. */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return `${dashed(istDate.format(date))}, ${istTime.format(date)}`;
}

/** Midnight in Delhi today, for the counts that mean "as of now, here". */
function todayInIst(): Date {
  const [year, month, day] = istYmd.format(new Date()).split("-").map(Number);
  return new Date(year, month - 1, day);
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
  return Math.abs(differenceInCalendarDays(todayInIst(), date));
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

  const today = todayInIst();
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

