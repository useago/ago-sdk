import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../src/client/AgoClient";
import { AgoProvider } from "../src/react/context/AgoContext";
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
