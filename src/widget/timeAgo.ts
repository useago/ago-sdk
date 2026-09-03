/**
 * Relative time labels for the history screen ("5min ago", "2h ago", ...).
 * Mirrors the reference widget's buckets exactly: minutes under an hour, hours
 * under a day, days under a week, weeks under four, then months (30-day months,
 * never "0 months").
 */

/** The five bucket templates; `{n}` is replaced by the count. */
export interface TimeAgoLabels {
  minutes: string;
  hours: string;
  days: string;
  weeks: string;
  months: string;
}

export const DEFAULT_TIME_AGO_LABELS: TimeAgoLabels = {
  minutes: "{n}min ago",
  hours: "{n}h ago",
  days: "{n}d ago",
  weeks: "{n} weeks ago",
  months: "{n} months ago",
};

const MINUTE = 60 * 1000;

export function formatTimeAgo(
  date: Date | string | number,
  now: number = Date.now(),
  labels: TimeAgoLabels = DEFAULT_TIME_AGO_LABELS,
): string {
  const time = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const fill = (template: string, n: number): string =>
    template.replace("{n}", String(n));
  if (!Number.isFinite(time)) return fill(labels.minutes, 0);

  const minutes = Math.max(0, Math.floor((now - time) / MINUTE));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.max(1, Math.floor(days / 30));

  if (minutes < 60) return fill(labels.minutes, minutes);
  if (hours < 24) return fill(labels.hours, hours);
  if (days < 7) return fill(labels.days, days);
  if (weeks < 4) return fill(labels.weeks, weeks);
  return fill(labels.months, months);
}
