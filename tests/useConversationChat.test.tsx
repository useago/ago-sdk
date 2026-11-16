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

it("does not start background following when the view unmounts before the initial response", async () => {
  const { readFileSync } = await import("node:fs");
  const initial = readFileSync("tests/fixtures/background-sdk/initial-send.sse", "utf8");
  let response!: ReadableStreamDefaultController<Uint8Array>;
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
    const path = String(url); calls.push(path);
    if (path.endsWith("/api/sdk/v1/messages")) return new Response(new ReadableStream<Uint8Array>({ start(controller) { response = controller; } }));
    if (path.includes("/conversations/")) return new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", messages: [] }));
    throw new Error(`Unexpected background read: ${path}`);
  }));
  const client = new AgoClient({ baseUrl: "https://example.test" });
  const { result, root } = await mountChat(client);
  let sent!: Promise<unknown>;
  await act(async () => { sent = result.current!.sendMessage("report"); await vi.waitFor(() => expect(response).toBeDefined()); root.unmount(); });
  await act(async () => { response.enqueue(new TextEncoder().encode(initial)); response.close(); await sent; await flush(); });
  expect(calls.filter((url) => /\/messages\/[^/]+\/(events|status)$/.test(url))).toEqual([]);
  expect(calls.some((url) => url.endsWith("/stop"))).toBe(false);
  client.destroy();
});

it("does not detach a later mount of the same conversation", async () => {
  const { readFileSync } = await import("node:fs");
  const running = readFileSync("tests/fixtures/background-sdk/history-running.json", "utf8");
  let followSignal: AbortSignal | null | undefined;
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/conversations/")) return new Response(running);
    if (String(url).endsWith("/events")) {
      followSignal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({ start() {} }));
    }
    throw new Error(String(url));
  });
  vi.stubGlobal("fetch", fetcher);
  const client = new AgoClient({ baseUrl: "https://example.test" });
  const id = "11111111-1111-4111-8111-111111111111";
  const first = await mountChat(client, id);
  await vi.waitFor(() => expect(followSignal).toBeDefined());
  expect(first.result.current!.interaction).toEqual({ canSendMessage: false, blockingMessageId: "33333333-3333-4333-8333-333333333333" });
  const second = await mountChat(client, id);
  await act(async () => first.root.unmount());
  expect(followSignal?.aborted).toBe(false);
  await act(async () => second.root.unmount());
  expect(followSignal?.aborted).toBe(true);
  client.destroy();
});

it("does not detach a later imperative selection of the same conversation", async () => {
  const { readFileSync } = await import("node:fs");
  const running = readFileSync("tests/fixtures/background-sdk/history-running.json", "utf8");
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/conversations/")) return new Response(running);
    if (String(url).endsWith("/events")) { signal = init?.signal; return new Response(new ReadableStream<Uint8Array>({ start() {} })); }
    throw new Error(String(url));
  }));
  const client = new AgoClient({ baseUrl: "https://example.test" });
  const id = "11111111-1111-4111-8111-111111111111";
  const view = await mountChat(client, id);
  await vi.waitFor(() => expect(signal).toBeDefined());
  client.setActiveConversation(id);
  await act(async () => view.root.unmount());
  expect(signal?.aborted).toBe(false);
  client.destroy();
});
