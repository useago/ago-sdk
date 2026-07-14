import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SignalCollector } from "../src/signals/SignalCollector";

function click(x: number, y: number) {
  window.dispatchEvent(
    new MouseEvent("click", { clientX: x, clientY: y, bubbles: true })
  );
}

function goTo(path: string, collector: SignalCollector) {
  window.history.pushState({}, "", path);
  // Route observation is poll-on-demand: a snapshot read registers the change.
  collector.getSnapshot();
}

describe("SignalCollector", () => {
  let collector: SignalCollector;

  beforeEach(() => {
    vi.useFakeTimers();
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    collector?.destroy();
    vi.useRealTimers();
  });

  it("accumulates dwell and idle time; activity resets idle only", () => {
    collector = new SignalCollector();
    collector.start();

    vi.advanceTimersByTime(5000);
    let snap = collector.getSnapshot();
    expect(snap.dwellMs).toBe(5000);
    expect(snap.idleMs).toBe(5000);

    window.dispatchEvent(new Event("mousemove"));
    vi.advanceTimersByTime(1000);
    snap = collector.getSnapshot();
    expect(snap.dwellMs).toBe(6000);
    expect(snap.idleMs).toBe(1000);
  });

  it("tracks route changes: dwell resets, recentRoutes appends, per-route counters clear", () => {
    collector = new SignalCollector();
    collector.start();

    collector.signalFieldError("email");
    vi.advanceTimersByTime(3000);
    expect(collector.getSnapshot().fieldErrors).toEqual({ email: 1 });

    goTo("/checkout", collector);
    const snap = collector.getSnapshot();
    expect(snap.route).toBe("/checkout");
    expect(snap.dwellMs).toBe(0);
    expect(snap.recentRoutes).toEqual(["/", "/checkout"]);
    expect(snap.fieldErrors).toEqual({}); // per-route reset
  });

  it("detects A→B→A→B route bounces", () => {
    collector = new SignalCollector();
    collector.start();

    goTo("/a", collector);
    vi.advanceTimersByTime(500);
    goTo("/b", collector);
    vi.advanceTimersByTime(500);
    goTo("/a", collector);
    vi.advanceTimersByTime(500);
    expect(collector.getSnapshot().routeBounces).toBe(0);

    goTo("/b", collector);
    expect(collector.getSnapshot().routeBounces).toBe(1);
    expect(
      collector.getSignals().filter((s) => s.type === "route_bounce")
    ).toHaveLength(1);
  });

  it("detects rage clicks: N close clicks within the window", () => {
    collector = new SignalCollector({
      rageClickCount: 3,
      rageClickWindowMs: 1000,
      rageClickRadiusPx: 24,
    });
    collector.start();

    click(100, 100);
    vi.advanceTimersByTime(100);
    click(105, 102);
    vi.advanceTimersByTime(100);
    click(98, 99);

    const snap = collector.getSnapshot();
    expect(snap.rageClicks).toBe(1);
    expect(collector.getSignals().some((s) => s.type === "rage_click")).toBe(true);
  });

  it("does not count spread-out or slow clicks as rage clicks", () => {
    collector = new SignalCollector({
      rageClickCount: 3,
      rageClickWindowMs: 1000,
      rageClickRadiusPx: 24,
    });
    collector.start();

    // Too far apart in space.
    click(100, 100);
    click(300, 300);
    click(100, 100);
    expect(collector.getSnapshot().rageClicks).toBe(0);

    // Too slow.
    click(50, 50);
    vi.advanceTimersByTime(1200);
    click(50, 50);
    vi.advanceTimersByTime(1200);
    click(50, 50);
    expect(collector.getSnapshot().rageClicks).toBe(0);
  });

  it("does not count clicks that change the page state (working controls)", () => {
    let step = 0;
    collector = new SignalCollector({
      rageClickCount: 3,
      getPageState: () => ({ step }),
    });
    collector.start();

    click(10, 10);
    step = 1; // the click DID something
    click(10, 10);
    step = 2;
    click(10, 10);
    expect(collector.getSnapshot().rageClicks).toBe(0);
  });

  it("counts app-pushed field errors by name (never values)", () => {
    collector = new SignalCollector();
    collector.start();

    collector.signalFieldError("iban");
    collector.signalFieldError("iban");
    collector.signalFieldError("email");

    const snap = collector.getSnapshot();
    expect(snap.fieldErrors).toEqual({ iban: 2, email: 1 });
    const signal = collector.getSignals().filter((s) => s.type === "field_error");
    expect(signal[1].count).toBe(2);
    expect(signal[1].meta).toEqual({ field: "iban" });
  });

  it("exposes page state in the snapshot, skippable for the context provider", () => {
    collector = new SignalCollector({
      getPageState: () => ({ step: "documents", uploaded: 0 }),
    });
    collector.start();

    expect(collector.getSnapshot().pageState).toEqual({
      step: "documents",
      uploaded: 0,
    });
    expect(collector.getSnapshot({ pageState: false }).pageState).toBeNull();
  });

  it("notifies subscribers of new signals and stops after destroy", () => {
    collector = new SignalCollector();
    collector.start();

    const listener = vi.fn();
    collector.subscribe(listener);
    collector.signalFieldError("email");
    expect(listener).toHaveBeenCalledTimes(1);

    const before = collector.getSignals().length;
    collector.destroy();
    click(10, 10);
    window.dispatchEvent(new Event("mousemove"));
    expect(collector.getSignals().length).toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
