import { describe, it, expect } from "vitest";
import type { ContextEntry } from "../src/state/ClientContextRegistry";
import {
  computePageStateDelta,
  diffPageState,
  mergePageState,
  readPageId,
} from "../src/state/pageStateDelta";

const entry = (data: Record<string, unknown>): ContextEntry => ({ data });

describe("mergePageState", () => {
  it("merges every page-state:* entry and ignores others", () => {
    const merged = mergePageState({
      "page-state:list": entry({ filter: "all" }),
      "page-state:sort": entry({ sort: "date" }),
      "browser-page": entry({ url: "/x" }),
    });
    expect(merged).toEqual({ filter: "all", sort: "date" });
  });
});

describe("readPageId", () => {
  it("prefers current-page.page, then url, then browser-page.url", () => {
    expect(readPageId({ "current-page": entry({ page: "orders", url: "/o" }) })).toBe("orders");
    expect(readPageId({ "current-page": entry({ url: "/o" }) })).toBe("/o");
    expect(readPageId({ "browser-page": entry({ url: "/b" }) })).toBe("/b");
    expect(readPageId({})).toBeUndefined();
  });
});

describe("diffPageState", () => {
  it("reports only keys present in both that changed", () => {
    expect(
      diffPageState({ a: 1, b: 2, gone: 9 }, { a: 1, b: 3, added: 5 })
    ).toEqual([{ field: "b", from: 2, to: 3 }]);
  });

  it("deep-compares arrays and objects", () => {
    expect(diffPageState({ tags: ["x"] }, { tags: ["x"] })).toEqual([]);
    expect(diffPageState({ tags: ["x"] }, { tags: ["x", "y"] })).toHaveLength(1);
  });
});

describe("computePageStateDelta", () => {
  const page = (id: string, state: Record<string, unknown>) => ({
    "current-page": entry({ page: id }),
    "page-state:p": entry(state),
  });

  it("reports no changes on the first send but sets the baseline", () => {
    const { changes, baseline } = computePageStateDelta(null, page("a", { filter: "all" }));
    expect(changes).toEqual([]);
    expect(baseline).toEqual({ page: "a", state: { filter: "all" } });
  });

  it("reports edits on the same page", () => {
    const prev = { page: "a", state: { filter: "all" } };
    const { changes } = computePageStateDelta(prev, page("a", { filter: "pending" }));
    expect(changes).toEqual([{ field: "filter", from: "all", to: "pending" }]);
  });

  it("reports nothing across a navigation, but advances the baseline", () => {
    const prev = { page: "a", state: { filter: "all" } };
    const { changes, baseline } = computePageStateDelta(prev, page("b", { sort: "date" }));
    expect(changes).toEqual([]);
    expect(baseline).toEqual({ page: "b", state: { sort: "date" } });
  });
});
