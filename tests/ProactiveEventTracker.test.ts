import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProactiveEventTracker } from "../src/proactive/ProactiveEventTracker";
import type { ProactiveTrackedEvent } from "../src/proactive/types";

const shownEvent = (id: string): ProactiveTrackedEvent => ({
  clientNudgeId: id,
  triggerId: "t1",
  source: "static",
  type: "shown",
  message: "Need a hand?",
  occurredAt: new Date("2026-07-09T10:00:00Z").getTime(),
});

describe("ProactiveEventTracker", () => {
  let tracker: ProactiveEventTracker;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    tracker?.destroy();
    vi.useRealTimers();
  });

  it("batches events and flushes once after the debounce window", async () => {
    const post = vi.fn(async () => ({}));
    tracker = new ProactiveEventTracker({ post, agent: "support" });

    tracker.track(shownEvent("n1"));
    tracker.track({ ...shownEvent("n1"), type: "dismissed", message: undefined });
    expect(post).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(post).toHaveBeenCalledTimes(1);

    const [path, body, options] = post.mock.calls[0] as unknown as [
      string,
      { events: Array<Record<string, unknown>> },
      { keepalive?: boolean } | undefined,
    ];
    expect(path).toBe("/api/sdk/v1/proactive/events");
    expect(options).toBeUndefined();
    expect(body.events).toHaveLength(2);
    // Wire format per the backend contract: snake_case + ISO-8601.
    expect(body.events[0]).toEqual({
      client_nudge_id: "n1",
      trigger_id: "t1",
      source: "static",
      type: "shown",
      message: "Need a hand?",
      agent: "support",
      occurred_at: "2026-07-09T10:00:00.000Z",
    });
    expect(body.events[1].type).toBe("dismissed");
    expect(body.events[1]).not.toHaveProperty("message");
  });

  it("flushes with keepalive when the page hides (fetch, not sendBeacon)", () => {
    const post = vi.fn(async () => ({}));
    tracker = new ProactiveEventTracker({ post });

    tracker.track(shownEvent("n2"));
    window.dispatchEvent(new Event("pagehide"));

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][2]).toEqual({ keepalive: true });
  });

  it("flushes with keepalive when the document becomes hidden", () => {
    const post = vi.fn(async () => ({}));
    tracker = new ProactiveEventTracker({ post });
    tracker.track(shownEvent("n3"));

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][2]).toEqual({ keepalive: true });
  });

  it("swallows delivery failures silently and drops the batch (no retry)", async () => {
    const post = vi.fn(async () => {
      throw new Error("network down");
    });
    tracker = new ProactiveEventTracker({ post });

    tracker.track(shownEvent("n4"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(post).toHaveBeenCalledTimes(1);

    // Nothing re-queued: the next window has nothing to send.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("destroy flushes what is left and detaches the page-hide listeners", () => {
    const post = vi.fn(async () => ({}));
    tracker = new ProactiveEventTracker({ post });

    tracker.track(shownEvent("n5"));
    tracker.destroy();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][2]).toEqual({ keepalive: true });

    // Tracking after destroy is a no-op; page hide sends nothing.
    tracker.track(shownEvent("n6"));
    window.dispatchEvent(new Event("pagehide"));
    expect(post).toHaveBeenCalledTimes(1);
  });
});
