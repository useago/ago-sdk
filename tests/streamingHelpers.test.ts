import { describe, it, expect, vi, beforeEach } from "vitest";
import { onMessage, onMessageChunk, onMessageError, onToolCall, onFunctionInvoke } from "../src/streaming/helpers";
import type { AgoClient } from "../src/client/AgoClient";

function createFakeClient() {
  const listeners = new Map<string, Set<Function>>();
  return {
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: Function) => {
      listeners.get(event)?.delete(handler);
    }),
    _emit(event: string, data: unknown) {
      listeners.get(event)?.forEach((h) => h(data));
    },
  } as unknown as AgoClient & { _emit: (event: string, data: unknown) => void };
}

describe("Streaming helpers", () => {
  let client: ReturnType<typeof createFakeClient>;

  beforeEach(() => {
    client = createFakeClient();
  });

  it("onMessage subscribes and unsubscribes", () => {
    const cb = vi.fn();
    const unsub = onMessage(client, cb);
    expect(client.on).toHaveBeenCalledWith("message:complete", cb);

    client._emit("message:complete", { id: "1", content: "hi" });
    expect(cb).toHaveBeenCalledOnce();

    unsub();
    expect(client.off).toHaveBeenCalledWith("message:complete", cb);
  });

  it("onMessageChunk subscribes", () => {
    const cb = vi.fn();
    onMessageChunk(client, cb);
    expect(client.on).toHaveBeenCalledWith("message:chunk", cb);
  });

  it("onMessageError subscribes", () => {
    const cb = vi.fn();
    onMessageError(client, cb);
    expect(client.on).toHaveBeenCalledWith("message:error", cb);
  });

  it("onToolCall subscribes", () => {
    const cb = vi.fn();
    onToolCall(client, cb);
    expect(client.on).toHaveBeenCalledWith("toolCall:received", cb);
  });

  it("onFunctionInvoke subscribes", () => {
    const cb = vi.fn();
    onFunctionInvoke(client, cb);
    expect(client.on).toHaveBeenCalledWith("function:invoke", cb);
  });
});
