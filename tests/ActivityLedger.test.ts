import { describe, it, expect } from "vitest";
import {
  ActivityLedger,
  DEFAULT_MAX_ACTIVITY_ENTRIES,
} from "../src/activity/ActivityLedger";

describe("ActivityLedger", () => {
  it("defaults actor to 'user' and fills a timestamp", () => {
    const ledger = new ActivityLedger();
    const entry = ledger.add({ name: "order.shipped", summary: "User shipped #1" });
    expect(entry.actor).toBe("user");
    expect(typeof entry.ts).toBe("number");
    expect(entry.name).toBe("order.shipped");
  });

  it("keeps explicit actor, ts, and data", () => {
    const ledger = new ActivityLedger();
    const entry = ledger.add({
      actor: "agent",
      name: "agent.navigate",
      summary: "Agent navigated",
      ts: 123,
      data: { page: "orders" },
    });
    expect(entry.actor).toBe("agent");
    expect(entry.ts).toBe(123);
    expect(entry.data).toEqual({ page: "orders" });
  });

  it("caps at the default and drops the oldest first", () => {
    const ledger = new ActivityLedger();
    for (let i = 0; i < DEFAULT_MAX_ACTIVITY_ENTRIES + 5; i++) {
      ledger.add({ name: `e${i}`, summary: `s${i}`, ts: i });
    }
    const recent = ledger.getRecent();
    expect(recent).toHaveLength(DEFAULT_MAX_ACTIVITY_ENTRIES);
    expect(recent[0].name).toBe("e5");
    expect(recent[recent.length - 1].name).toBe(
      `e${DEFAULT_MAX_ACTIVITY_ENTRIES + 4}`
    );
  });

  it("honors a custom cap and coerces below 1 up to 1", () => {
    const two = new ActivityLedger(2);
    two.add({ name: "a", summary: "a" });
    two.add({ name: "b", summary: "b" });
    two.add({ name: "c", summary: "c" });
    expect(two.getRecent().map((e) => e.name)).toEqual(["b", "c"]);

    const zero = new ActivityLedger(0);
    zero.add({ name: "a", summary: "a" });
    zero.add({ name: "b", summary: "b" });
    expect(zero.getRecent().map((e) => e.name)).toEqual(["b"]);
  });

  it("getRecent returns a copy", () => {
    const ledger = new ActivityLedger();
    ledger.add({ name: "a", summary: "a" });
    const copy = ledger.getRecent();
    copy.push({ ts: 0, actor: "user", name: "x", summary: "x" });
    expect(ledger.getRecent()).toHaveLength(1);
  });

  it("clear empties the ledger", () => {
    const ledger = new ActivityLedger();
    ledger.add({ name: "a", summary: "a" });
    expect(ledger.size).toBe(1);
    ledger.clear();
    expect(ledger.size).toBe(0);
    expect(ledger.getRecent()).toEqual([]);
  });
});
