import { afterEach, describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../src/client/AgoClient";
import { AgoProvider } from "../src/react/context/AgoContext";
import { useMessages } from "../src/react/hooks/useMessages";
import type { AgoMessage } from "../src/client/types";
import { createFakeServer } from "./helpers/sseServer";

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

describe("useMessages — other conversations' answers", () => {
  it("ignores events of a conversation that is not the hook's", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let snapshot: { messages: AgoMessage[]; isLoading: boolean } = { messages: [], isLoading: false };
    function Harness() {
      const { messages, isLoading } = useMessages({ conversationId: "mine" });
      snapshot = { messages, isLoading };
      return <span>ok</span>;
    }
    await mount(client, Harness);

    await act(async () => {
      emit(client, "message:start", { conversationId: "other", messageId: "x1" });
      emit(client, "message:chunk", { content: "leak", conversationId: "other", messageId: "x1" });
      emit(client, "message:complete", {
        id: "x1",
        conversationId: "other",
        content: "leak",
        role: "assistant",
        status: "DONE",
        createdAt: new Date(),
      });
      emit(client, "message:error", { error: "boom", conversationId: "other" });
    });

    expect(snapshot.messages).toEqual([]);
    expect(snapshot.isLoading).toBe(false);
  });

  it("adopts the id of its first answer when it has none, then ignores other conversations", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let snapshot: { messages: AgoMessage[]; conversationId?: string } = { messages: [] };
    function Harness() {
      const { messages, conversationId } = useMessages();
      snapshot = { messages, conversationId };
      return <span>ok</span>;
    }
    await mount(client, Harness);

    await act(async () => {
      emit(client, "message:start", { conversationId: "c1", messageId: "m1" });
      // Same tick, before React re-renders with the adopted id.
      emit(client, "message:start", { conversationId: "c2", messageId: "m2" });
      emit(client, "message:chunk", { content: "Hi", conversationId: "c1", messageId: "m1" });
    });

    expect(snapshot.conversationId).toBe("c1");
    expect(snapshot.messages.map((m) => [m.id, m.content])).toEqual([["m1", "Hi"]]);
  });

  it("finalizes the stopped answer by its id, not the last streaming bubble", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let snapshot: AgoMessage[] = [];
    function Harness() {
      snapshot = useMessages({ conversationId: "c1" }).messages;
      return <span>ok</span>;
    }
    await mount(client, Harness);

    await act(async () => {
      emit(client, "message:start", { conversationId: "c1", messageId: "m1" });
      emit(client, "message:chunk", { content: "First", conversationId: "c1", messageId: "m1" });
      emit(client, "message:start", { conversationId: "c1", messageId: "m2" });
      emit(client, "message:chunk", { content: "Second", conversationId: "c1", messageId: "m2" });
      emit(client, "message:stopped", { conversationId: "c1", messageId: "m1" });
    });

    expect(snapshot.map((m) => [m.id, m.status])).toEqual([
      ["m1", "CANCELED"],
      ["m2", "IN_PROGRESS"],
    ]);
  });
});

describe("useMessages — stop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops only its own new conversation, before the server named it", async () => {
    const server = createFakeServer();
    vi.stubGlobal("fetch", server.fetch);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let hook!: ReturnType<typeof useMessages>;
    function Harness() {
      hook = useMessages();
      return <span>ok</span>;
    }
    await mount(client, Harness);

    // Another conversation is answering in the background.
    void client.conversation("other").sendMessage("Summarize last week");
    await vi.waitFor(() => expect(server.streams).toHaveLength(1));

    // The hook's first message: no frame yet, so no conversation id.
    let sent!: Promise<unknown>;
    await act(async () => {
      sent = hook.sendMessage("Hello");
    });
    await vi.waitFor(() => expect(server.streams).toHaveLength(2));

    await act(async () => {
      await hook.stop();
      await sent;
    });

    expect(server.streams[1].signal?.aborted).toBe(true);
    expect(server.streams[0].signal?.aborted).toBe(false);
    expect(client.isGenerating("other")).toBe(true);
  });
});
