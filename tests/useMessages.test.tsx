import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createApp, defineComponent, h, nextTick } from "vue";
import { AgoService } from "../src/angular/ago.service";
import { useChat as useVueChat } from "../src/vue/composables/useChat";
import { createRoot } from "react-dom/client";
import { currentBindingOperation, invalidateBindingOwner } from "../src/client/bindingOwnership";
import { AgoError } from "../src/client/errors";
import { AgoClient } from "../src/client/AgoClient";
import { AgoProvider } from "../src/react/context/AgoContext";
import { useChat } from "../src/react/hooks/useChat";
import { useMessages } from "../src/react/hooks/useMessages";
import type { AgoMessage } from "../src/client/types";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function emit(client: AgoClient, event: string, payload: unknown) {
  (
    client as unknown as { eventEmitter: { emit: (e: string, p: unknown) => void } }
  ).eventEmitter.emit(event, payload);
}

async function mount(client: AgoClient, Component: React.FC) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <AgoProvider client={client}>
        <Component />
      </AgoProvider>
    );
  });
  return { root };
}

describe("useMessages — server-initiated stream (hidden auto-continuation)", () => {
  it("surfaces a streaming assistant reply and isLoading when a stream starts outside sendMessage", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });

    let snapshot: { messages: AgoMessage[]; isLoading: boolean } = {
      messages: [],
      isLoading: false,
    };
    function Harness() {
      const { messages, isLoading } = useMessages();
      snapshot = { messages, isLoading };
      return <span>ok</span>;
    }
    await mount(client, Harness);

    // A hidden continuation streams straight through the client, so no optimistic
    // placeholder exists. message:start must create the streaming bubble + loading.
    await act(async () => {
      emit(client, "message:start", { conversationId: "c1", messageId: "m2" });
    });
    expect(snapshot.isLoading).toBe(true);
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0]).toMatchObject({
      id: "m2",
      role: "assistant",
      status: "IN_PROGRESS",
    });

    // Chunks append to that placeholder (keyed on the real messageId).
    await act(async () => {
      emit(client, "message:chunk", { content: "Done", conversationId: "c1", messageId: "m2" });
    });
    expect(snapshot.messages[0].content).toBe("Done");

    // Completion reconciles the same entry and clears loading.
    await act(async () => {
      emit(client, "message:complete", {
        id: "m2",
        conversationId: "c1",
        content: "Done",
        role: "assistant",
        status: "DONE",
        createdAt: new Date(),
      } satisfies AgoMessage);
    });
    expect(snapshot.isLoading).toBe(false);
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0].status).toBe("DONE");
  });

  it("does not add a second placeholder when one is already streaming", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });

    let snapshot: { messages: AgoMessage[] } = { messages: [] };
    function Harness() {
      const { messages } = useMessages();
      snapshot = { messages };
      return <span>ok</span>;
    }
    await mount(client, Harness);

    await act(async () => {
      emit(client, "message:start", { conversationId: "c1", messageId: "m1" });
    });
    // A duplicate start (or a first turn already streaming) must not stack bubbles.
    await act(async () => {
      emit(client, "message:start", { conversationId: "c1", messageId: "m1" });
    });
    expect(snapshot.messages).toHaveLength(1);
  });
});


describe("binding conversation projection", () => {
  it("loads the initial conversation, switches together, replaces redacted snapshots, and clears on reset", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const base = { role: "assistant" as const, status: "WAITING_APPROVAL" as const, content: "work", createdAt: new Date() };
    vi.spyOn(client, "setActiveConversation").mockImplementation(async (id) => id ? ({ id, title: id, lastMessageDate: new Date(), messages: [{ ...base, id: "m", conversationId: id, approval: { id: "a", status: "pending", actions: [{ name: "secret", arguments: {} }], allowedDecisions: ["approve"], expiresAt: null } }] }) : null);
    let state!: ReturnType<typeof useChat>;
    function Harness() { state = useChat({ client, conversationId: "a", autoLoad: false }); return null; }
    const { root } = await mount(client, Harness);
    expect(state.currentConversation?.id).toBe("a");
    expect(state.messages[0].approval?.actions).toHaveLength(1);
    await act(async () => { await state.selectConversation("b"); });
    expect(state.currentConversation?.id).toBe("b");
    expect(state.messages[0].conversationId).toBe("b");
    await act(async () => { emit(client, "message:update", { ...base, id: "m", conversationId: "b", approval: null }); });
    expect(state.messages[0].approval).toBeNull();
    await act(async () => { emit(client, "conversation:update", { conversationId: null, interaction: null }); });
    expect(state.messages).toEqual([]);
    expect(state.currentConversation).toBeNull();
    await act(async () => root.unmount());
  });

  it("ignores an older activation that settles after selection changes", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let resolveA!: (value: import("../src/client/types").Conversation) => void;
    vi.spyOn(client, "setActiveConversation").mockImplementation((id) => {
      if (id === "a") return new Promise((resolve) => { resolveA = resolve; });
      return Promise.resolve(id ? { id, title: id, lastMessageDate: new Date(), messages: [] } : null);
    });
    let state!: ReturnType<typeof useChat>;
    function Harness() { state = useChat({ client, conversationId: "a", autoLoad: false }); return null; }
    const { root } = await mount(client, Harness);
    await act(async () => { await state.selectConversation("b"); });
    await act(async () => { resolveA({ id: "a", title: "a", lastMessageDate: new Date(), messages: [] }); });
    expect(state.currentConversation?.id).toBe("b");
    await act(async () => root.unmount());
  });
});

it("StrictMode cleanup cannot detach a later imperative same-ID activation", async () => {
  const client = new AgoClient({ baseUrl: "https://example.test" });
  const activate = vi.spyOn(client, "setActiveConversation").mockImplementation(async (id) => {
    invalidateBindingOwner(client, currentBindingOperation(client));
    return id ? { id, title: id, lastMessageDate: new Date(), messages: [] } : null;
  });
  function Harness() { useMessages({ client, conversationId: "a" }); return null; }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => { root.render(<React.StrictMode><Harness /></React.StrictMode>); });
  await act(async () => { await client.setActiveConversation("a"); });
  const calls = activate.mock.calls.length;
  await act(async () => { root.unmount(); });
  expect(activate.mock.calls).toHaveLength(calls);
});

it("Vue selection follows the same conversation and clears on authentication reset", async () => {
  const client = new AgoClient({ baseUrl: "https://example.test" });
  vi.spyOn(client, "setActiveConversation").mockImplementation(async (id) => id ? {
    id, title: id, lastMessageDate: new Date(), messages: [{ id: "m", conversationId: id, role: "assistant", status: "DONE", content: id, createdAt: new Date() }],
  } : null);
  let state!: ReturnType<typeof useVueChat>;
  const app = createApp(defineComponent({ setup() { state = useVueChat({ client, conversationId: "a", autoLoad: false }); return () => h("div"); } }));
  const host = document.createElement("div");
  app.mount(host);
  await Promise.resolve(); await nextTick();
  expect(state.messages.value[0].content).toBe("a");
  await state.selectConversation("b"); await nextTick();
  expect(state.currentConversation.value?.id).toBe("b");
  expect(state.messages.value[0].content).toBe("b");
  emit(client, "conversation:update", { conversationId: null, interaction: null });
  await nextTick();
  expect(state.messages.value).toEqual([]);
  expect(state.currentConversation.value).toBeNull();
  app.unmount();
});

it("treats detached sends as cleanup and exposes real failures", async () => {
  const client = new AgoClient({ baseUrl: "https://example.test" });
  vi.spyOn(client, "setActiveConversation").mockResolvedValue(null);
  const send = vi.spyOn(client, "sendMessage").mockRejectedValueOnce(new AgoError("detached", "request_detached")).mockRejectedValueOnce(new Error("network failure"));
  let state!: ReturnType<typeof useMessages>;
  function Harness() { state = useMessages({ client }); return null; }
  const { root } = await mount(client, Harness);
  await act(async () => { await state.sendMessage("first"); });
  expect(state.error).toBeNull();
  await act(async () => { await state.sendMessage("second"); });
  expect(state.error?.message).toBe("network failure");
  expect(send).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});

it("does not apply a late send result after switching conversations", async () => {
  const client = new AgoClient({ baseUrl: "https://example.test" });
  vi.spyOn(client, "setActiveConversation").mockImplementation(async (id) => id ? { id, title: id, lastMessageDate: new Date(), messages: [] } : null);
  let resolve!: (message: AgoMessage) => void;
  vi.spyOn(client, "sendMessage").mockImplementation(() => new Promise((done) => { resolve = done; }));
  let state!: ReturnType<typeof useChat>;
  function Harness() { state = useChat({ client, conversationId: "a", autoLoad: false }); return null; }
  const { root } = await mount(client, Harness);
  let sending!: Promise<AgoMessage | null>;
  await act(async () => { sending = state.sendMessage("old"); });
  await act(async () => { await state.selectConversation("b"); });
  await act(async () => { resolve({ id: "old", conversationId: "a", role: "assistant", status: "DONE", content: "old answer", createdAt: new Date() }); await sending; });
  expect(state.conversationId).toBe("b");
  expect(state.messages).toEqual([]);
  await act(async () => root.unmount());
});

it("Angular facade forwards activation and decision and publishes snapshots", async () => {
  const service = new AgoService({ baseUrl: "https://example.test" });
  const client = service.getClient();
  const activate = vi.spyOn(client, "setActiveConversation").mockResolvedValue(null);
  const decide = vi.spyOn(client, "submitApprovalDecision").mockResolvedValue();
  const values: AgoMessage[] = [];
  const sub = service.messageUpdates$.subscribe({ next: (value) => values.push(value) });
  await service.setActiveConversation("a");
  await service.submitApprovalDecision("approval", "reject");
  const message: AgoMessage = { id: "m", conversationId: "a", role: "assistant", status: "DONE", content: "done", createdAt: new Date() };
  emit(client, "message:update", message);
  expect(activate).toHaveBeenCalledWith("a");
  expect(decide).toHaveBeenCalledWith("approval", "reject");
  expect(values).toEqual([message]);
  sub.unsubscribe(); service.destroy();
});

it("React adopts an owned fork and ignores legacy events from another binding", async () => {
  const client = new AgoClient({ baseUrl: "https://example.test" });
  vi.spyOn(client, "setActiveConversation").mockImplementation(async (id) => id ? { id, title: id, lastMessageDate: new Date(), messages: [] } : null);
  const send = vi.spyOn(client, "sendMessage").mockImplementation(async (_content, options) => ({ id: "fork", conversationId: options?.conversationId === "a" ? "b" : options?.conversationId ?? "", role: "assistant", status: "DONE", content: "fork", createdAt: new Date() }));
  let first!: ReturnType<typeof useChat>;
  let second!: ReturnType<typeof useChat>;
  function One() { first = useChat({ client, conversationId: "a", autoLoad: false }); return null; }
  const a = await mount(client, One);
  await act(async () => { await first.sendMessage("fork"); });
  expect(first.conversationId).toBe("b");
  await act(async () => { await first.sendMessage("next"); });
  expect(send.mock.calls[1][1]?.conversationId).toBe("b");
  function Two() { second = useChat({ client, conversationId: "b", autoLoad: false }); return null; }
  const b = await mount(client, Two);
  await act(async () => {
    emit(client, "message:start", { conversationId: "b", messageId: "c1" });
    emit(client, "message:complete", { id: "c1", conversationId: "b", role: "assistant", status: "DONE", content: "c", createdAt: new Date() });
    emit(client, "message:stopped", { conversationId: "b", messageId: "c1" });
  });
  expect(first.messages.some((m) => m.id === "c1")).toBe(false);
  expect(second.messages.some((m) => m.id === "c1")).toBe(true);
  await act(async () => { a.root.unmount(); b.root.unmount(); });
});

it("Vue adopts an owned fork and ignores legacy events from another binding", async () => {
  const client = new AgoClient({ baseUrl: "https://example.test" });
  vi.spyOn(client, "setActiveConversation").mockImplementation(async (id) => id ? { id, title: id, lastMessageDate: new Date(), messages: [] } : null);
  const send = vi.spyOn(client, "sendMessage").mockImplementation(async (_content, options) => ({ id: "fork", conversationId: options?.conversationId === "a" ? "b" : options?.conversationId ?? "", role: "assistant", status: "DONE", content: "fork", createdAt: new Date() }));
  let first!: ReturnType<typeof useVueChat>;
  let second!: ReturnType<typeof useVueChat>;
  const appA = createApp(defineComponent({ setup() { first = useVueChat({ client, conversationId: "a", autoLoad: false }); return () => h("div"); } }));
  appA.mount(document.createElement("div")); await Promise.resolve(); await nextTick();
  await first.sendMessage("fork"); await nextTick();
  expect(first.conversationId.value).toBe("b");
  await first.sendMessage("next");
  expect(send.mock.calls[1][1]?.conversationId).toBe("b");
  const appB = createApp(defineComponent({ setup() { second = useVueChat({ client, conversationId: "b", autoLoad: false }); return () => h("div"); } }));
  appB.mount(document.createElement("div")); await Promise.resolve(); await nextTick();
  emit(client, "message:start", { conversationId: "b", messageId: "c1" });
  emit(client, "message:complete", { id: "c1", conversationId: "b", role: "assistant", status: "DONE", content: "c", createdAt: new Date() });
  await nextTick();
  expect(first.messages.value.some((m) => m.id === "c1")).toBe(false);
  expect(second.messages.value.some((m) => m.id === "c1")).toBe(true);
  appA.unmount(); appB.unmount();
});

it.each(["DONE", "IN_PROGRESS", "WAITING_APPROVAL", "WAITING_CLIENT"] as const)("React settles fork loading from a %s response", async (status) => {
  const client = new AgoClient({ baseUrl: "https://example.test" });
  vi.spyOn(client, "setActiveConversation").mockImplementation(async (id) => id ? { id, title: id, lastMessageDate: new Date(), messages: [] } : null);
  const response: AgoMessage = { id: "fork", conversationId: "b", role: "assistant", status, content: "answer", createdAt: new Date() };
  vi.spyOn(client, "sendMessage").mockImplementation(async () => {
    if (status === "DONE") emit(client, "message:complete", response);
    return response;
  });
  let state!: ReturnType<typeof useChat>;
  function Harness() { state = useChat({ client, conversationId: "a", autoLoad: false }); return null; }
  const { root } = await mount(client, Harness);
  await act(async () => { await state.sendMessage("fork"); });
  expect(state.conversationId).toBe("b");
  expect(state.messages.find((m) => m.id === "fork")?.status).toBe(status);
  expect(state.isLoading).toBe(status !== "DONE");
  if (status !== "DONE") {
    await act(async () => { emit(client, "message:complete", { ...response, status: "DONE" }); });
    expect(state.isLoading).toBe(false);
  }
  await act(async () => root.unmount());
});

it.each(["DONE", "IN_PROGRESS", "WAITING_APPROVAL", "WAITING_CLIENT"] as const)("Vue settles fork loading from a %s response", async (status) => {
  const client = new AgoClient({ baseUrl: "https://example.test" });
  vi.spyOn(client, "setActiveConversation").mockImplementation(async (id) => id ? { id, title: id, lastMessageDate: new Date(), messages: [] } : null);
  const response: AgoMessage = { id: "fork", conversationId: "b", role: "assistant", status, content: "answer", createdAt: new Date() };
  vi.spyOn(client, "sendMessage").mockImplementation(async () => {
    if (status === "DONE") emit(client, "message:complete", response);
    return response;
  });
  let state!: ReturnType<typeof useVueChat>;
  const app = createApp(defineComponent({ setup() { state = useVueChat({ client, conversationId: "a", autoLoad: false }); return () => h("div"); } }));
  app.mount(document.createElement("div")); await Promise.resolve(); await nextTick();
  await state.sendMessage("fork"); await nextTick();
  expect(state.conversationId.value).toBe("b");
  expect(state.messages.value.find((m) => m.id === "fork")?.status).toBe(status);
  expect(state.isLoading.value).toBe(status !== "DONE");
  if (status !== "DONE") {
    emit(client, "message:complete", { ...response, status: "DONE" }); await nextTick();
    expect(state.isLoading.value).toBe(false);
  }
  app.unmount();
});


it.each(["React", "Vue"] as const)("%s follows a real fork before the initial send settles", async (framework) => {
  const forkId = "11111111-1111-4111-8111-111111111111";
  const originalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const fixture = (name: string) => readFileSync(`tests/fixtures/background-sdk/${name}`, "utf8");
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    if (path.endsWith(`/conversations/${originalId}`)) return new Response(fixture("history-final.json").replaceAll(forkId, originalId), { headers: { "Content-Type": "application/json" } });
    if (path.endsWith("/api/sdk/v1/messages")) return new Response(fixture("initial-send.sse"), { headers: { "Content-Type": "text/event-stream" } });
    if (path.endsWith("/messages/33333333-3333-4333-8333-333333333333/events")) return new Response(fixture("follow-to-final.sse"), { headers: { "Content-Type": "text/event-stream" } });
    throw new Error(`Unexpected request: ${path}`);
  });
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  const originalSend = client.sendMessage.bind(client);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(client, "sendMessage").mockImplementation(async (...args) => { const response = await originalSend(...args); await gate; return response; });
  let react!: ReturnType<typeof useChat>;
  let vue!: ReturnType<typeof useVueChat>;
  let dispose: () => Promise<void>;
  if (framework === "React") {
    function Harness() { react = useChat({ client, conversationId: originalId, autoLoad: false }); return null; }
    const mounted = await mount(client, Harness);
    dispose = async () => { await act(async () => mounted.root.unmount()); };
  } else {
    const app = createApp(defineComponent({ setup() { vue = useVueChat({ client, conversationId: originalId, autoLoad: false }); return () => h("div"); } }));
    app.mount(document.createElement("div")); await new Promise((resolve) => setTimeout(resolve, 0)); await nextTick();
    dispose = async () => { app.unmount(); };
  }
  const completed = client.waitFor("message:complete", { timeout: 2000 });
  let sending!: Promise<AgoMessage | null>;
  await act(async () => {
    sending = framework === "React" ? react.sendMessage("fork") : vue.sendMessage("fork");
    await completed;
  });
  await nextTick();
  expect(framework === "React" ? react.conversationId : vue.conversationId.value).toBe(forkId);
  const before = framework === "React" ? react.messages : vue.messages.value;
  expect(before.find((m) => m.id === "33333333-3333-4333-8333-333333333333")?.status).toBe("DONE");
  expect(before.find((m) => m.id === "33333333-3333-4333-8333-333333333333")?.attachments?.length).toBeGreaterThan(0);
  await act(async () => { release(); await sending; }); await nextTick();
  const messages = framework === "React" ? react.messages : vue.messages.value;
  expect(messages.find((m) => m.id === "33333333-3333-4333-8333-333333333333")?.status).toBe("DONE");
  expect(framework === "React" ? react.isLoading : vue.isLoading.value).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(3);
  await dispose(); client.destroy();
});

it.each(["React", "Vue"] as const)("%s ignores a real fork's late follow after navigation", async (framework) => {
  const forkId = "11111111-1111-4111-8111-111111111111";
  const originalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const nextId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const fixture = (name: string) => readFileSync(`tests/fixtures/background-sdk/${name}`, "utf8");
  let followRequested!: () => void;
  const requested = new Promise<void>((resolve) => { followRequested = resolve; });
  let releaseFollow!: (response: Response) => void;
  const follow = new Promise<Response>((resolve) => { releaseFollow = resolve; });
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    for (const id of [originalId, nextId]) {
      if (path.endsWith(`/conversations/${id}`)) return new Response(fixture("history-final.json").replaceAll(forkId, id), { headers: { "Content-Type": "application/json" } });
    }
    if (path.endsWith("/api/sdk/v1/messages")) return new Response(fixture("initial-send.sse"), { headers: { "Content-Type": "text/event-stream" } });
    if (path.endsWith("/messages/33333333-3333-4333-8333-333333333333/events")) { followRequested(); return follow; }
    throw new Error(`Unexpected request: ${path}`);
  });
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  const originalSend = client.sendMessage.bind(client);
  let releaseSend!: () => void;
  const gate = new Promise<void>((resolve) => { releaseSend = resolve; });
  vi.spyOn(client, "sendMessage").mockImplementation(async (...args) => { const response = await originalSend(...args); await gate; return response; });
  let react!: ReturnType<typeof useChat>;
  let vue!: ReturnType<typeof useVueChat>;
  let dispose: () => Promise<void>;
  if (framework === "React") {
    function Harness() { react = useChat({ client, conversationId: originalId, autoLoad: false }); return null; }
    const mounted = await mount(client, Harness);
    dispose = async () => { await act(async () => mounted.root.unmount()); };
  } else {
    const app = createApp(defineComponent({ setup() { vue = useVueChat({ client, conversationId: originalId, autoLoad: false }); return () => h("div"); } }));
    app.mount(document.createElement("div")); await new Promise((resolve) => setTimeout(resolve, 0)); await nextTick();
    dispose = async () => { app.unmount(); };
  }
  let sending!: Promise<AgoMessage | null>;
  await act(async () => { sending = framework === "React" ? react.sendMessage("fork") : vue.sendMessage("fork"); await requested; });
  expect(framework === "React" ? react.conversationId : vue.conversationId.value).toBe(forkId);
  await act(async () => { await (framework === "React" ? react.selectConversation(nextId) : vue.selectConversation(nextId)); });
  await act(async () => { releaseFollow(new Response(fixture("follow-to-final.sse"), { headers: { "Content-Type": "text/event-stream" } })); releaseSend(); await sending; });
  await nextTick();
  expect(framework === "React" ? react.conversationId : vue.conversationId.value).toBe(nextId);
  expect((framework === "React" ? react.messages : vue.messages.value).every((m) => m.conversationId === nextId)).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(4);
  await dispose(); client.destroy();
});
