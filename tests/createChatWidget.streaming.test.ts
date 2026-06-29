import { afterEach, describe, expect, it, vi } from "vitest";
import { mountChatWidget } from "../src/widget/createChatWidget";
import type { AgoClient } from "../src/client/AgoClient";
import type { AgoMessage } from "../src/client/types";

// A minimal AgoClient stand-in that lets the test emit streaming events and hold
// the send promise open (so the assistant message stays IN_PROGRESS).
function drivableClient() {
  const handlers: Record<string, Array<(d: unknown) => void>> = {};
  const emit = (e: string, d: unknown) => (handlers[e] ?? []).forEach((h) => h(d));
  let resolveSend: (m: AgoMessage) => void = () => {};
  const sendMessage = vi.fn(
    () => new Promise<AgoMessage>((r) => (resolveSend = r)),
  );
  const client = {
    on: (e: string, h: (d: unknown) => void) => ((handlers[e] ??= []).push(h)),
    off: (e: string, h: (d: unknown) => void) =>
      (handlers[e] = (handlers[e] ?? []).filter((x) => x !== h)),
    sendMessage,
    getMessages: vi.fn(async () => []),
    getConversations: vi.fn(async () => []),
  } as unknown as AgoClient;
  return { client, emit, resolveSend: (m: AgoMessage) => resolveSend(m) };
}

describe("mountChatWidget streaming render batching", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("coalesces streamed tokens into one render per frame and loses no content", () => {
    // Capture rAF callbacks instead of auto-running them, so we control flushing.
    const rafCbs: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCbs.push(cb);
      return rafCbs.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const { client, emit } = drivableClient();
    const target = document.createElement("div");
    document.body.appendChild(target);
    const widget = mountChatWidget(target, { client });

    // Start a turn: pushes the user + an IN_PROGRESS assistant message and renders
    // once (synchronously, showing the streaming dots). The send promise stays open.
    void widget.sendMessage("hi");

    emit("message:start", { conversationId: "c1", messageId: "m1" });
    emit("message:chunk", { content: "Hel" });
    emit("message:chunk", { content: "lo " });
    emit("message:chunk", { content: "world" });

    // Three tokens scheduled exactly one frame (not one render each).
    expect(rafCbs.length).toBe(1);
    // Nothing committed to the DOM until the frame fires.
    expect(target.textContent).not.toContain("Hello world");

    // Flush the frame → a single render commits all buffered tokens.
    rafCbs.forEach((cb) => cb(0));
    expect(target.textContent).toContain("Hello world");

    widget.destroy();
    target.remove();
  });

  it("does not leave a render scheduled after destroy()", () => {
    const rafCbs: FrameRequestCallback[] = [];
    let cancelled = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCbs.push(cb);
      return rafCbs.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      cancelled++;
    });

    const { client, emit } = drivableClient();
    const target = document.createElement("div");
    document.body.appendChild(target);
    const widget = mountChatWidget(target, { client });

    void widget.sendMessage("hi");
    emit("message:start", { conversationId: "c1", messageId: "m1" });
    emit("message:chunk", { content: "partial" });

    // A frame is pending; destroy must cancel it so it can't fire post-teardown.
    expect(rafCbs.length).toBe(1);
    widget.destroy();
    expect(cancelled).toBeGreaterThanOrEqual(1);

    target.remove();
  });
});
