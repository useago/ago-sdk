import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../src/client/AgoClient";
import { AgoProvider } from "../src/react/context/AgoContext";
import { ChatWidget } from "../src/react/components/ChatWidget";
import type { CreateFormCollectorOptions } from "../src/forms/createFormCollector";
import type { AgoMessage } from "../src/client/types";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom does not implement scrollIntoView, which ChatWidget calls on mount.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const orderForm: CreateFormCollectorOptions = {
  name: "order",
  description: "The order the user wants to place.",
  schema: {
    type: "object",
    properties: {
      product: { type: "string" },
      quantity: { type: "number" },
    },
    required: ["product", "quantity"],
  },
};

describe("ChatWidget forms integration", () => {
  it("installs form collectors on mount and removes them on unmount", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <ChatWidget forms={[orderForm]} />
        </AgoProvider>,
      );
    });

    const names = client.getRegisteredFunctions().map((s) => s.name);
    expect(names).toContain("update_order");

    await act(async () => {
      root.unmount();
    });
    expect(client.getRegisteredFunctions()).toHaveLength(0);

    container.remove();
    client.destroy();
  });

  it("registers a submit function when a submit target is configured", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <ChatWidget
            forms={[{ ...orderForm, submit: { via: "client", url: "/api/orders" } }]}
          />
        </AgoProvider>,
      );
    });

    const names = client.getRegisteredFunctions().map((s) => s.name);
    expect(names).toContain("update_order");
    expect(names).toContain("submit_order");

    await act(async () => {
      root.unmount();
    });
    container.remove();
    client.destroy();
  });
});

// A minimal AgoClient stand-in: lets the test drive message events and control
// when the streaming send promise resolves, so we can observe the input state at
// each phase of a turn.
function createDrivableClient() {
  const handlers: Record<string, Array<(data: unknown) => void>> = {};
  const emit = (event: string, data: unknown) =>
    (handlers[event] ?? []).forEach((h) => h(data));
  let resolveSend: (m: AgoMessage) => void = () => {};
  const sendMessage = vi.fn(
    () => new Promise<AgoMessage>((resolve) => (resolveSend = resolve)),
  );
  const client = {
    on: (e: string, h: (data: unknown) => void) => {
      (handlers[e] ??= []).push(h);
    },
    off: (e: string, h: (data: unknown) => void) => {
      handlers[e] = (handlers[e] ?? []).filter((x) => x !== h);
    },
    sendMessage,
    getMessages: vi.fn(async () => []),
  } as unknown as AgoClient;
  return { client, emit, sendMessage, resolveSend: (m: AgoMessage) => resolveSend(m) };
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ChatWidget input blocking during a turn", () => {
  it("blocks while the answer streams, then re-enables while follow-ups load", async () => {
    const { client, emit, resolveSend } = createDrivableClient();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ChatWidget client={client} />);
    });

    const textarea = container.querySelector("textarea")!;
    const form = container.querySelector("form")!;

    // Send a message → the agent is answering → input is blocked.
    await act(async () => {
      setTextareaValue(textarea, "Hi");
    });
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(textarea.disabled).toBe(true);

    // Stream assigns the real id, then the main answer finishes (status DONE).
    await act(async () => {
      emit("message:start", { conversationId: "c1", messageId: "m1" });
    });
    await act(async () => {
      emit("message:answer-complete", {
        id: "m1",
        conversationId: "c1",
        content: "Answer",
        role: "assistant",
        status: "DONE",
        createdAt: new Date(),
      } satisfies AgoMessage);
    });

    // Input re-enables, the answer is shown, and the "..." indicator marks the
    // pending follow-up replies.
    expect(textarea.disabled).toBe(false);
    expect(container.textContent).toContain("Answer");
    expect(
      container.querySelector(".ago-message__followups-loading"),
    ).toBeTruthy();

    // Follow-up replies arrive and the stream closes.
    const finalMessage: AgoMessage = {
      id: "m1",
      conversationId: "c1",
      content: "Answer",
      role: "assistant",
      status: "DONE",
      followUpReplies: ["Pricing", "Book a demo"],
      createdAt: new Date(),
    };
    await act(async () => {
      emit("message:complete", finalMessage);
    });
    await act(async () => {
      resolveSend(finalMessage);
    });

    expect(textarea.disabled).toBe(false);
    expect(
      container.querySelector(".ago-message__followups-loading"),
    ).toBeNull();
    expect(
      container.querySelectorAll(".ago-message__followup-btn"),
    ).toHaveLength(2);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
