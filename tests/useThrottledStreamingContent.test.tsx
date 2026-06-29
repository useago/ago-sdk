import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useThrottledStreamingContent } from "../src/react/hooks/useThrottledStreamingContent";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ content, delay }: { content: string; delay?: number }) {
  const out = useThrottledStreamingContent(content, delay);
  return <span data-testid="out">{out}</span>;
}

describe("useThrottledStreamingContent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const render = (content: string, delay = 100) =>
    act(() => {
      root.render(<Harness content={content} delay={delay} />);
    });

  it("returns the initial content immediately (no delay for static content)", () => {
    render("hello");
    expect(container.textContent).toBe("hello");
  });

  it("throttles rapid updates, keeping the previous value until the timer fires", () => {
    render("a");
    render("ab");
    render("abc");
    expect(container.textContent).toBe("a"); // throttled

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(container.textContent).toBe("abc"); // jumps to the latest, not "ab"
  });

  it("always lands the final value once changes settle", () => {
    render("start");
    render("start middle");
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(container.textContent).toBe("start middle");

    render("start middle end");
    expect(container.textContent).toBe("start middle"); // throttled
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(container.textContent).toBe("start middle end");
  });

  it("emits at most once per window during a continuous burst", () => {
    render("t0");
    for (let i = 1; i <= 5; i++) {
      render(`t0${"x".repeat(i)}`);
      act(() => {
        vi.advanceTimersByTime(20); // 100ms total across the loop
      });
    }
    expect(container.textContent).toBe("t0xxxxx");
  });
});
