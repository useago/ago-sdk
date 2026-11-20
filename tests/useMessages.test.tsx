import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../src/client/AgoClient";
import { useMessages } from "../src/react/hooks/useMessages";
import { createMockClient } from "../src/testing/createMockClient";
import { createFakeServer, flush } from "./helpers/sseServer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

describe("useMessages", () => {
  it("works with the public mock client and detaches on unmount", async () => {
    const client = createMockClient();
    let state!: ReturnType<typeof useMessages>;
    function Harness() { state = useMessages({ client, conversationId: "a" }); return <span />; }
    const root = createRoot(document.createElement("div"));
    await act(async () => { root.render(<Harness />); });
    expect(client.getActiveConversation()).toBe("a");
    await act(async () => { await state.sendMessage("hello"); });
    await act(async () => root.unmount());
    expect(client.getActiveConversation()).toBeNull();
  });

  it("clears the prior send error when a retry succeeds", async () => {
    const server = createFakeServer();
    server.fetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const client = new AgoClient({ baseUrl: "https://example.test", fetch: server.fetch });
    let state!: ReturnType<typeof useMessages>;
    function Harness() { state = useMessages({ client }); return null; }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Harness />));

    await act(async () => { expect(await state.sendMessage("hello")).toBeNull(); });
    expect(state.error).toBeInstanceOf(Error);

    await act(async () => {
      const retry = state.sendMessage("hello");
      await vi.waitFor(() => expect(server.streams).toHaveLength(1));
      server.streams[0].push({ message_id: "m1", thread: { id: "c1" }, content: "hi" });
      server.streams[0].end();
      await expect(retry).resolves.toMatchObject({ content: "hi" });
    });
    expect(state.error).toBeNull();
    await act(async () => root.unmount());
    client.destroy();
  });

  it("shows only the selected conversation while other answers continue", async () => {
    const server = createFakeServer(); vi.stubGlobal("fetch", server.fetch);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let state!: ReturnType<typeof useMessages>;
    const committedMessages: string[][] = [];
    function Harness({ id }: { id: string }) {
      state = useMessages({ client, conversationId: id });
      useLayoutEffect(() => {
        if (id === "b") committedMessages.push(state.messages.map((message) => message.content));
      });
      return <span />;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => { root.render(<Harness id="a" />); await flush(); });
    await act(async () => {
      void client.conversation("a").sendMessage("question A");
      void client.conversation("b").sendMessage("question B");
      await vi.waitFor(() => expect(server.streams).toHaveLength(2));
      server.streams[0].push({ message_id: "ma", thread: { id: "a" }, content: "visible" });
      server.streams[1].push({ message_id: "mb", thread: { id: "b" }, content: "other" });
      await flush();
    });
    expect(state.messages.map((m) => m.content)).toEqual(["question A", "visible"]);
    expect(state.isLoading).toBe(true);
    await act(async () => { root.render(<Harness id="b" />); await flush(); });
    expect(committedMessages.flat()).not.toContain("visible");
    expect(state.messages.map((m) => m.content)).toEqual(["question B", "other"]);
    await act(async () => { server.streams.forEach((s) => s.end()); await flush(); root.unmount(); });
  });

  it("does not detach a later imperative selection of the same ID on unmount", async () => {
    const server = createFakeServer(); vi.stubGlobal("fetch", server.fetch);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const setActive = vi.spyOn(client, "setActiveConversation");
    function Harness() { useMessages({ client, conversationId: "a" }); return <span />; }
    const root = createRoot(document.createElement("div"));
    await act(async () => { root.render(<React.StrictMode><Harness /></React.StrictMode>); await flush(); });
    client.setActiveConversation("a");
    setActive.mockClear();
    await act(async () => root.unmount());
    expect(setActive).not.toHaveBeenCalledWith(null);
  });

  it("stops only its own draft before the server names it", async () => {
    const server = createFakeServer(); vi.stubGlobal("fetch", server.fetch);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let state!: ReturnType<typeof useMessages>;
    function Harness() { state = useMessages({ client }); return <span />; }
    const root = createRoot(document.createElement("div"));
    await act(async () => { root.render(<Harness />); });
    void client.conversation("other").sendMessage("other");
    await vi.waitFor(() => expect(server.streams).toHaveLength(1));
    let sent!: Promise<unknown>;
    await act(async () => { sent = state.sendMessage("hello"); });
    await vi.waitFor(() => expect(server.streams).toHaveLength(2));
    await act(async () => { await state.stop(); await sent; });
    expect(server.streams[1].signal?.aborted).toBe(true);
    expect(server.streams[0].signal?.aborted).toBe(false);
    await act(async () => { server.streams[0].end(); root.unmount(); });
  });
});

it("clears loaded messages on logout and ignores the old load result", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
  const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old", fetch: fetcher as typeof fetch });
  let state!: ReturnType<typeof useMessages>;
  function Harness() { state = useMessages({ client, conversationId: "a" }); return <span />; }
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(<Harness />); });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  await act(async () => { client.updateConfig({ userJwt: null }); });
  await act(async () => { resolve(new Response(JSON.stringify({ id: "a", title: "private", messages: [{ id: "m", role: "assistant", content: "private", status: "DONE" }] }))); await flush(); });
  expect(state.messages).toEqual([]);
  expect(state.conversationId).toBeUndefined();
  await act(async () => root.unmount());
});

it("projects redacted approval history without exposing review actions", async () => {
  const { readFileSync } = await import("node:fs");
  const history = readFileSync("tests/fixtures/background-sdk/history-approval-redacted.json", "utf8");
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes("/conversations/")) return new Response(history);
    throw new Error(`Unexpected request ${String(url)}`);
  });
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  let state!: ReturnType<typeof useMessages>;
  function Harness() { state = useMessages({ client, conversationId: "11111111-1111-4111-8111-111111111111" }); return <span />; }
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(<Harness />); await flush(); });
  const message = state.messages.find((entry) => entry.role === "assistant");
  expect(message?.approval?.actions).toEqual([]);
  expect(JSON.stringify(state.messages)).not.toContain("record-42");
  await act(async () => root.unmount()); client.destroy();
});

it("follows its own fork before the initial send finishes", async () => {
  const server = createFakeServer(); vi.stubGlobal("fetch", server.fetch);
  const client = new AgoClient({ baseUrl: "https://example.test" });
  let state!: ReturnType<typeof useMessages>;
  function Harness() { state = useMessages({ client, conversationId: "original" }); return <span />; }
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(<Harness />); await flush(); });
  let sent!: Promise<unknown>;
  await act(async () => {
    sent = state.sendMessage("fork");
    await vi.waitFor(() => expect(server.streams).toHaveLength(1));
    server.streams[0].push({ thread: { id: "fork" }, message_id: "answer", content: "fork answer" });
    await flush();
  });
  expect(state.conversationId).toBe("fork");
  expect(state.messages.map((m) => m.content)).toEqual(["fork", "fork answer"]);
  await act(async () => { server.streams[0].push({ thread: { id: "fork" }, message_id: "answer", status: "DONE" }); server.streams[0].end(); await sent; await flush(); root.unmount(); });
});

it("keeps a newer selection when a previous send forks late", async () => {
  const server = createFakeServer(); vi.stubGlobal("fetch", server.fetch);
  const client = new AgoClient({ baseUrl: "https://example.test" });
  let state!: ReturnType<typeof useMessages>;
  function Harness({ id }: { id: string }) { state = useMessages({ client, conversationId: id }); return <span />; }
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(<Harness id="original" />); await flush(); });
  let sent!: Promise<unknown>;
  await act(async () => { sent = state.sendMessage("fork"); await vi.waitFor(() => expect(server.streams).toHaveLength(1)); });
  await act(async () => { root.render(<Harness id="newer" />); await flush(); });
  await act(async () => { server.streams[0].push({ thread: { id: "fork" }, message_id: "answer", content: "late" }); server.streams[0].end(); await sent; await flush(); });
  expect(state.conversationId).toBe("newer");
  expect(state.messages).toEqual([]);
  await act(async () => root.unmount());
});
