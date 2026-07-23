import { describe, it, expect } from "vitest";
import {
  ActivityLedger,
  DEFAULT_MAX_ACTIVITY_ENTRIES,
  MAX_ACTIVITY_ARRAY_ITEMS,
  MAX_ACTIVITY_STRING_LEN,
  clampActivityData,
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

  it("defaults the cap to 10", () => {
    expect(DEFAULT_MAX_ACTIVITY_ENTRIES).toBe(10);
    const ledger = new ActivityLedger();
    for (let i = 0; i < 15; i++) ledger.add({ name: `e${i}`, summary: "s", ts: i });
    expect(ledger.getRecent()).toHaveLength(10);
  });

  it("clamps oversized data when adding an entry", () => {
    const ledger = new ActivityLedger();
    const entry = ledger.add({
      name: "agent.page_state",
      summary: "set prompt",
      data: { prompt: "z".repeat(MAX_ACTIVITY_STRING_LEN + 200) },
    });
    expect((entry.data?.prompt as string)).toContain("[truncated 200 chars]");
  });
});

describe("clampActivityData", () => {
  it("truncates long strings with a marker", () => {
    const long = "x".repeat(MAX_ACTIVITY_STRING_LEN + 500);
    const out = clampActivityData({ prompt: long });
    const prompt = out.prompt as string;
    expect(prompt.length).toBeLessThan(long.length);
    expect(prompt.startsWith("x".repeat(MAX_ACTIVITY_STRING_LEN))).toBe(true);
    expect(prompt).toContain("…[truncated 500 chars]");
  });

  it("leaves short strings and small data untouched", () => {
    const data = { name: "personal coach", model: "gpt-4.1-mini", n: 3, ok: true };
    expect(clampActivityData(data)).toEqual(data);
  });

  it("truncates a deeply nested string but keeps its siblings", () => {
    const long = "y".repeat(MAX_ACTIVITY_STRING_LEN + 10);
    const out = clampActivityData({
      arguments: { promptTitle: "t", prompt: long, model: "gpt-4.1-mini" },
    });
    const args = out.arguments as Record<string, unknown>;
    expect(args.promptTitle).toBe("t");
    expect(args.model).toBe("gpt-4.1-mini");
    expect(args.prompt as string).toContain("…[truncated 10 chars]");
  });

  it("caps long arrays with a remainder marker", () => {
    const arr = Array.from({ length: MAX_ACTIVITY_ARRAY_ITEMS + 4 }, (_, i) => i);
    const out = clampActivityData({ items: arr });
    const items = out.items as unknown[];
    expect(items).toHaveLength(MAX_ACTIVITY_ARRAY_ITEMS + 1);
    expect(items[items.length - 1]).toBe("…[+4 more]");
  });

  it("guards against cycles", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    const out = clampActivityData(a);
    expect(out.name).toBe("a");
    expect(out.self).toBe("…[circular]");
  });

  it("returns a decoupled copy so later input mutation does not leak in", () => {
    const input: Record<string, unknown> = { nested: { k: "v" } };
    const out = clampActivityData(input);
    (input.nested as Record<string, unknown>).k = "changed";
    expect((out.nested as Record<string, unknown>).k).toBe("v");
  });
});
