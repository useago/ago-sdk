import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ErrorWatcher } from "../src/errors/ErrorWatcher";
import type { CapturedError } from "../src/errors/ErrorWatcher";

function throwUncaught(message: string, extra: Partial<ErrorEventInit> = {}) {
  window.dispatchEvent(
    new ErrorEvent("error", {
      message,
      filename: "https://app.test/assets/main.js?v=3",
      lineno: 12,
      colno: 5,
      error: new Error(message),
      ...extra,
    })
  );
}

// jsdom has no PromiseRejectionEvent: dispatch a plain event with a `reason`.
function rejectUnhandled(reason: unknown) {
  const event = new Event("unhandledrejection");
  Object.defineProperty(event, "reason", { value: reason });
  window.dispatchEvent(event);
}

const swallow = () => undefined;

describe("ErrorWatcher", () => {
  let watcher: ErrorWatcher;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    vi.useFakeTimers();
    originalConsoleError = console.error;
    // Keep the test output quiet: the wrapper calls through to this.
    console.error = vi.fn();
    // Vitest reports a dispatched ErrorEvent as an uncaught exception unless a
    // user "error" listener exists; ours may be detached in some tests.
    window.addEventListener("error", swallow);
    window.history.pushState({}, "", "/checkout");
  });

  afterEach(() => {
    watcher?.destroy();
    window.removeEventListener("error", swallow);
    console.error = originalConsoleError;
    vi.useRealTimers();
  });

  it("captures uncaught errors with source, position, stack and route", () => {
    watcher = new ErrorWatcher();
    watcher.start();

    throwUncaught("boom");

    const [err] = watcher.getErrors();
    expect(err).toMatchObject({
      type: "error",
      message: "boom",
      source: "https://app.test/assets/main.js",
      line: 12,
      col: 5,
      route: "/checkout",
      count: 1,
    });
    expect(err.stack).toBeDefined();
    expect(err.stack).not.toMatch(/^Error: boom/);
  });

  it("captures unhandled rejections, Error or not", () => {
    watcher = new ErrorWatcher();
    watcher.start();

    rejectUnhandled(new TypeError("fetch failed"));
    rejectUnhandled("plain string");
    rejectUnhandled({ code: 42 });

    expect(watcher.getErrors().map((e) => [e.type, e.message])).toEqual([
      ["unhandledrejection", "TypeError: fetch failed"],
      ["unhandledrejection", "plain string"],
      ["unhandledrejection", '{"code":42}'],
    ]);
  });

  it("captures console.error calls and ignores the SDK's own lines", () => {
    watcher = new ErrorWatcher();
    watcher.start();

    console.error("Failed to load", new Error("ENOENT"), { id: 7 });
    console.error("[AGO SDK] internal thing");

    const errors = watcher.getErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      type: "console",
      message: 'Failed to load Error: ENOENT {"id":7}',
    });
    expect(errors[0].stack).toBeDefined();
    // The wrapper called through.
    expect(console.error).not.toBe(originalConsoleError);
  });

  it("deduplicates repeats into a count and refreshes lastAt", () => {
    watcher = new ErrorWatcher();
    watcher.start();

    throwUncaught("same");
    vi.advanceTimersByTime(1000);
    throwUncaught("same");
    throwUncaught("other");

    const errors = watcher.getErrors();
    expect(errors.map((e) => [e.message, e.count])).toEqual([
      ["same", 2],
      ["other", 1],
    ]);
    expect(errors[0].lastAt - errors[0].firstAt).toBe(1000);
  });

  it("caps the number of distinct errors, oldest dropped first", () => {
    watcher = new ErrorWatcher({ maxErrors: 2 });
    watcher.start();

    throwUncaught("a");
    throwUncaught("b");
    throwUncaught("c");

    expect(watcher.getErrors().map((e) => e.message)).toEqual(["b", "c"]);
  });

  it("prunes errors older than maxAgeMs when read", () => {
    watcher = new ErrorWatcher({ maxAgeMs: 5000 });
    watcher.start();

    throwUncaught("old");
    vi.advanceTimersByTime(6000);
    throwUncaught("fresh");

    expect(watcher.getErrors().map((e) => e.message)).toEqual(["fresh"]);
  });

  it("truncates long messages and stacks", () => {
    watcher = new ErrorWatcher({ maxStackChars: 50 });
    watcher.start();

    const long = "x".repeat(700);
    const error = new Error("deep");
    error.stack = "Error: deep\n" + "    at frame\n".repeat(30);
    // No `error` object: the message comes from the event itself.
    window.dispatchEvent(new ErrorEvent("error", { message: long }));
    window.dispatchEvent(new ErrorEvent("error", { message: "deep", error }));

    const [first, second] = watcher.getErrors();
    expect(first.message.length).toBeLessThan(560);
    expect(first.message).toMatch(/…\[truncated 200 chars\]$/);
    expect(second.stack!.length).toBeLessThan(90);
    expect(second.stack).toMatch(/…\[truncated \d+ chars\]$/);
  });

  it("lets a filter redact or drop entries", () => {
    watcher = new ErrorWatcher({
      filter: (e) =>
        e.message.includes("secret")
          ? null
          : { ...e, message: e.message.replace(/\S+@\S+/, "<email>") },
    });
    watcher.start();

    throwUncaught("user bob@acme.test not found");
    throwUncaught("leaked secret token");

    expect(watcher.getErrors().map((e) => e.message)).toEqual([
      "user <email> not found",
    ]);
  });

  it("records manual reports with clamped context", () => {
    watcher = new ErrorWatcher();
    watcher.start();

    watcher.report(new RangeError("bad index"), {
      component: "OrderTable",
      rows: Array.from({ length: 80 }, (_, i) => i),
    });

    const [err] = watcher.getErrors();
    expect(err).toMatchObject({ type: "manual", message: "RangeError: bad index" });
    expect(err.context?.component).toBe("OrderTable");
    expect((err.context?.rows as unknown[]).length).toBe(51); // 50 + marker
  });

  it("notifies subscribers on every capture, repeats included", () => {
    watcher = new ErrorWatcher();
    watcher.start();
    const seen: CapturedError[] = [];
    const unsubscribe = watcher.subscribe((e) => seen.push(e));

    throwUncaught("x");
    throwUncaught("x");
    unsubscribe();
    throwUncaught("x");

    expect(seen.map((e) => e.count)).toEqual([1, 2]);
  });

  it("destroy removes the listeners and restores console.error", () => {
    const before = console.error;
    watcher = new ErrorWatcher();
    watcher.start();
    expect(console.error).not.toBe(before);

    watcher.destroy();
    expect(console.error).toBe(before);

    throwUncaught("after destroy");
    console.error("after destroy");
    expect(watcher.getErrors()).toEqual([]);
  });

  it("leaves console.error alone when someone wrapped it after us", () => {
    const before = console.error;
    watcher = new ErrorWatcher();
    watcher.start();
    const ours = console.error;
    const theirs = vi.fn((...args: unknown[]) => ours(...args));
    console.error = theirs;

    watcher.destroy();
    expect(console.error).toBe(theirs);

    // Ours still calls through the chain, harmlessly.
    console.error("still logs");
    expect(before).toHaveBeenCalledWith("still logs");
  });

  it("start is idempotent and clear empties the buffer", () => {
    watcher = new ErrorWatcher();
    watcher.start();
    watcher.start();

    throwUncaught("once");
    expect(watcher.getErrors()).toHaveLength(1); // not captured twice

    watcher.clear();
    expect(watcher.getErrors()).toEqual([]);
  });
});
