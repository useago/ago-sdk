import { describe, it, expect, vi } from "vitest";
import { createStore } from "../src/state/createStore";

describe("createStore", () => {
  it("returns the initial value from get()", () => {
    const store = createStore({ count: 0 });
    expect(store.get()).toEqual({ count: 0 });
  });

  it("set() replaces the value", () => {
    const store = createStore({ count: 0 });
    store.set({ count: 5 });
    expect(store.get()).toEqual({ count: 5 });
  });

  it("notifies subscribers synchronously on set()", () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();

    store.subscribe(listener);
    store.set({ count: 1 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ count: 1 });
  });

  it("notifies every subscriber", () => {
    const store = createStore(0);
    const a = vi.fn();
    const b = vi.fn();

    store.subscribe(a);
    store.subscribe(b);
    store.set(42);

    expect(a).toHaveBeenCalledWith(42);
    expect(b).toHaveBeenCalledWith(42);
  });

  it("does not call subscribers added after a set()", () => {
    const store = createStore(0);
    store.set(1);

    const late = vi.fn();
    store.subscribe(late);

    expect(late).not.toHaveBeenCalled();
  });

  it("unsubscribe() stops further notifications", () => {
    const store = createStore(0);
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);
    store.set(1);
    unsubscribe();
    store.set(2);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1);
  });
});

/** Minimal in-memory Storage stand-in for persistence tests. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

describe("createStore — persistence", () => {
  it("restores state from storage on creation", () => {
    const storage = fakeStorage({ cart: JSON.stringify({ items: ["a"] }) });
    const store = createStore(
      { items: [] as string[] },
      { key: "cart", storage },
    );
    expect(store.get()).toEqual({ items: ["a"] });
  });

  it("writes serialized state to storage on every set()", () => {
    const storage = fakeStorage();
    const store = createStore({ n: 0 }, { key: "k", storage });

    store.set({ n: 1 });
    expect(storage.map.get("k")).toBe(JSON.stringify({ n: 1 }));

    store.set({ n: 2 });
    expect(storage.map.get("k")).toBe(JSON.stringify({ n: 2 }));
  });

  it("falls back to initial when stored JSON is malformed", () => {
    const storage = fakeStorage({ k: "{not json" });
    const store = createStore({ n: 7 }, { key: "k", storage });
    expect(store.get()).toEqual({ n: 7 });
  });

  it("stays in-memory when storage throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("disabled");
      },
      setItem: () => {
        throw new Error("disabled");
      },
      removeItem: () => {
        throw new Error("disabled");
      },
    };
    const store = createStore({ n: 0 }, { key: "k", storage: throwing });
    expect(() => store.set({ n: 1 })).not.toThrow();
    expect(store.get()).toEqual({ n: 1 });
  });

  it("ignores empty storage and keeps the initial value", () => {
    const storage = fakeStorage();
    const store = createStore({ n: 5 }, { key: "k", storage });
    expect(store.get()).toEqual({ n: 5 });
  });
});
