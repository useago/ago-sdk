import { describe, expect, it } from "vitest";
import { formatTimeAgo } from "../src/widget/timeAgo";

const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function ago(ms: number): Date {
  return new Date(NOW - ms);
}

describe("formatTimeAgo", () => {
  it("counts minutes under an hour", () => {
    expect(formatTimeAgo(ago(5 * MIN), NOW)).toBe("5min ago");
    expect(formatTimeAgo(ago(59 * MIN), NOW)).toBe("59min ago");
    expect(formatTimeAgo(ago(0), NOW)).toBe("0min ago");
  });

  it("switches to hours at 60 minutes", () => {
    expect(formatTimeAgo(ago(60 * MIN), NOW)).toBe("1h ago");
    expect(formatTimeAgo(ago(23 * HOUR), NOW)).toBe("23h ago");
  });

  it("switches to days at 24 hours", () => {
    expect(formatTimeAgo(ago(24 * HOUR), NOW)).toBe("1d ago");
    expect(formatTimeAgo(ago(6 * DAY), NOW)).toBe("6d ago");
  });

  it("switches to weeks at 7 days", () => {
    expect(formatTimeAgo(ago(7 * DAY), NOW)).toBe("1 weeks ago");
    expect(formatTimeAgo(ago(27 * DAY), NOW)).toBe("3 weeks ago");
  });

  it("switches to months at 4 weeks and never says 0 months", () => {
    expect(formatTimeAgo(ago(28 * DAY), NOW)).toBe("1 months ago");
    expect(formatTimeAgo(ago(90 * DAY), NOW)).toBe("3 months ago");
  });

  it("accepts ISO strings and honors custom labels", () => {
    expect(
      formatTimeAgo(ago(2 * HOUR).toISOString(), NOW, {
        minutes: "il y a {n} min",
        hours: "il y a {n} h",
        days: "il y a {n} j",
        weeks: "il y a {n} sem",
        months: "il y a {n} mois",
      }),
    ).toBe("il y a 2 h");
  });

  it("does not throw on an invalid date", () => {
    expect(formatTimeAgo("not a date", NOW)).toBe("0min ago");
  });
});
