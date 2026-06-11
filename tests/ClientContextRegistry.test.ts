import { describe, it, expect, beforeEach } from "vitest";
import { ClientContextRegistry } from "../src/state/ClientContextRegistry";

describe("ClientContextRegistry", () => {
  let registry: ClientContextRegistry;

  beforeEach(() => {
    registry = new ClientContextRegistry();
  });

  it("returns null when empty", () => {
    expect(registry.getSnapshot()).toBeNull();
  });

  it("registers and returns static entries", () => {
    registry.set("order-page", {
      name: "Order detail",
      description: "Viewing order #123",
      data: { orderId: "123", status: "shipped" },
    });

    const snapshot = registry.getSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.entries["order-page"]).toEqual({
      name: "Order detail",
      description: "Viewing order #123",
      data: { orderId: "123", status: "shipped" },
    });
  });

  it("removes entries", () => {
    registry.set("key1", { name: "Page 1" });
    registry.set("key2", { name: "Page 2" });

    expect(registry.remove("key1")).toBe(true);
    expect(registry.remove("nonexistent")).toBe(false);

    const snapshot = registry.getSnapshot();
    expect(snapshot!.entries).not.toHaveProperty("key1");
    expect(snapshot!.entries).toHaveProperty("key2");
  });

  it("overwrites existing entries with the same key", () => {
    registry.set("entry", { name: "V1" });
    registry.set("entry", { name: "V2" });

    const snapshot = registry.getSnapshot();
    expect(snapshot!.entries["entry"].name).toBe("V2");
  });

  it("clears everything", () => {
    registry.set("key", { name: "Test" });
    registry.addDynamicProvider("dyn", () => ({ name: "Dynamic" }));

    registry.clear();

    expect(registry.getSnapshot()).toBeNull();
  });

  it("evaluates dynamic providers lazily at getSnapshot time", () => {
    let counter = 0;
    registry.addDynamicProvider("counter", () => ({
      name: "Counter",
      data: { value: ++counter },
    }));

    const first = registry.getSnapshot();
    const second = registry.getSnapshot();

    expect(first!.entries["counter"].data).toEqual({ value: 1 });
    expect(second!.entries["counter"].data).toEqual({ value: 2 });
  });

  it("reads fresh values from mutable sources", () => {
    const externalStore = { count: 0 };
    registry.addDynamicProvider("store", () => ({
      data: { count: externalStore.count },
    }));

    externalStore.count = 42;
    const snapshot = registry.getSnapshot();
    expect(snapshot!.entries["store"].data).toEqual({ count: 42 });

    externalStore.count = 100;
    const snapshot2 = registry.getSnapshot();
    expect(snapshot2!.entries["store"].data).toEqual({ count: 100 });
  });

  it("skips dynamic providers that return null/undefined", () => {
    registry.addDynamicProvider("maybe", () => null);
    registry.addDynamicProvider("real", () => ({ name: "Real" }));

    const snapshot = registry.getSnapshot();
    expect(snapshot!.entries).not.toHaveProperty("maybe");
    expect(snapshot!.entries).toHaveProperty("real");
  });

  it("returns null when every dynamic provider yields nothing", () => {
    registry.addDynamicProvider("a", () => null);
    registry.addDynamicProvider("b", () => undefined);

    expect(registry.getSnapshot()).toBeNull();
  });

  it("swallows errors from dynamic providers", () => {
    registry.addDynamicProvider("broken", () => {
      throw new Error("boom");
    });
    registry.addDynamicProvider("ok", () => ({ name: "OK" }));

    const snapshot = registry.getSnapshot();
    expect(snapshot!.entries).not.toHaveProperty("broken");
    expect(snapshot!.entries).toHaveProperty("ok");
  });

  it("removes dynamic providers", () => {
    registry.addDynamicProvider("fn", () => ({ name: "Test" }));
    expect(registry.removeDynamicProvider("fn")).toBe(true);
    expect(registry.removeDynamicProvider("missing")).toBe(false);

    const snapshot = registry.getSnapshot();
    expect(snapshot).toBeNull();
  });

  it("combines static entries and dynamic providers with dynamic overriding on key clash", () => {
    registry.set("shared", { name: "Static" });
    registry.addDynamicProvider("shared", () => ({ name: "Dynamic" }));

    const snapshot = registry.getSnapshot();
    expect(snapshot!.entries["shared"].name).toBe("Dynamic");
  });

  it("does not expose url/title at top level — any page info must live in an entry", () => {
    registry.set("browser-page", {
      name: "Browser page",
      data: { url: "https://app.example.com/orders", title: "Orders" },
    });

    const snapshot = registry.getSnapshot();
    // Only `entries` should exist on the snapshot — no top-level URL/title.
    expect(Object.keys(snapshot!)).toEqual(["entries"]);
    expect(snapshot!.entries["browser-page"].data).toEqual({
      url: "https://app.example.com/orders",
      title: "Orders",
    });
  });
});
