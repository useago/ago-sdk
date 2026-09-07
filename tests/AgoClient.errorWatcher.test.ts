import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { CapturedError } from "../src/errors/ErrorWatcher";

function throwUncaught(message: string) {
  window.dispatchEvent(
    new ErrorEvent("error", { message, error: new Error(message) })
  );
}

type ErrorsEntryData = {
  errors: Array<CapturedError & { ageMs: number; firstSeenAgoMs?: number }>;
};

const swallow = () => undefined;

describe("AgoClient error watcher", () => {
  let client: AgoClient | null;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    vi.useFakeTimers();
    originalConsoleError = console.error;
    console.error = vi.fn();
    // Vitest reports a dispatched ErrorEvent as an uncaught exception unless a
    // user "error" listener exists; the watcher is off in several tests here.
    window.addEventListener("error", swallow);
    client = null;
  });

  afterEach(() => {
    client?.destroy();
    window.removeEventListener("error", swallow);
    console.error = originalConsoleError;
    vi.useRealTimers();
  });

  it("is off by default: no listener, no context entry, reportError is a no-op", () => {
    const before = console.error;
    client = new AgoClient({ baseUrl: "https://example.test" });

    expect(console.error).toBe(before);
    throwUncaught("ignored");
    client.reportError(new Error("ignored too"));

    expect(client.getRecentErrors()).toEqual([]);
    expect(client.getContextSnapshot()?.entries["errors:recent"]).toBeUndefined();
  });

  it("errorWatcher: true captures errors into the errors:recent entry with ages", () => {
    client = new AgoClient({ baseUrl: "https://example.test", errorWatcher: true });

    throwUncaught("boom");
    vi.advanceTimersByTime(1500);

    const entry = client.getContextSnapshot()?.entries["errors:recent"];
    expect(entry?.name).toBe("Recent JavaScript errors");
    const data = entry?.data as ErrorsEntryData;
    expect(data.errors).toHaveLength(1);
    expect(data.errors[0]).toMatchObject({
      type: "error",
      message: "boom",
      count: 1,
      ageMs: 1500,
    });
    expect(data.errors[0]).not.toHaveProperty("lastAt");
    expect(data.errors[0]).not.toHaveProperty("firstSeenAgoMs");
  });

  it("omits the entry when nothing was captured", () => {
    client = new AgoClient({ baseUrl: "https://example.test", errorWatcher: true });
    expect(client.getContextSnapshot()?.entries?.["errors:recent"]).toBeUndefined();
  });

  it("passes options through and emits error:captured + context:changed", () => {
    client = new AgoClient({
      baseUrl: "https://example.test",
      errorWatcher: { maxErrors: 1 },
    });
    const captured: CapturedError[] = [];
    const contextChanges = vi.fn();
    client.on("error:captured", (e) => captured.push(e));
    client.on("context:changed", contextChanges);

    throwUncaught("a");
    throwUncaught("b");

    expect(captured.map((e) => e.message)).toEqual(["a", "b"]);
    expect(contextChanges).toHaveBeenCalledTimes(2);
    expect(client.getRecentErrors().map((e) => e.message)).toEqual(["b"]);
  });

  it("reportError records a manual entry with context", () => {
    client = new AgoClient({ baseUrl: "https://example.test", errorWatcher: true });

    client.reportError(new Error("render failed"), { component: "Cart" });

    expect(client.getRecentErrors()[0]).toMatchObject({
      type: "manual",
      message: "render failed",
      context: { component: "Cart" },
    });
  });

  it("clearErrors empties the buffer", () => {
    client = new AgoClient({ baseUrl: "https://example.test", errorWatcher: true });
    throwUncaught("x");
    client.clearErrors();
    expect(client.getRecentErrors()).toEqual([]);
  });

  it("destroy detaches; reviveAfterDestroy re-attaches when configured", () => {
    const before = console.error;
    client = new AgoClient({ baseUrl: "https://example.test", errorWatcher: true });
    expect(console.error).not.toBe(before);

    client.destroy();
    expect(console.error).toBe(before);
    throwUncaught("while destroyed");
    expect(client.getRecentErrors()).toEqual([]);

    client.reviveAfterDestroy();
    throwUncaught("after revive");
    expect(client.getRecentErrors().map((e) => e.message)).toEqual(["after revive"]);
    expect(client.getContextSnapshot()?.entries["errors:recent"]).toBeDefined();
  });

  it("updateConfig toggles the watcher at runtime", () => {
    const before = console.error;
    client = new AgoClient({ baseUrl: "https://example.test" });

    client.updateConfig({ errorWatcher: true });
    throwUncaught("on");
    expect(client.getRecentErrors().map((e) => e.message)).toEqual(["on"]);

    client.updateConfig({ errorWatcher: false });
    expect(console.error).toBe(before);
    throwUncaught("off");
    expect(client.getRecentErrors()).toEqual([]);
    expect(client.getContextSnapshot()?.entries?.["errors:recent"]).toBeUndefined();
  });

  it("feeds the proactive jsErrors signal", () => {
    client = new AgoClient({
      baseUrl: "https://example.test",
      errorWatcher: true,
      proactive: {
        triggers: [],
        enabledOverride: false,
        storage: { getItem: () => null, setItem: () => undefined },
      },
    });

    throwUncaught("crash");
    throwUncaught("crash");
    client.reportError("manual one");

    expect(client.proactive?.getSignalsSnapshot().jsErrors).toBe(3);

    client.proactive?.destroy();
    throwUncaught("after proactive destroy");
    // The client still captures; the (destroyed) collector no longer counts.
    expect(client.getRecentErrors().map((e) => e.count)).toEqual([2, 1, 1]);
  });
});
