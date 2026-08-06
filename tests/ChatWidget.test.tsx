import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../src/client/AgoClient";
import { AgoProvider } from "../src/react/context/AgoContext";
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
  const client = {
    on: (e: string, h: (data: unknown) => void) => {
      (handlers[e] ??= []).push(h);
    },
    off: (e: string, h: (data: unknown) => void) => {
      handlers[e] = (handlers[e] ?? []).filter((x) => x !== h);
    },
    sendMessage,
    stop,
    getMessages: vi.fn(async () => []),
  } as unknown as AgoClient;
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
