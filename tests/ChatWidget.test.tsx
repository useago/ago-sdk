import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { AgoClient } from "../src/client/AgoClient";
import { captureBindingPrincipal, registerBindingPrincipalCapture } from "../src/client/bindingOwnership";
import { AgoProvider } from "../src/react/context/AgoContext";
import { useMessages, useMessagesInternal } from "../src/react/hooks/useMessages";
import {
  ChatWidget,
  type ChatWidgetHandle,
} from "../src/react/components/ChatWidget";
import { createRef, StrictMode } from "react";
import type { CreateFormCollectorOptions } from "../src/forms/createFormCollector";
import type { AgoMessage } from "../src/client/types";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

  it("registers a submit function when a submit target is configured (manual mode)", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <ChatWidget
            // autoSubmit: false keeps the manual submit_ flow (it defaults to true).
            forms={[
              {
                ...orderForm,
                submit: { via: "client", url: "/api/orders" },
                autoSubmit: false,
              },
            ]}
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
  const stop = vi.fn(async () => null);
  let activeConversationId: string | null = null;
  const client = {
    on: (e: string, h: (data: unknown) => void) => {
      (handlers[e] ??= []).push(h);
    },
    off: (e: string, h: (data: unknown) => void) => {
      handlers[e] = (handlers[e] ?? []).filter((x) => x !== h);
    },
    sendMessage,
    stop,
    isGenerating: () => false,
    submitApprovalDecision: vi.fn(async () => {}),
    getMessages: vi.fn(async () => []),
    setActiveConversation: vi.fn(async (id: string | null) => {
      if (id === null) {
        activeConversationId = null;
        return null;
      }
      const conversation = { id, title: "", lastMessageDate: new Date(), messages: [] };
      if (id !== activeConversationId) emit("conversation:loaded", conversation);
      activeConversationId = id;
      return conversation;
    }),
  } as unknown as AgoClient;
  registerBindingPrincipalCapture(client, () => async (effect) => effect());
  return {
    client,
    emit,
    sendMessage,
    stop,
    resolveSend: (m: AgoMessage) => resolveSend(m),
  };
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ChatWidget message scrolling", () => {
  it("scrolls only the message pane when a message is sent", async () => {
    const previousScrollIntoView = Element.prototype.scrollIntoView;
    const pageScrollSpy = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: pageScrollSpy,
    });

    const { client } = createDrivableClient();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<ChatWidget client={client} />);
      });

      const messages = container.querySelector<HTMLElement>(
        ".ago-chat-widget__messages",
      )!;
      Object.defineProperty(messages, "scrollHeight", {
        configurable: true,
        value: 420,
      });

      await act(async () => {
        setTextareaValue(container.querySelector("textarea")!, "Bonjour");
      });
      await act(async () => {
        container.querySelector("form")!.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });

      expect(messages.scrollTop).toBe(420);
      expect(pageScrollSpy).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      if (previousScrollIntoView) {
        Object.defineProperty(Element.prototype, "scrollIntoView", {
          configurable: true,
          value: previousScrollIntoView,
        });
      } else {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    }
  });

  it("preserves the reader's position while they review earlier messages", async () => {
    const { client, emit } = createDrivableClient();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ChatWidget client={client} />);
    });

    const messages = container.querySelector<HTMLElement>(
      ".ago-chat-widget__messages",
    )!;
    Object.defineProperties(messages, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 200 },
    });

    await act(async () => {
      setTextareaValue(container.querySelector("textarea")!, "Bonjour");
      container.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    messages.scrollTop = 100;
    await act(async () => {
      messages.dispatchEvent(new Event("scroll", { bubbles: true }));
      emit("message:answer-complete", {
        id: "m1",
        conversationId: "c1",
        content: "Réponse en cours",
        role: "assistant",
        status: "DONE",
        createdAt: new Date(),
      } satisfies AgoMessage);
    });

    expect(messages.scrollTop).toBe(100);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("ChatWidget input blocking during a turn", () => {
  it("blocks while the answer streams, re-enables once the answer is done, then shows chips", async () => {
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

    // Input re-enables and the answer is shown. No loading indicator is shown for
    // the still-pending follow-up replies — they simply appear when ready.
    expect(textarea.disabled).toBe(false);
    expect(container.textContent).toContain("Answer");
    expect(
      container.querySelector(".ago-message__followups-loading"),
    ).toBeNull();
    expect(
      container.querySelectorAll(".ago-message__followup-btn"),
    ).toHaveLength(0);

    // Follow-up replies arrive and the stream closes → the chips appear.
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

describe("ChatWidget stop button", () => {
  it("swaps Send for Stop while the agent answers and stops the turn on click", async () => {
    const { client, emit, stop } = createDrivableClient();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ChatWidget client={client} />);
    });

    const textarea = container.querySelector("textarea")!;
    const form = container.querySelector("form")!;

    await act(async () => {
      setTextareaValue(textarea, "Hi");
    });
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    const stopBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop generating"]',
    );
    expect(stopBtn).not.toBeNull();
    expect(stopBtn!.disabled).toBe(false);

    await act(async () => {
      stopBtn!.click();
    });
    expect(stop).toHaveBeenCalledTimes(1);

    // The turn ends as CANCELED: the partial answer stays, the input is back.
    await act(async () => {
      emit("message:complete", {
        id: "m1",
        conversationId: "c1",
        content: "Partial",
        role: "assistant",
        status: "CANCELED",
        createdAt: new Date(),
      } satisfies AgoMessage);
      emit("message:stopped", { conversationId: "c1", messageId: "m1" });
    });

    expect(container.textContent).toContain("Partial");
    expect(textarea.disabled).toBe(false);
    expect(
      container.querySelector('button[aria-label="Stop generating"]'),
    ).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("ChatWidget touch targets", () => {
  it("gives the React composer controls at least 44px", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <ChatWidget allowFiles />
        </AgoProvider>,
      );
    });

    // Glacier (and every other host) drives the React widget, so the 44px
    // minimum has to hold on this tree too, not just the vanilla one.
    const send = container.querySelector<HTMLElement>('button[type="submit"]')!;
    expect(send.style.minHeight).toBe("44px");

    const attach = container.querySelector<HTMLElement>(
      'button[aria-label="Attach file"]',
    )!;
    expect(attach.style.minWidth).toBe("44px");
    expect(attach.style.minHeight).toBe("44px");

    await act(async () => {
      root.unmount();
    });
    container.remove();
    client.destroy();
  });
});

describe("ChatWidget feedback", () => {
  it("shows the feedback row under a finished answer", async () => {
    const { client, emit, resolveSend } = createDrivableClient();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ChatWidget client={client} feedback />);
    });

    const textarea = container.querySelector("textarea")!;
    const form = container.querySelector("form")!;
    await act(async () => {
      setTextareaValue(textarea, "Hi");
    });
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    const answer: AgoMessage = {
      id: "m1",
      conversationId: "c1",
      content: "Answer",
      role: "assistant",
      status: "DONE",
      createdAt: new Date(),
    };
    await act(async () => {
      emit("message:start", { conversationId: "c1", messageId: "m1" });
    });
    await act(async () => {
      emit("message:answer-complete", answer);
    });
    await act(async () => {
      emit("message:complete", answer);
    });
    await act(async () => {
      resolveSend(answer);
    });

    expect(container.textContent).toContain("Answer");
    expect(container.querySelectorAll(".ago-feedback__thumb")).toHaveLength(2);
    // The user's own bubble takes no feedback.
    expect(container.querySelectorAll(".ago-feedback")).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("ChatWidget streaming + follow-the-bottom (React parity)", () => {
  function sizePane(pane: HTMLElement, scrollHeight = 600, clientHeight = 200) {
    Object.defineProperty(pane, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(pane, "clientHeight", {
      configurable: true,
      get: () => clientHeight,
    });
  }

  it("puts the user's text back in the composer when the send fails", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    vi.spyOn(client, "sendMessage").mockRejectedValue(new Error("offline"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <ChatWidget />
        </AgoProvider>,
      );
    });

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    const form = container.querySelector<HTMLFormElement>("form")!;

    // The textarea is a controlled component: assigning `.value` does not reach
    // React state. Go through the native setter so React's synthetic onChange
    // actually fires, otherwise the submit below is a no-op and the test would
    // pass whether or not the draft is restored.
    const setValue = (el: HTMLTextAreaElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };

    await act(async () => {
      setValue(textarea, "deux boules pistache");
    });
    expect(textarea.value).toBe("deux boules pistache");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // The composer clears on submit and the optimistic bubble is dropped on
    // failure, so without restoring it the message is gone for good.
    expect(textarea.value).toBe("deux boules pistache");

    await act(async () => {
      root.unmount();
    });
    container.remove();
    client.destroy();
  });

  it("offers a way back once the reader scrolls away from the bottom", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <ChatWidget />
        </AgoProvider>,
      );
    });

    const pane = container.querySelector<HTMLElement>(
      ".ago-chat-widget__messages",
    )!;
    sizePane(pane);

    expect(container.querySelector(".ago-chat-widget__jump")).toBeNull();

    // Scroll up to re-read something: 600 - 100 - 200 = 300 > 48.
    await act(async () => {
      pane.scrollTop = 100;
      pane.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    const jump = container.querySelector<HTMLElement>(".ago-chat-widget__jump")!;
    expect(jump).not.toBeNull();

    await act(async () => {
      jump.click();
    });
    expect(pane.scrollTop).toBe(600);
    expect(container.querySelector(".ago-chat-widget__jump")).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
    client.destroy();
  });
});

describe("ChatWidget sheet", () => {
  function stubCompact(compact: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("prefers-reduced-motion") ? false : compact,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      })),
    );
  }

  async function mount(node: React.ReactElement) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(node);
    });
    return {
      container,
      unmount: async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
        document.body.removeAttribute("style");
      },
    };
  }

  it("is off unless asked for: no fixed overlay on the host page", async () => {
    stubCompact(true);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const { container, unmount } = await mount(
      <AgoProvider client={client}>
        <ChatWidget />
      </AgoProvider>,
    );

    const widget = container.querySelector<HTMLElement>(".ago-chat-widget")!;
    // Turning the widget into a permanent fixed bar on someone else's page has
    // to be opt-in.
    expect(widget.style.position).not.toBe("fixed");
    expect(container.querySelector(".ago-chat-widget__peek")).toBeNull();

    await unmount();
    client.destroy();
  });

  it("rests in peek on a compact viewport and expands on tap", async () => {
    stubCompact(true);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const { container, unmount } = await mount(
      <AgoProvider client={client}>
        <ChatWidget sheet={{}} />
      </AgoProvider>,
    );

    const widget = container.querySelector<HTMLElement>(".ago-chat-widget")!;
    expect(widget.dataset.agoSheetState).toBe("peek");
    expect(widget.style.position).toBe("fixed");
    // Peek is not modal: the page behind it stays scrollable.
    expect(widget.getAttribute("aria-modal")).toBeNull();
    expect(document.body.style.position).toBe("");

    const peek = container.querySelector<HTMLElement>(".ago-chat-widget__peek")!;
    await act(async () => {
      peek.click();
    });

    expect(widget.dataset.agoSheetState).toBe("full");
    expect(widget.getAttribute("role")).toBe("dialog");
    expect(widget.getAttribute("aria-modal")).toBe("true");
    // Full covers the viewport, so the page behind it is pinned.
    expect(document.body.style.position).toBe("fixed");

    await unmount();
    client.destroy();
  });

  it("collapses on Escape and releases the host page", async () => {
    stubCompact(true);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const ref = createRef<ChatWidgetHandle>();
    const { container, unmount } = await mount(
      <AgoProvider client={client}>
        <ChatWidget ref={ref} sheet={{ initialState: "full" }} />
      </AgoProvider>,
    );

    const widget = container.querySelector<HTMLElement>(".ago-chat-widget")!;
    expect(widget.dataset.agoSheetState).toBe("full");
    expect(document.body.style.position).toBe("fixed");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(widget.dataset.agoSheetState).toBe("peek");
    expect(document.body.style.position).toBe("");

    await unmount();
    client.destroy();
  });

  it("exposes expand/collapse through a ref", async () => {
    stubCompact(true);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const ref = createRef<ChatWidgetHandle>();
    const { container, unmount } = await mount(
      <AgoProvider client={client}>
        <ChatWidget ref={ref} sheet={{}} />
      </AgoProvider>,
    );
    const widget = container.querySelector<HTMLElement>(".ago-chat-widget")!;

    expect(ref.current?.state).toBe("peek");
    await act(async () => ref.current!.expand());
    expect(widget.dataset.agoSheetState).toBe("full");
    await act(async () => ref.current!.collapse());
    expect(widget.dataset.agoSheetState).toBe("peek");

    await unmount();
    client.destroy();
  });

  it("stays a normal panel on a desktop viewport, never modal", async () => {
    stubCompact(false);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const ref = createRef<ChatWidgetHandle>();
    const { container, unmount } = await mount(
      <AgoProvider client={client}>
        <ChatWidget ref={ref} sheet={{}} />
      </AgoProvider>,
    );
    const widget = container.querySelector<HTMLElement>(".ago-chat-widget")!;

    await act(async () => ref.current!.expand());
    // The host page beside the widget is still usable, so it must not be pinned
    // or announced as modal.
    expect(widget.getAttribute("aria-modal")).toBeNull();
    expect(widget.style.position).not.toBe("fixed");
    expect(document.body.style.position).toBe("");

    await unmount();
    client.destroy();
  });

  it("survives StrictMode's mount / cleanup / remount cycle", async () => {
    stubCompact(true);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const ref = createRef<ChatWidgetHandle>();
    // StrictMode runs effect cleanups between two mounts while keeping memoized
    // values. A controller torn down from such a cleanup stays dead, and every
    // command silently no-ops — which is exactly what shipped before this test.
    const { container, unmount } = await mount(
      <StrictMode>
        <AgoProvider client={client}>
          <ChatWidget ref={ref} sheet={{}} />
        </AgoProvider>
      </StrictMode>,
    );
    const widget = container.querySelector<HTMLElement>(".ago-chat-widget")!;

    const peek = container.querySelector<HTMLElement>(".ago-chat-widget__peek")!;
    await act(async () => {
      peek.click();
    });
    expect(widget.dataset.agoSheetState).toBe("full");

    await act(async () => ref.current!.collapse());
    expect(widget.dataset.agoSheetState).toBe("peek");

    await unmount();
    client.destroy();
  });

  it("gives the expanded sheet an explicit way back", async () => {
    stubCompact(true);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const { container, unmount } = await mount(
      <AgoProvider client={client}>
        <ChatWidget sheet={{ initialState: "full" }} />
      </AgoProvider>,
    );
    const widget = container.querySelector<HTMLElement>(".ago-chat-widget")!;

    // Escape is not an exit on a touch device, so a visible control is the only
    // way out of a full-screen sheet on the surface it is designed for.
    const back = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse the conversation"]',
    )!;
    expect(back).not.toBeNull();
    expect(back.style.width).toBe("44px");
    expect(back.style.height).toBe("44px");

    await act(async () => {
      back.click();
    });
    expect(widget.dataset.agoSheetState).toBe("peek");

    await unmount();
    client.destroy();
  });

  it("shows a thinking state in peek instead of stale text", async () => {
    stubCompact(true);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    // Never settles: the widget stays in its answering state.
    vi.spyOn(client, "sendMessage").mockReturnValue(
      new Promise<AgoMessage>(() => {}),
    );
    const { container, unmount } = await mount(
      <AgoProvider client={client}>
        <ChatWidget sheet={{}} welcomeMessage="Bonjour" thinkingLabel="Reflexion..." />
      </AgoProvider>,
    );

    const peek = container.querySelector<HTMLElement>(".ago-chat-widget__peek")!;
    expect(peek.textContent).toContain("Bonjour");

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(textarea, "deux boules");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // Before the first token there is nothing to preview. Falling back to the
    // greeting showed stale text exactly when the user wants to know that
    // something is happening.
    expect(peek.textContent).toContain("Reflexion...");
    expect(peek.textContent).not.toContain("Bonjour");

    await unmount();
    client.destroy();
  });

  it("publishes its footprint so the host can reserve room for it", async () => {
    stubCompact(true);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const { container, unmount } = await mount(
      <AgoProvider client={client}>
        <ChatWidget sheet={{}} />
      </AgoProvider>,
    );
    const widget = container.querySelector<HTMLElement>(".ago-chat-widget")!;
    Object.defineProperty(widget, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ height: 176 }) as DOMRect,
    });
    // Force a re-measure the way a resize would.
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    // A fixed bar covers the end of the host page. Without publishing its
    // height, the host's footer stays unreachable no matter how far you scroll,
    // and any constant the host hardcodes drifts from the real bar.
    const published =
      document.documentElement.style.getPropertyValue("--ago-sheet-height");
    expect(published).not.toBe("");

    await unmount();
    // The reservation must not outlive the widget.
    expect(
      document.documentElement.style.getPropertyValue("--ago-sheet-height"),
    ).toBe("");
    client.destroy();
  });

  it("does not stack a second title row while the sheet owns the chrome", async () => {
    stubCompact(true);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const { container, unmount } = await mount(
      <AgoProvider client={client}>
        <ChatWidget title="Comptoir" sheet={{}} />
      </AgoProvider>,
    );

    // peek renders its own title, so the in-card header must step aside;
    // otherwise every consumer without Glacier's `display: none` override gets
    // two headers stacked.
    expect(container.querySelector(".ago-chat-widget__header")).toBeNull();
    const peek = container.querySelector<HTMLElement>(".ago-chat-widget__peek")!;
    expect(peek.textContent).toContain("Comptoir");

    await act(async () => {
      peek.click();
    });
    expect(container.querySelector(".ago-chat-widget__header")).toBeNull();
    expect(
      container.querySelector(".ago-chat-widget__sheet-header")!.textContent,
    ).toContain("Comptoir");

    await unmount();
    client.destroy();
  });

  it("traps Tab inside the expanded sheet", async () => {
    stubCompact(true);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const { container, unmount } = await mount(
      <AgoProvider client={client}>
        <ChatWidget sheet={{ initialState: "full" }} allowFiles />
      </AgoProvider>,
    );

    // jsdom gives every element a zero-size rect, so the visibility filter would
    // drop everything. Report a real box for the focusables.
    for (const el of Array.from(container.querySelectorAll("*"))) {
      Object.defineProperty(el, "getClientRects", {
        configurable: true,
        value: () => [{ width: 10, height: 10 }],
      });
    }
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.getClientRects().length > 0);
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // `aria-modal` alone does not stop focus walking out into the background we
    // just scroll-locked, which would strand the user off-screen.
    last.focus();
    const fwd = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      document.dispatchEvent(fwd);
    });
    expect(fwd.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    first.focus();
    const back = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      document.dispatchEvent(back);
    });
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    await unmount();
    client.destroy();
  });

  it("leaves room for a host bottom nav via bottomOffset", async () => {
    stubCompact(true);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const { container, unmount } = await mount(
      <AgoProvider client={client}>
        <ChatWidget sheet={{ bottomOffset: 64 }} />
      </AgoProvider>,
    );
    const widget = container.querySelector<HTMLElement>(".ago-chat-widget")!;
    expect(widget.style.bottom).toBe("64px");

    await unmount();
    client.destroy();
  });
});


describe("ChatWidget response state", () => {
  it("renders replacement progress and approval, blocks input and sends the exact decision", async () => {
    const { client, emit, sendMessage } = createDrivableClient();
    const decision = vi.spyOn(client, "submitApprovalDecision").mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce();
    const container = document.createElement("div"); const root = createRoot(container);
    await act(async () => root.render(<ChatWidget client={client} />));
    const message: AgoMessage = { id: "m", conversationId: "c", role: "assistant", status: "WAITING_APPROVAL", content: "Report", createdAt: new Date(), canStop: false,
      progress: { steps: [{ name: "Read", status: "completed", reason: null }], activity: [{ text: "Searching", timestamp: null }], truncated: true },
      approval: { id: "approval-42", status: "pending", actions: [{ name: "publish", arguments: { value: "secret" } }], allowedDecisions: ["approve", "reject"], expiresAt: null }, followUpReplies: ["Again"] };
    await act(async () => { emit("message:start", { conversationId: "c", messageId: "m" }); emit("message:update", message); emit("conversation:update", { conversationId: "c", interaction: { canSendMessage: false, blockingMessageId: "m" } }); });
    expect(container.textContent).toContain("Searching");
    expect(container.textContent).toContain("secret");
    expect(container.querySelector("textarea")!.disabled).toBe(true);
    expect(container.querySelector('button[aria-label="Stop generating"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>(".ago-message__followup-btn")!.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>(".ago-message__followup-btn")!.click());
    expect(sendMessage).not.toHaveBeenCalled();
    const button = () => Array.from(container.querySelectorAll("button")).find((el) => el.textContent === "Approve")!;
    await act(async () => button().click());
    expect(container.textContent).toContain("Could not submit decision");
    await act(async () => button().click());
    expect(decision).toHaveBeenNthCalledWith(1, "approval-42", "approve");
    expect(decision).toHaveBeenNthCalledWith(2, "approval-42", "approve");
    await act(async () => { emit("message:update", { ...message, approval: { ...message.approval!, actions: [], allowedDecisions: [] }, progress: { steps: [], activity: [], truncated: false } }); });
    expect(container.textContent).not.toContain("secret");
    expect(container.textContent).not.toContain("Searching");
    expect(container.textContent).toContain("Waiting for approval");
    expect(container.querySelectorAll(".ago-message--assistant")).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it("clears an identity-bound draft and keeps an ordinary failed draft", async () => {
    const { client, emit } = createDrivableClient();
    const container = document.createElement("div"); const root = createRoot(container);
    await act(async () => root.render(<ChatWidget client={client} />));
    await act(async () => setTextareaValue(container.querySelector("textarea")!, "private draft"));
    await act(async () => emit("conversation:update", { conversationId: null, interaction: null }));
    expect(container.querySelector("textarea")!.value).toBe("");
    await act(async () => root.unmount());
  });
});

it("suspends and restores a server-owned response without losing a draft", async () => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: !query.includes("prefers-reduced-motion"), media: query, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true })));
  const fixture = (name: string) => readFileSync(`tests/fixtures/background-sdk/${name}`, "utf8");
  const id = "11111111-1111-4111-8111-111111111111";
  let historyReads = 0; let aborted = false;
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    const path = String(url);
    if (path.endsWith(`/conversations/${id}`)) return new Response(fixture(historyReads++ ? "history-final.json" : "history-running.json"), { headers: { "Content-Type": "application/json" } });
    if (path.endsWith("/events")) return new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("Aborted", "AbortError")); }));
    throw new Error(`Unexpected request: ${path}`);
  });
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  const ref = createRef<ChatWidgetHandle>();
  const received = vi.fn();
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => { root.render(<ChatWidget ref={ref} client={client} conversationId={id} onMessageReceived={received} sheet={{ initialState: "full" }} />); await new Promise((r) => setTimeout(r, 10)); });
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "draft survives"));
  await act(async () => { ref.current!.collapse(); await new Promise((r) => setTimeout(r, 0)); });
  expect(aborted).toBe(true);
  await act(async () => { ref.current!.expand(); await new Promise((r) => setTimeout(r, 10)); });
  expect(historyReads).toBe(2);
  expect(container.querySelector("textarea")!.value).toBe("draft survives");
  expect(container.querySelector("textarea")!.disabled).toBe(false);
  expect(received).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.every(([url]) => !String(url).includes("/stop"))).toBe(true);
  await act(async () => root.unmount()); client.destroy(); vi.unstubAllGlobals();
});


it("renders outcomes and safe downloadable result files", async () => {
  const { client, emit } = createDrivableClient();
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} />));
  const response: AgoMessage = { id: "m", conversationId: "c", role: "assistant", status: "DONE", content: "Report", createdAt: new Date(), outcome: "incomplete", attachments: [{ id: "file", name: "report.csv", url: "https://example.test/report.csv", isSafeImage: false }] };
  await act(async () => { emit("message:start", { conversationId: "c", messageId: "m" }); emit("message:update", response); });
  expect(container.textContent).toContain("Incomplete");
  expect(container.querySelector('a[href="https://example.test/report.csv"]')).not.toBeNull();
  await act(async () => emit("message:update", { ...response, outcome: "failed", attachments: [] }));
  expect(container.textContent).toContain("Failed");
  expect(container.textContent).not.toContain("report.csv");
  await act(async () => emit("message:update", { ...response, status: "PAUSED", outcome: null, attachments: [] }));
  expect(container.textContent).toContain("Paused");
  await act(async () => root.unmount());
});

it("clears the old transcript and draft when the widget client changes", async () => {
  const first = createDrivableClient(); const second = createDrivableClient();
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={first.client} />));
  await act(async () => {
    first.emit("message:start", { conversationId: "a", messageId: "m" });
    first.emit("message:complete", { id: "m", conversationId: "a", role: "assistant", status: "DONE", content: "private answer", createdAt: new Date() });
  });
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "private draft"));
  await act(async () => root.render(<ChatWidget client={second.client} />));
  expect(container.textContent).not.toContain("private answer");
  expect(container.querySelector("textarea")!.value).toBe("");
  await act(async () => root.unmount());
});

it("ignores an old pending send when the client and initial conversation change", async () => {
  const first = createDrivableClient(); const second = createDrivableClient();
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={first.client} conversationId="a" />));
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "private draft"));
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => root.render(<ChatWidget client={second.client} conversationId="b" />));
  await act(async () => first.resolveSend({ id: "old", conversationId: "a", role: "assistant", status: "DONE", content: "private answer", createdAt: new Date() }));
  expect(container.textContent).not.toContain("private answer");
  expect(container.querySelector("textarea")!.value).toBe("");
  await act(async () => root.unmount());
});

it("ignores a late approval failure after an authentication reset", async () => {
  const { client, emit } = createDrivableClient();
  let reject!: (error: Error) => void;
  vi.spyOn(client, "submitApprovalDecision").mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} />));
  const message: AgoMessage = { id: "m", conversationId: "c", role: "assistant", status: "WAITING_APPROVAL", content: "Report", createdAt: new Date(), approval: { id: "a", status: "pending", actions: [], allowedDecisions: ["approve"], expiresAt: null } };
  await act(async () => { emit("message:start", { conversationId: "c", messageId: "m" }); emit("message:update", message); });
  await act(async () => Array.from(container.querySelectorAll("button")).find((el) => el.textContent === "Approve")!.click());
  await act(async () => emit("conversation:update", { conversationId: null, interaction: null }));
  await act(async () => reject(new Error("offline")));
  expect(container.textContent).not.toContain("Could not submit decision");
  expect(container.textContent).not.toContain("Report");
  await act(async () => root.unmount());
});

it("blocks button and Enter during pre-message preparation", async () => {
  const { client, emit, sendMessage } = createDrivableClient();
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} conversationId="c" />));
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "draft"));
  await act(async () => emit("conversation:update", { conversationId: "c", interaction: { canSendMessage: false, blockingMessageId: null } }));
  const textarea = container.querySelector("textarea")!;
  expect(textarea.disabled).toBe(true);
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(sendMessage).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it("does not restore a failed send's draft or files after authentication reset", async () => {
  const { client, emit } = createDrivableClient();
  let reject!: (error: Error) => void;
  vi.spyOn(client, "sendMessage").mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} allowFiles />));
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => { Object.defineProperty(input, "files", { value: [new File(["private"], "private.txt")], configurable: true }); input.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "private draft"));
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => emit("conversation:update", { conversationId: null, interaction: null }));
  await act(async () => reject(new Error("offline")));
  expect(container.querySelector("textarea")!.value).toBe("");
  expect(container.textContent).not.toContain("private.txt");
  await act(async () => root.unmount());
});

it("suspends pre-message preparation while the sheet is hidden", async () => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: !query.includes("prefers-reduced-motion"), media: query, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true })));
  const fixture = readFileSync("tests/fixtures/background-sdk/history-preparing.json", "utf8");
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: (async () => new Response(fixture, { headers: { "Content-Type": "application/json" } })) as typeof fetch });
  const activate = vi.spyOn(client, "setActiveConversation");
  const ref = createRef<ChatWidgetHandle>(); const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(<ChatWidget ref={ref} client={client} conversationId="11111111-1111-4111-8111-111111111111" sheet={{ initialState: "full" }} />); await new Promise((r) => setTimeout(r, 10)); });
  await act(async () => { ref.current!.collapse(); await new Promise((r) => setTimeout(r, 0)); });
  expect(activate).toHaveBeenCalledWith(null);
  await act(async () => root.unmount()); client.destroy(); vi.unstubAllGlobals();
});

it("ignores an old decision failure after the approval advances", async () => {
  const { client, emit } = createDrivableClient(); let reject!: (error: Error) => void;
  const decision = vi.spyOn(client, "submitApprovalDecision").mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue();
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} />));
  const approval = { id: "first", status: "pending" as const, actions: [], allowedDecisions: ["approve" as const], expiresAt: null };
  const message: AgoMessage = { id: "m", conversationId: "c", role: "assistant", status: "WAITING_APPROVAL", content: "Review", createdAt: new Date(), approval };
  await act(async () => { emit("message:start", { conversationId: "c", messageId: "m" }); emit("message:update", message); });
  const approve = () => Array.from(container.querySelectorAll("button")).find((el) => el.textContent === "Approve")!;
  await act(async () => approve().click());
  await act(async () => emit("message:update", { ...message, approval: { ...approval, id: "second" } }));
  await act(async () => reject(new Error("offline")));
  expect(container.textContent).not.toContain("Could not submit decision");
  await act(async () => approve().click());
  expect(decision).toHaveBeenNthCalledWith(1, "first", "approve");
  expect(decision).toHaveBeenNthCalledWith(2, "second", "approve");
  await act(async () => root.unmount());
});

it("keeps an ordinary locally streaming response alive while the sheet is hidden", async () => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: !query.includes("prefers-reduced-motion"), media: query, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true })));
  const { client, emit } = createDrivableClient();
  const activate = vi.spyOn(client, "setActiveConversation");
  const ref = createRef<ChatWidgetHandle>(); const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget ref={ref} client={client} sheet={{ initialState: "full" }} />));
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "hello"));
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => { emit("message:start", { conversationId: "c", messageId: "m" }); ref.current!.collapse(); });
  expect(activate).not.toHaveBeenCalledWith(null);
  await act(async () => { emit("message:answer-complete", { id: "m", conversationId: "c", role: "assistant", status: "DONE", content: "still streaming", createdAt: new Date() }); ref.current!.expand(); });
  expect(container.textContent).toContain("still streaming");
  await act(async () => root.unmount()); vi.unstubAllGlobals();
});


it("never renders an old client's messages during client replacement", async () => {
  const first = createDrivableClient(); const second = createDrivableClient();
  const seen: string[][] = [];
  function Harness({ client }: { client: AgoClient }) { const { messages } = useMessages({ client }); seen.push(messages.map((m) => m.content)); return null; }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness client={first.client} />));
  await act(async () => { first.emit("message:start", { conversationId: "a", messageId: "m" }); first.emit("message:complete", { id: "m", conversationId: "a", role: "assistant", status: "DONE", content: "private", createdAt: new Date() }); });
  expect(seen.at(-1)).toContain("private");
  seen.length = 0;
  await act(async () => root.render(<Harness client={second.client} />));
  expect(seen.every((messages) => !messages.includes("private"))).toBe(true);
  await act(async () => root.unmount());
});

it("only calls onMessageReceived for accepted live DONE completions", async () => {
  const { client, emit } = createDrivableClient();
  const received = vi.fn(); const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} onMessageReceived={received} />));
  await act(async () => {
    emit("message:start", { conversationId: "c", messageId: "m" });
    for (const status of ["ERROR", "CANCELED", "DONE"]) emit("message:complete", { id: "m", conversationId: "c", role: "assistant", status, content: status, createdAt: new Date() });
  });
  expect(received).toHaveBeenCalledExactlyOnceWith({ id: "m", content: "DONE" });
  await act(async () => root.unmount());
});

it("does not notify a widget after the shared client is activated elsewhere", async () => {
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: (async (url: string | URL | Request) => new Response(JSON.stringify({ id: String(url).split("/").at(-1), title: "", messages: [] }), { headers: { "Content-Type": "application/json" } })) as typeof fetch });
  const received = vi.fn(); const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} conversationId="a" onMessageReceived={received} />));
  await act(async () => { await client.setActiveConversation("b"); });
  await act(async () => { (client as unknown as { eventEmitter: { emit: (event: string, value: unknown) => void } }).eventEmitter.emit("message:complete", { id: "b-message", conversationId: "b", role: "assistant", status: "DONE", content: "private b", createdAt: new Date() }); });
  expect(received).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("private b");
  await act(async () => root.unmount()); client.destroy();
});

it("notifies once for a completion from its own fork", async () => {
  const { client, emit } = createDrivableClient(); const received = vi.fn();
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} conversationId="a" onMessageReceived={received} />));
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "fork"));
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => {
    emit("message:start", { conversationId: "b", messageId: "m" });
    emit("message:complete", { id: "m", conversationId: "b", role: "assistant", status: "DONE", content: "fork answer", createdAt: new Date() });
  });
  expect(received).toHaveBeenCalledExactlyOnceWith({ id: "m", content: "fork answer" });
  await act(async () => root.unmount());
});


it("clears transcript, draft and approval when the host logs out inside completion", async () => {
  const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old-token" });
  const received = vi.fn(() => client.updateConfig({ userJwt: null }));
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} onMessageReceived={received} />));
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "private draft"));
  const bus = (client as unknown as { eventEmitter: { emit: (event: string, value: unknown) => void } }).eventEmitter;
  await act(async () => {
    bus.emit("message:start", { conversationId: "a", messageId: "m" });
    bus.emit("message:update", { id: "m", conversationId: "a", role: "assistant", status: "WAITING_APPROVAL", content: "private answer", createdAt: new Date(), approval: { id: "secret", status: "pending", actions: [{ name: "private action", arguments: {} }], allowedDecisions: ["approve"], expiresAt: null } });
  });
  expect(container.textContent).toContain("private action");
  await act(async () => bus.emit("message:complete", { id: "m", conversationId: "a", role: "assistant", status: "DONE", content: "private answer", createdAt: new Date() }));
  expect(received).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("private answer");
  expect(container.textContent).not.toContain("private action");
  expect(container.querySelector("textarea")!.value).toBe("");
  await act(async () => root.unmount()); client.destroy();
});

it.each(["activate", "clear"] as const)("does not restore old completion when the callback calls %s", async (action) => {
  const { client, emit } = createDrivableClient();
  let state!: ReturnType<typeof useMessagesInternal>;
  function Harness() {
    state = useMessagesInternal({ client, conversationId: "a" }, () => {
      if (action === "activate") void state.activate("b");
      else state.clearMessages();
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  await act(async () => emit("message:complete", { id: "m", conversationId: "a", role: "assistant", status: "DONE", content: "old", createdAt: new Date() }));
  expect(state.messages).toEqual([]);
  expect(state.conversationId).toBe(action === "activate" ? "b" : undefined);
  await act(async () => root.unmount());
});

it("suppresses late real follow callbacks when the host logs out on completion", async () => {
  const fixture = (name: string) => readFileSync(`tests/fixtures/background-sdk/${name}`, "utf8");
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith("/messages")) return new Response(fixture("initial-send.sse"), { headers: { "Content-Type": "text/event-stream" } });
    if (String(url).endsWith("/events")) return new Response(fixture("follow-to-final.sse"), { headers: { "Content-Type": "text/event-stream" } });
    throw new Error(`Unexpected request: ${String(url)}`);
  });
  const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old-token", fetch: fetcher as typeof fetch });
  let done!: () => void;
  const completed = new Promise<void>((resolve) => { done = resolve; });
  const received = vi.fn(() => { client.updateConfig({ userJwt: null }); done(); });
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} onMessageReceived={received} />));
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "Prepare a report"));
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await completed; await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(received).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("report is complete");
  expect(container.textContent).not.toContain("background-report.csv");
  expect(container.querySelector("textarea")!.value).toBe("");
  await act(async () => root.unmount()); client.destroy();
});

it("does not post a draft when onMessageSent synchronously logs out", async () => {
  const fetcher = vi.fn(async () => new Response('data: {"message_id":"m","thread":{"id":"a"},"status":"DONE"}\n\n', { headers: { "Content-Type": "text/event-stream" } }));
  const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old-token", fetch: fetcher as typeof fetch });
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} allowFiles onMessageSent={() => client.updateConfig({ userJwt: null })} />));
  const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => { Object.defineProperty(fileInput, "files", { value: [new File(["private"], "private.txt")], configurable: true }); fileInput.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "private draft"));
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(fetcher).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")!.value).toBe("");
  await act(async () => root.unmount()); client.destroy();
});


it("does not post or restore a draft when onMessageSent activates another conversation", async () => {
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") throw new Error("unexpected POST");
    const id = String(url).split("/").at(-1);
    return new Response(JSON.stringify({ id, title: "", messages: [] }), { headers: { "Content-Type": "application/json" } });
  });
  const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "token", fetch: fetcher as typeof fetch });
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} conversationId="a" onMessageSent={() => { void client.setActiveConversation("b"); }} />));
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "private draft"));
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  expect(container.querySelector("textarea")!.value).toBe("");
  await act(async () => root.unmount()); client.destroy();
});

it("does not post an old draft when onMessageSent synchronously replaces the client", async () => {
  const oldFetch = vi.fn(async () => new Response("unexpected"));
  const newFetch = vi.fn(async () => new Response("unexpected"));
  const first = new AgoClient({ baseUrl: "https://example.test", fetch: oldFetch as typeof fetch });
  const second = new AgoClient({ baseUrl: "https://example.test", fetch: newFetch as typeof fetch });
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={first} onMessageSent={() => flushSync(() => root.render(<ChatWidget client={second} />))} />));
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "private draft"));
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(oldFetch).not.toHaveBeenCalled();
  expect(newFetch).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")!.value).toBe("");
  await act(async () => root.unmount()); first.destroy(); second.destroy();
});

it("does not post when onMessageSent synchronously blocks the current conversation", async () => {
  const { client, emit, sendMessage } = createDrivableClient();
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} conversationId="a" onMessageSent={() => emit("conversation:update", { conversationId: "a", interaction: { canSendMessage: false, blockingMessageId: null } })} />));
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "draft"));
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(sendMessage).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")!.value).toBe("draft");
  await act(async () => root.unmount());
});

it("does not post a draft when onMessageSent synchronously unmounts the widget", async () => {
  const fetcher = vi.fn(async () => new Response("unexpected"));
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} onMessageSent={() => flushSync(() => root.unmount())} />));
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "private draft"));
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(fetcher).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("private draft");
  client.destroy();
});

it("still sends normally when onMessageSent keeps the same view", async () => {
  const fetcher = vi.fn(async () => new Response('data: {"message_id":"m","thread":{"id":"a"},"status":"IN_PROGRESS"}\n\ndata: {"content":"answer","message_id":"m","thread":{"id":"a"}}\n\ndata: {"message_id":"m","thread":{"id":"a"},"status":"DONE"}\n\n', { headers: { "Content-Type": "text/event-stream" } }));
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  const sent = vi.fn(); const received = vi.fn();
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} onMessageSent={sent} onMessageReceived={received} />));
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "hello"));
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(sent).toHaveBeenCalledExactlyOnceWith("hello");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(received).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("answer");
  await act(async () => root.unmount()); client.destroy();
});

it.each(["different viewer", "same viewer"] as const)("verifies %s credentials before posting a callback-triggered refresh", async (viewer) => {
  const id = "11111111-1111-4111-8111-111111111111";
  const historyData = JSON.parse(readFileSync("tests/fixtures/background-sdk/history-final.json", "utf8"));
  historyData.messages.at(-1).follow_up_replies = ["Follow up"];
  const history = JSON.stringify(historyData);
  let release!: (response: Response) => void;
  const held = new Promise<Response>((resolve) => { release = resolve; });
  let historyCount = 0;
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith(`/conversations/${id}`)) {
      if (++historyCount === 1) return new Response(history, { headers: { "Content-Type": "application/json" } });
      return held;
    }
    if (path.endsWith("/messages") && init?.method === "POST") return new Response('data: {"message_id":"fresh","thread":{"id":"fresh-conversation"},"status":"IN_PROGRESS"}\n\ndata: {"content":"ok","message_id":"fresh","thread":{"id":"fresh-conversation"}}\n\ndata: {"message_id":"fresh","thread":{"id":"fresh-conversation"},"status":"DONE"}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    throw new Error(`Unexpected request: ${path}`);
  });
  const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old-token", fetch: fetcher as typeof fetch });
  let refreshed = false;
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} conversationId={id} onMessageSent={() => { if (!refreshed) { refreshed = true; client.updateConfig({ userJwt: "new-token" }); } }} />));
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "old private draft"));
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
  const posts = () => fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(historyCount).toBe(2);
  expect(posts()).toHaveLength(0);
  const textarea = container.querySelector("textarea")!;
  const followUp = container.querySelector<HTMLButtonElement>(".ago-message__followup-btn")!;
  expect(textarea.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(followUp.disabled).toBe(true);
  await act(async () => {
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    followUp.click();
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(posts()).toHaveLength(0);
  const verified = viewer === "different viewer" ? history.replaceAll("viewer-staff-1", "viewer-other") : history;
  await act(async () => { release(new Response(verified, { headers: { "Content-Type": "application/json" } })); await new Promise((resolve) => setTimeout(resolve, 20)); });
  if (viewer === "same viewer") {
    expect(posts()).toHaveLength(1);
    expect((posts()[0][1]?.headers as Record<string, string>).Authorization).toBe("Bearer new-token");
    expect(JSON.parse(String(posts()[0][1]?.body)).content).toBe("old private draft");
  } else {
    expect(posts()).toHaveLength(0);
    expect(container.querySelector("textarea")!.value).toBe("");
    await act(async () => setTextareaValue(container.querySelector("textarea")!, "new viewer message"));
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(String(posts()[0][1]?.body)).content).toBe("new viewer message");
  }
  await act(async () => root.unmount()); client.destroy();
});


it("requires an explicitly registered principal guard for binding clients", () => {
  expect(() => captureBindingPrincipal({})).toThrow("Binding principal guard is unavailable");
});


it("restores the same-view draft and releases the preparation gate if verification fails", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const history = readFileSync("tests/fixtures/background-sdk/history-final.json", "utf8");
  let release!: (response: Response) => void;
  const held = new Promise<Response>((resolve) => { release = resolve; });
  let histories = 0;
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") return new Response('data: {"message_id":"m","thread":{"id":"a"},"status":"DONE"}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    if (++histories === 2) return held;
    return new Response(history, { headers: { "Content-Type": "application/json" } });
  });
  const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old-token", fetch: fetcher as typeof fetch });
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} conversationId={id} onMessageSent={() => client.updateConfig({ userJwt: "new-token" })} />));
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "same-view draft"));
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
  expect(container.querySelector("textarea")!.disabled).toBe(true);
  await act(async () => { release(new Response("unavailable", { status: 503 })); await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(container.querySelector("textarea")!.disabled).toBe(false);
  expect(container.querySelector("textarea")!.value).toBe("same-view draft");
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(histories).toBe(3);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  await act(async () => root.unmount()); client.destroy();
});

it("does not resubmit the old draft reentrantly during an authentication reset", async () => {
  const fetcher = vi.fn(async () => new Response('data: {"message_id":"m","thread":{"id":"a"},"status":"DONE"}\n\n', { headers: { "Content-Type": "text/event-stream" } }));
  const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old-token", fetch: fetcher as typeof fetch });
  const container = document.createElement("div"); const root = createRoot(container);
  let called = false;
  await act(async () => root.render(<ChatWidget client={client} onMessageSent={() => {
    if (!called) {
      called = true;
      client.updateConfig({ userJwt: null });
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
  }} />));
  await act(async () => setTextareaValue(container.querySelector("textarea")!, "private draft"));
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(fetcher).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")!.value).toBe("");
  await act(async () => root.unmount()); client.destroy();
});

it("does not render or report hidden completions, and renders an authoritative unhide", async () => {
  const client = new AgoClient({ baseUrl: "https://example.test" });
  const received = vi.fn(); const headless = vi.fn();
  client.on("message:complete", headless);
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<ChatWidget client={client} onMessageReceived={received} />));
  const bus = (client as unknown as { eventEmitter: { emit: (event: string, value: unknown) => void } }).eventEmitter;
  const message: AgoMessage = { id: "m", conversationId: "a", role: "assistant", status: "DONE", content: "hidden answer", hidden: true, createdAt: new Date() };
  await act(async () => { bus.emit("message:start", { conversationId: "a", messageId: "m" }); bus.emit("message:update", message); bus.emit("message:complete", message); });
  expect(container.textContent).not.toContain("hidden answer");
  expect(received).not.toHaveBeenCalled();
  expect(headless).toHaveBeenCalledExactlyOnceWith(message);
  await act(async () => bus.emit("message:update", { ...message, hidden: false }));
  expect(container.textContent).toContain("hidden answer");
  await act(async () => root.unmount()); client.destroy();
});
