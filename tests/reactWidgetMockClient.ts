import { vi } from "vitest";
import { createMockClient } from "../src/testing/createMockClient";
import type { AgoMessage } from "../src/client/types";

/** Event-driven fixture for widget presentation tests. */
export function createDrivableClient() {
  let resolveSend: (message: AgoMessage) => void = () => {};
  const sendMessage = vi.fn(() => new Promise<AgoMessage>((resolve) => { resolveSend = resolve; }));
  const stop = vi.fn(async () => null);
  const client = createMockClient({ overrides: { sendMessage, stop, getMessages: async () => [], approveFunction: async () => {}, rejectFunction: async () => {}, submitApprovalDecision: async () => {} } });
  let pending = false;
  const conversations = new Map<string, ReturnType<typeof makeConversation>>();
  let active: string | null = null;
  let draftCount = 0;
  function makeConversation(id: string, draft: boolean) {
    let snapshot = { id, isDraft: draft, title: "", messages: [] as AgoMessage[], interaction: null as import("../src/client/types").ConversationInteraction | null, isGenerating: false, isLoading: false, error: null as Error | null };
    const listeners = new Set<() => void>();
    const forks = new Set<(id: string) => void>();
    const notify = () => { snapshot = { ...snapshot }; for (const listener of listeners) listener(); };
    return {
      get id() { return snapshot.id; },
      get isDraft() { return snapshot.isDraft; },
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      _subscribeToFork: (listener: (id: string) => void) => { forks.add(listener); return () => forks.delete(listener); },
      fork: (id: string) => { for (const listener of forks) listener(id); },
      load: async () => {
        const history = await client.getConversation(id);
        snapshot = { ...snapshot, title: history.title, messages: history.messages ?? [], interaction: history.interaction ?? null }; notify();
        return history;
      },
      sendMessage: async (content: string, options?: { files?: unknown[] }) => {
        snapshot = { ...snapshot, isGenerating: true, messages: [...snapshot.messages, { id: "local-user", conversationId: snapshot.id, role: "user", status: "DONE", content, createdAt: new Date() }, { id: "local-answer", conversationId: snapshot.id, role: "assistant", status: "IN_PROGRESS", content: "", createdAt: new Date() }] }; notify();
        pending = true;
        try {
          const message = await client.sendMessage(content, { conversationId: snapshot.isDraft ? undefined : snapshot.id, ...options } as never);
          if (snapshot.isDraft && message.conversationId) { snapshot = { ...snapshot, id: message.conversationId, isDraft: false }; }
          snapshot = { ...snapshot, isGenerating: !["DONE", "ERROR", "CANCELED"].includes(message.status), messages: snapshot.messages.filter((entry) => entry.id !== "local-answer" && entry.id !== message.id).concat(message.hidden ? [] : [message]) }; notify();
          return message;
        } catch (error) { snapshot = { ...snapshot, isGenerating: false, error: error as Error }; notify(); throw error; } finally { pending = false; }
      },
      stop: () => client.stop(snapshot.isDraft ? undefined : snapshot.id),
      update(event: string, data: any) {
        const eventId = data?.conversationId;
        if (eventId && snapshot.id !== eventId && !snapshot.isDraft) return;
        if (snapshot.isDraft && eventId) snapshot = { ...snapshot, id: eventId, isDraft: false };
        if (event === "message:start") {
          const message: AgoMessage = { id: data.messageId, conversationId: eventId, content: "", role: "assistant", status: "IN_PROGRESS", createdAt: new Date() };
          snapshot = { ...snapshot, isGenerating: true, messages: snapshot.messages.some((m) => m.id === data.messageId) ? snapshot.messages : [...snapshot.messages.filter((m) => m.id !== "local-answer"), message] };
        } else if (event === "message:chunk") {
          snapshot = { ...snapshot, messages: snapshot.messages.map((m) => m.id === data.messageId ? { ...m, content: m.content + data.content } : m) };
        } else if (["message:update", "message:complete", "message:answer-complete"].includes(event)) {
          const message = data as AgoMessage; const index = snapshot.messages.findIndex((m) => m.id === message.id);
          const messages = [...snapshot.messages]; if (index < 0) messages.push(message); else messages[index] = message;
          snapshot = { ...snapshot, messages, isGenerating: event === "message:complete" ? false : snapshot.isGenerating };
        } else if (event === "conversation:update" && data?.conversationId === snapshot.id) snapshot = { ...snapshot, interaction: data.interaction };
        else if (event === "message:stopped") snapshot = { ...snapshot, isGenerating: false };
        else return;
        notify();
      },
    };
  }
  client.conversation = ((id?: string) => {
    const key = id ?? `draft-${++draftCount}`;
    if (!conversations.has(key)) conversations.set(key, makeConversation(key, !id));
    return conversations.get(key)!;
  }) as typeof client.conversation;
  client.setActiveConversation = vi.fn((id: string | null) => { active = id; });
  client.getConversation = vi.fn(async (id: string) => ({ id, title: "", lastMessageDate: new Date(), messages: [] }));
  const emit = (event: string, data: any) => {
    if (event === "message:start" && pending && active && data.conversationId && active !== data.conversationId) {
      const previous = conversations.get(active); const target = client.conversation(data.conversationId);
      active = data.conversationId; previous?.fork(data.conversationId);
      void target;
    }
    for (const conversation of conversations.values()) conversation.update(event, data);
    client.__emitEvent(event as never, data as never);
  };
  return { client, emit, sendMessage, stop, resolveSend: (message: AgoMessage) => resolveSend(message), getActive: () => active };
}
