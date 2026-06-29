import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ChatWidget } from "../src/react/components/ChatWidget";
import type { AgoClient } from "../src/client/AgoClient";
import type { AgoMessage } from "../src/client/types";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

function createDrivableClient() {
  const handlers: Record<string, Array<(d: unknown) => void>> = {};
  const emit = (e: string, d: unknown) => (handlers[e] ?? []).forEach((h) => h(d));
  let resolveSend: (m: AgoMessage) => void = () => {};
  const sendMessage = vi.fn(() => new Promise<AgoMessage>((r) => (resolveSend = r)));
  const client = {
    on: (e: string, h: (d: unknown) => void) => ((handlers[e] ??= []).push(h)),
    off: (e: string, h: (d: unknown) => void) =>
      (handlers[e] = (handlers[e] ?? []).filter((x) => x !== h)),
    sendMessage,
    getMessages: vi.fn(async () => []),
  } as unknown as AgoClient;
  return { client, emit, resolveSend: (m: AgoMessage) => resolveSend(m) };
}

function setTextareaValue(t: HTMLTextAreaElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(t, v);
  t.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ChatWidget incremental streaming", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders chunk content incrementally (before answer-complete), batched per frame", async () => {
    vi.useFakeTimers();
    const rafCbs: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCbs.push(cb);
      return rafCbs.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const { client, emit } = createDrivableClient();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ChatWidget client={client} />);
    });

    const textarea = container.querySelector("textarea")!;
    const form = container.querySelector("form")!;
    await act(async () => {
      setTextareaValue(textarea, "Hi");
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await act(async () => {
      emit("message:start", { conversationId: "c1", messageId: "m1" });
    });

    // Count only the frames our chunk batching schedules (ignore any React
    // scheduler frames around the start setState above).
    const framesBefore = rafCbs.length;
    await act(async () => {
      emit("message:chunk", { content: "Hel", conversationId: "c1", messageId: "m1" });
      emit("message:chunk", { content: "lo ", conversationId: "c1", messageId: "m1" });
      emit("message:chunk", { content: "world", conversationId: "c1", messageId: "m1" });
    });
    // Three tokens scheduled exactly one batching frame, not one per token.
    expect(rafCbs.length - framesBefore).toBe(1);
    expect(container.textContent).not.toContain("Hello world");

    // Flush the frame (commits content to state) then the throttle window (parses).
    await act(async () => {
      rafCbs.forEach((cb) => cb(0));
    });
    await act(async () => {
      vi.advanceTimersByTime(120);
    });

    // Content is visible mid-stream — no answer-complete was emitted.
    expect(container.textContent).toContain("Hello world");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
