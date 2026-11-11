import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../src/client/AgoClient";
import {
  useConversationChat,
  type UseConversationChatResult,
} from "../src/react/hooks/useConversationChat";
import { createFakeServer, flush, type FakeServer } from "./helpers/sseServer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let server: FakeServer;
beforeEach(() => {
  server = createFakeServer();
  vi.stubGlobal("fetch", server.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountChat(client: AgoClient, conversationId?: string) {
  const result: { current: UseConversationChatResult | null } = { current: null };
  function Harness({ id }: { id?: string }) {
    result.current = useConversationChat(id, { client });
    return <span>ok</span>;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Harness id={conversationId} />);
  });
  const rerender = (id?: string) =>
    act(async () => {
      root.render(<Harness id={id} />);
    });
  return { result, root, rerender };
}

describe("useConversationChat", () => {
  it("shows the conversation it is given, and the other one's answer is still whole on return", async () => {
    server.onConversation = (id) => ({ id, title: `Title ${id}`, messages: [] });
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const { result, rerender } = await mountChat(client, "cA");

    await act(async () => {
      void result.current!.sendMessage("question A");
      await vi.waitFor(() => expect(server.streams).toHaveLength(1));
      server.streams[0].push({ message_id: "mA", thread: { id: "cA" }, content: "Part 1 " });
      await flush();
    });
    expect(result.current!.isGenerating).toBe(true);

    await rerender("cB");
    expect(result.current!.conversationId).toBe("cB");
    expect(result.current!.isGenerating).toBe(false);

    await act(async () => {
      server.streams[0].push({ message_id: "mA", thread: { id: "cA" }, content: "part 2" });
      await flush();
    });
    expect(result.current!.messages).toEqual([]);

    await rerender("cA");
    expect(result.current!.messages.map((m) => m.content)).toEqual(["question A", "Part 1 part 2"]);
    expect(result.current!.isGenerating).toBe(true);
    await act(async () => {
      server.streams[0].end();
      await flush();
    });
    expect(result.current!.isGenerating).toBe(false);
  });

  it("refetches a conversation that finished in the background once nothing kept it", async () => {
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const { result, rerender } = await mountChat(client, "cA");
    await act(async () => {
      void result.current!.sendMessage("question A");
      await vi.waitFor(() => expect(server.streams).toHaveLength(1));
    });
    await rerender("cB");
    server.onConversation = (id) => ({
      id,
      title: "",
      messages: [
        { id: "u1", content: "question A", role: "user", status: "DONE", created_at: "2026-11-01T10:00:00Z" },
        { id: "mA", content: "Saved answer", role: "assistant", status: "DONE", created_at: "2026-11-01T10:00:01Z" },
      ],
    });
    await act(async () => {
      server.streams[0].end();
      await flush();
    });

    await rerender("cA");
    await act(async () => {
      await flush();
    });
    expect(result.current!.messages.map((m) => m.content)).toEqual(["question A", "Saved answer"]);
  });

  it("does not stop the answer when it unmounts", async () => {
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const { result, root } = await mountChat(client, "cA");
    await act(async () => {
      void result.current!.sendMessage("question");
      await vi.waitFor(() => expect(server.streams).toHaveLength(1));
    });

    await act(async () => {
      root.unmount();
    });

    expect(server.streams[0].signal?.aborted).toBe(false);
    expect(server.calls.some((c) => c.url.endsWith("/stop"))).toBe(false);
    expect(client.isGenerating("cA")).toBe(true);
    server.streams[0].end();
  });

  it("hides hidden messages", async () => {
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const { result } = await mountChat(client, "cA");
    await act(async () => {
      void result.current!.sendMessage("nudge", { hidden: true });
      await vi.waitFor(() => expect(server.streams).toHaveLength(1));
    });
    expect(result.current!.messages).toEqual([]);
    server.streams[0].end();
  });
});
