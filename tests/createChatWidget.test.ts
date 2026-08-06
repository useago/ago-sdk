import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { AgoMessage, Conversation } from "../src/client/types";
import type { CreateFormCollectorOptions } from "../src/forms/createFormCollector";
import type { StorageLike } from "../src/state/createStore";
import { createMockClient } from "../src/testing/createMockClient";
import { mountChatWidget } from "../src/widget/createChatWidget";

// The widget loads the conversation list on mount (refreshThreads → getConversations).
// Stub fetch so unmocked mounts return an empty list instead of hitting the network;
// tests that care about threads spy on client.getConversations directly.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ count: 0, items: [] }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A Map-backed StorageLike so tests never touch real Web Storage. */
function fakeStorage(): StorageLike & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key) => (raw.has(key) ? raw.get(key)! : null),
    setItem: (key, value) => {
      raw.set(key, value);
    },
  };
}

const orderForm: CreateFormCollectorOptions = {
  name: "order",
  description: "The order the user wants to place.",
  schema: {
    type: "object",
    properties: { product: { type: "string" }, quantity: { type: "number" } },
    required: ["product", "quantity"],
  },
};

function makeAssistantMessage(overrides: Partial<AgoMessage> = {}): AgoMessage {
  return {
    id: "assistant-1",
    conversationId: "conv-1",
    content: "Hi there!",
    role: "assistant",
    status: "DONE",
    createdAt: new Date(0),
    ...overrides,
  };
}

function makeConversation(
  id: string,
  messages: AgoMessage[] = [],
): Conversation {
  return { id, title: "Thread", lastMessageDate: new Date(0), messages };
}

describe("mountChatWidget", () => {
  it("renders into the target and shows the welcome message", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const root = document.createElement("div");
    document.body.appendChild(root);

    const widget = mountChatWidget(root, {
      client,
      title: "Helpdesk",
      welcomeMessage: "Welcome!",
    });

    expect(root.querySelector(".ago-chat-widget")).not.toBeNull();
    expect(root.textContent).toContain("Helpdesk");
    expect(root.textContent).toContain("Welcome!");

    widget.destroy();
    expect(root.querySelector(".ago-chat-widget")).toBeNull();
    root.remove();
    client.destroy();
  });

  it("renders the message input at >=16px so iOS Safari does not zoom on focus", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const root = document.createElement("div");
    document.body.appendChild(root);

    const widget = mountChatWidget(root, { client, title: "Helpdesk" });

    const textarea = root.querySelector("textarea");
    expect(textarea).not.toBeNull();
    // A focused field under 16px makes iOS zoom the whole page in, which causes
    // horizontal scrolling and pushes the Send button off-screen on mobile.
    expect(parseFloat(textarea!.style.fontSize)).toBeGreaterThanOrEqual(16);

    widget.destroy();
    root.remove();
    client.destroy();
  });

  it("installs form collectors on mount and removes them on destroy", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const root = document.createElement("div");
    document.body.appendChild(root);

    const widget = mountChatWidget(root, { client, forms: [orderForm] });
    expect(client.getRegisteredFunctions().map((s) => s.name)).toContain(
      "update_order",
    );

    widget.destroy();
    expect(client.getRegisteredFunctions()).toHaveLength(0);
    root.remove();
    client.destroy();
  });

  // Drives a form to completion through its registered update_ function, the way
  // the agent would, which auto-submits it (the default).
  async function completeOrderForm(client: AgoClient): Promise<void> {
    const registry = (
      client as unknown as {
        functionRegistry: {
          execute: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      }
    ).functionRegistry;
    await registry.execute("update_order", { product: "Widget", quantity: 2 });
  }

  it("shows a confirmation notice with the configured fallback text on submit", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const root = document.createElement("div");
    document.body.appendChild(root);

    // Response carries no `message`, so the fallback string is used.
    const handler = vi.fn(async () => ({ ok: true }));
    const widget = mountChatWidget(root, {
      client,
      formSubmittedMessage: "Votre demande a bien été envoyée.",
      forms: [{ ...orderForm, submit: { via: "client", handler } }],
    });

    expect(root.querySelector(".ago-form-notice")).toBeNull();
    await completeOrderForm(client);

    expect(handler).toHaveBeenCalledWith({ product: "Widget", quantity: 2 });
    const notice = root.querySelector(".ago-form-notice");
    expect(notice?.textContent).toContain("Votre demande a bien été envoyée.");

    widget.destroy();
    root.remove();
    client.destroy();
  });

  it("echoes the message returned by the submit response", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const root = document.createElement("div");
    document.body.appendChild(root);

    // The POST handler returns a server message — the notice should show it,
    // overriding the static fallback.
    const handler = vi.fn(async () => ({
      message: "Commande #1234 confirmée.",
    }));
    const widget = mountChatWidget(root, {
      client,
      formSubmittedMessage: "Form submitted.",
      forms: [{ ...orderForm, submit: { via: "client", handler } }],
    });

    await completeOrderForm(client);

    const notice = root.querySelector(".ago-form-notice");
    expect(notice?.textContent).toContain("Commande #1234 confirmée.");
    expect(notice?.textContent).not.toContain("Form submitted.");

    widget.destroy();
    root.remove();
    client.destroy();
  });

  it("forwards a successful submit to onFormSubmitted with the result", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const root = document.createElement("div");
    document.body.appendChild(root);

    const onFormSubmitted = vi.fn();
    const widget = mountChatWidget(root, {
      client,
      forms: [
        {
          ...orderForm,
          submit: { via: "client", handler: async () => ({ id: 42 }) },
        },
      ],
      onFormSubmitted,
    });

    await completeOrderForm(client);

    expect(onFormSubmitted).toHaveBeenCalledWith({
      name: "order",
      values: { product: "Widget", quantity: 2 },
      result: { id: 42 },
    });

    widget.destroy();
    root.remove();
    client.destroy();
  });

  it("forwards a failed submit to onFormError and shows no notice", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const root = document.createElement("div");
    document.body.appendChild(root);

    const onFormError = vi.fn();
    const widget = mountChatWidget(root, {
      client,
      forms: [
        {
          ...orderForm,
          submit: {
            via: "client",
            handler: async () => {
              throw new Error("boom");
            },
          },
        },
      ],
      onFormError,
    });

    await completeOrderForm(client);

    expect(onFormError).toHaveBeenCalledWith({
      name: "order",
      values: { product: "Widget", quantity: 2 },
      error: "boom",
    });
    // Failures fire the event only; the chat shows no notice.
    expect(root.querySelector(".ago-form-notice")).toBeNull();

    widget.destroy();
    root.remove();
    client.destroy();
  });

  it("renders clickable suggested replies that send the reply", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const sent: string[] = [];
    const sendSpy = vi
      .spyOn(client, "sendMessage")
      .mockImplementation(async (content: string) => {
        sent.push(content);
        // First turn returns follow-up suggestions; later turns return plain.
        return makeAssistantMessage({
          id: `assistant-${sent.length}`,
          followUpReplies:
            sent.length === 1 ? ["Pricing", "Book a demo"] : undefined,
        });
      });

    const root = document.createElement("div");
    document.body.appendChild(root);
    const widget = mountChatWidget(root, { client });

    await widget.sendMessage("hello");

    const buttons = root.querySelectorAll<HTMLButtonElement>(
      ".ago-message__followup-btn",
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0].disabled).toBe(false);

    buttons[1].click();
    // Let the async send settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(sent).toEqual(["hello", "Book a demo"]);

    sendSpy.mockRestore();
    widget.destroy();
    root.remove();
    client.destroy();
  });

  it("hides a previous turn's suggested replies once the user sends again", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const sent: string[] = [];
    vi.spyOn(client, "sendMessage").mockImplementation(
      async (content: string) => {
        sent.push(content);
        // Only the first turn returns follow-up suggestions.
        return makeAssistantMessage({
          id: `assistant-${sent.length}`,
          followUpReplies:
            sent.length === 1 ? ["Pricing", "Book a demo"] : undefined,
        });
      },
    );

    const root = document.createElement("div");
    document.body.appendChild(root);
    const widget = mountChatWidget(root, { client });

    await widget.sendMessage("hello");
    expect(root.querySelectorAll(".ago-message__followup-btn")).toHaveLength(2);

    // Second turn: the first reply is no longer the last message, so its
    // stale suggestions must disappear.
    await widget.sendMessage("tell me more");
    expect(root.querySelectorAll(".ago-message__followup-btn")).toHaveLength(0);

    widget.destroy();
    root.remove();
    client.destroy();
  });

  it("renders suggested replies as disabled when onFollowUpClick is false", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    vi.spyOn(client, "sendMessage").mockResolvedValue(
      makeAssistantMessage({ followUpReplies: ["A"] }),
    );

    const root = document.createElement("div");
    document.body.appendChild(root);
    const widget = mountChatWidget(root, { client, onFollowUpClick: false });

    await widget.sendMessage("hello");

    const button = root.querySelector<HTMLButtonElement>(
      ".ago-message__followup-btn",
    );
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);

    widget.destroy();
    root.remove();
    client.destroy();
  });

  describe("styling options", () => {
    it("renders the header by default and omits it with showHeader: false", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, { client, title: "Helpdesk" });
      expect(root.querySelector(".ago-chat-widget__header")).not.toBeNull();
      widget.destroy();

      const hidden = mountChatWidget(root, {
        client,
        title: "Helpdesk",
        showHeader: false,
      });
      expect(root.querySelector(".ago-chat-widget__header")).toBeNull();
      // The rest of the panel still renders.
      expect(root.querySelector(".ago-chat-widget__messages")).not.toBeNull();
      expect(root.querySelector("textarea")).not.toBeNull();

      hidden.destroy();
      root.remove();
      client.destroy();
    });

    it("renders assistant messages as plain text by default", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      vi.spyOn(client, "sendMessage").mockResolvedValue(makeAssistantMessage());
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, { client });
      await widget.sendMessage("hi");

      const bubble = root.querySelector<HTMLElement>(
        ".ago-message--assistant .ago-message__content",
      );
      expect(bubble).not.toBeNull();
      expect(bubble!.style.padding).toBe("2px 8px");
      expect(bubble!.style.backgroundColor).toBe("transparent");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("wraps assistant messages in a filled bubble with agentBubble: true", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      vi.spyOn(client, "sendMessage").mockResolvedValue(makeAssistantMessage());
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, { client, agentBubble: true });
      await widget.sendMessage("hi");

      const bubble = root.querySelector<HTMLElement>(
        ".ago-message--assistant .ago-message__content",
      );
      expect(bubble).not.toBeNull();
      expect(bubble!.style.padding).toBe("10px 14px");
      expect(bubble!.style.backgroundColor).not.toBe("transparent");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("bubbles both sides with a tail corner for bubbleStyle: 'imessage'", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      vi.spyOn(client, "sendMessage").mockResolvedValue(makeAssistantMessage());
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, { client, bubbleStyle: "imessage" });
      await widget.sendMessage("hi");

      // Assistant message: filled bubble with the tail bulge on the bottom-left
      // (a `.ago-message__tail` overlay positioned to the left of the bubble).
      const assistant = root.querySelector<HTMLElement>(
        ".ago-message--assistant .ago-message__content",
      );
      expect(assistant).not.toBeNull();
      expect(assistant!.style.padding).toBe("10px 14px");
      expect(assistant!.style.backgroundColor).not.toBe("transparent");
      const assistantTail =
        assistant!.querySelector<HTMLElement>(".ago-message__tail");
      expect(assistantTail).not.toBeNull();
      expect(assistantTail!.style.left).not.toBe("");
      expect(assistantTail!.style.right).toBe("");
      expect(assistantTail!.style.borderBottomRightRadius).not.toBe("");

      // User message: tail bulge on the bottom-right.
      const user = root.querySelector<HTMLElement>(
        ".ago-message--user .ago-message__content",
      );
      expect(user).not.toBeNull();
      const userTail = user!.querySelector<HTMLElement>(".ago-message__tail");
      expect(userTail).not.toBeNull();
      expect(userTail!.style.right).not.toBe("");
      expect(userTail!.style.left).toBe("");
      expect(userTail!.style.borderBottomLeftRadius).not.toBe("");

      widget.destroy();
      root.remove();
      client.destroy();
    });
  });

  describe("placement (side panel)", () => {
    it("renders a fixed side wrapper + launcher, closed by default", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, { client, placement: "left" });

      const wrapper = root.querySelector<HTMLElement>(".ago-chat-widget-panel");
      const launcher = root.querySelector<HTMLElement>(
        ".ago-chat-widget-launcher",
      );
      expect(wrapper).not.toBeNull();
      expect(launcher).not.toBeNull();
      // The panel still lives inside the wrapper.
      expect(wrapper!.querySelector(".ago-chat-widget")).not.toBeNull();
      // Pinned to the left edge, full-height, and slid off-screen while closed.
      expect(wrapper!.style.position).toBe("fixed");
      expect(wrapper!.style.left).toBe("0px");
      expect(wrapper!.style.transform).toBe("translateX(-100%)");
      expect(wrapper!.getAttribute("aria-hidden")).toBe("true");
      // The handle exposes open/close/toggle for side placements.
      expect(typeof widget.open).toBe("function");

      widget.destroy();
      expect(root.querySelector(".ago-chat-widget-panel")).toBeNull();
      expect(root.querySelector(".ago-chat-widget-launcher")).toBeNull();
      root.remove();
      client.destroy();
    });

    it("opens and closes the panel (launcher hides while open)", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, { client, placement: "right" });
      const wrapper = root.querySelector<HTMLElement>(
        ".ago-chat-widget-panel",
      )!;
      const launcher = root.querySelector<HTMLElement>(
        ".ago-chat-widget-launcher",
      )!;

      // Right edge → slides off to the right while closed.
      expect(wrapper.style.right).toBe("0px");
      expect(wrapper.style.transform).toBe("translateX(100%)");

      widget.open!();
      expect(wrapper.style.transform).toBe("translateX(0)");
      expect(wrapper.getAttribute("aria-hidden")).toBe("false");
      expect(launcher.style.display).toBe("none");

      widget.close!();
      expect(wrapper.style.transform).toBe("translateX(100%)");
      expect(launcher.style.display).toBe("flex");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("starts open with defaultOpen and can omit the launcher", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, {
        client,
        placement: "left",
        defaultOpen: true,
        launcher: false,
      });
      const wrapper = root.querySelector<HTMLElement>(
        ".ago-chat-widget-panel",
      )!;

      expect(wrapper.style.transform).toBe("translateX(0)");
      expect(root.querySelector(".ago-chat-widget-launcher")).toBeNull();

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("inline placement (default) exposes no open/close controls", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, { client });

      expect(root.querySelector(".ago-chat-widget-panel")).toBeNull();
      expect(root.querySelector(".ago-chat-widget-launcher")).toBeNull();
      expect(widget.open).toBeUndefined();

      widget.destroy();
      root.remove();
      client.destroy();
    });
  });

  describe("mobile fullscreen", () => {
    // jsdom has no matchMedia; stub it with a controllable `matches`. The
    // prefers-reduced-motion query always reports false. (startViewTransition is
    // also absent, so the morph exercises the instant-swap fallback path.)
    function stubMatchMedia(state: { mobile: boolean }) {
      const listeners = new Map<
        string,
        Set<(e: { matches: boolean }) => void>
      >();
      vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => {
          const isReduce = query.includes("prefers-reduced-motion");
          const set = listeners.get(query) ?? new Set();
          listeners.set(query, set);
          return {
            get matches() {
              return isReduce ? false : state.mobile;
            },
            media: query,
            addEventListener: (
              _: string,
              cb: (e: { matches: boolean }) => void,
            ) => set.add(cb),
            removeEventListener: (
              _: string,
              cb: (e: { matches: boolean }) => void,
            ) => set.delete(cb),
            dispatchEvent: () => true,
          };
        }),
      );
      return {
        /**
         * Flip the compact-layout query and notify its listeners. The widget
         * owns the exact media string (it is not just a width query — it also
         * covers short landscape viewports), so target "every query that isn't
         * the reduced-motion one" instead of hardcoding it here.
         */
        fire(matches: boolean) {
          state.mobile = matches;
          for (const [query, set] of listeners) {
            if (query.includes("prefers-reduced-motion")) continue;
            for (const cb of set) cb({ matches });
          }
        },
        /** The media string the widget actually registered for compact layout. */
        compactQuery(): string {
          for (const query of listeners.keys()) {
            if (!query.includes("prefers-reduced-motion")) return query;
          }
          return "";
        },
      };
    }

    it("inline (in a browser) exposes open/close/toggle automatically", () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, {
        client,
      });

      expect(typeof widget.open).toBe("function");
      expect(typeof widget.close).toBe("function");
      expect(typeof widget.toggle).toBe("function");
      expect(root.querySelector(".ago-chat-widget-panel")).toBeNull();
      expect(root.querySelector(".ago-chat-widget-launcher")).toBeNull();

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("open() expands the inline card to a full-screen dialog; close() reverts", () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, {
        client,
      });
      const container = root.querySelector<HTMLElement>(".ago-chat-widget")!;

      widget.open!();
      expect(container.style.position).toBe("fixed");
      expect(container.getAttribute("role")).toBe("dialog");
      expect(container.getAttribute("aria-modal")).toBe("true");
      expect(document.documentElement.style.overflow).toBe("hidden");
      // The fixed-body method is what actually stops iOS touch scrolling: the
      // body is pinned so the background cannot scroll underneath the sheet.
      expect(document.body.style.position).toBe("fixed");
      expect(document.body.style.width).toBe("100%");
      // The slim bar shows and the slot is reserved so the page doesn't jump.
      const bar = document.querySelector<HTMLElement>(
        ".ago-chat-widget-mobile-bar",
      )!;
      expect(bar.style.display).toBe("flex");
      expect(root.querySelector(".ago-chat-widget-spacer")).not.toBeNull();

      widget.close!();
      expect(container.style.position).toBe("");
      expect(container.getAttribute("role")).toBeNull();
      expect(container.getAttribute("aria-modal")).toBeNull();
      expect(document.documentElement.style.overflow).toBe("");
      // The body pin is released so the page scrolls normally again.
      expect(document.body.style.position).toBe("");
      expect(document.body.style.width).toBe("");
      expect(bar.style.display).toBe("none");
      expect(root.querySelector(".ago-chat-widget-spacer")).toBeNull();

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("pushes the sheet up (without resizing) when the keyboard opens", async () => {
      stubMatchMedia({ mobile: true });
      // Stub a controllable visualViewport (jsdom has none). It starts at the full
      // height, then shrinks and offsets as if the on-screen keyboard opened.
      const vvListeners = new Map<string, Set<() => void>>();
      const vv = {
        height: 800,
        offsetTop: 0,
        addEventListener: (type: string, cb: () => void) => {
          const set = vvListeners.get(type) ?? new Set();
          set.add(cb);
          vvListeners.set(type, set);
        },
        removeEventListener: (type: string, cb: () => void) => {
          vvListeners.get(type)?.delete(cb);
        },
      };
      vi.stubGlobal("visualViewport", vv);
      const fireVv = (type: string) => {
        for (const cb of vvListeners.get(type) ?? []) cb();
      };

      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, { client });
      const container = root.querySelector<HTMLElement>(".ago-chat-widget")!;
      const bar = document.querySelector<HTMLElement>(
        ".ago-chat-widget-mobile-bar",
      )!;

      widget.open!();
      // The sheet captures the full height and sits flush at the top.
      expect(container.style.getPropertyValue("--ago-vh")).toBe("800px");
      expect(container.style.top).toBe("0px");

      // Keyboard opens: viewport shrinks (800 -> 500) and scrolls down (40). The
      // resize + scroll burst is coalesced into one rAF, so flush a frame.
      vv.height = 500;
      vv.offsetTop = 40;
      fireVv("resize");
      fireVv("scroll");
      await new Promise((r) => requestAnimationFrame(r));
      // Height is unchanged (no resize); the sheet is pushed up by the keyboard
      // overlap: 40 + 500 - 800 = -260.
      expect(container.style.getPropertyValue("--ago-vh")).toBe("800px");
      expect(container.style.top).toBe("-260px");
      expect(bar.style.top).toBe("40px");

      widget.close!();
      // Listeners are dropped on collapse, so later viewport changes are ignored.
      vv.height = 700;
      vv.offsetTop = 10;
      fireVv("resize");
      expect(container.style.top).toBe("");

      widget.destroy();
      root.remove();
      client.destroy();
      vi.unstubAllGlobals();
    });

    it("open() is a no-op on a desktop viewport", () => {
      stubMatchMedia({ mobile: false });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, {
        client,
      });
      const container = root.querySelector<HTMLElement>(".ago-chat-widget")!;

      widget.open!();
      expect(container.style.position).not.toBe("fixed");
      expect(container.getAttribute("role")).toBeNull();
      expect(document.documentElement.style.overflow).toBe("");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("open() is a no-op when the card already fills the viewport", () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, {
        client,
      });
      const container = root.querySelector<HTMLElement>(".ago-chat-widget")!;
      // A full-bleed card (≈full viewport height) is already "fullscreen", so
      // the morph is skipped: nothing to promote. Height well above any viewport.
      container.getBoundingClientRect = () =>
        ({ width: 390, height: 100000 }) as DOMRect;

      widget.open!();
      expect(container.style.position).not.toBe("fixed");
      expect(container.getAttribute("role")).toBeNull();
      expect(root.querySelector(".ago-chat-widget-spacer")).toBeNull();

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("fires onOpen / onClose on inline expand and collapse", () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);
      const onOpen = vi.fn();
      const onClose = vi.fn();

      const widget = mountChatWidget(root, {
        client,
        onOpen,
        onClose,
      });

      widget.open!();
      expect(onOpen).toHaveBeenCalledTimes(1);
      widget.close!();
      expect(onClose).toHaveBeenCalledTimes(1);

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("fires onOpen / onClose on side-panel open and close", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);
      const onOpen = vi.fn();
      const onClose = vi.fn();

      const widget = mountChatWidget(root, {
        client,
        placement: "right",
        onOpen,
        onClose,
      });

      widget.open!();
      expect(onOpen).toHaveBeenCalledTimes(1);
      widget.close!();
      expect(onClose).toHaveBeenCalledTimes(1);

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("destroy() removes the bar, the per-instance style, the spacer, and the scroll lock", () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, {
        client,
      });
      widget.open!();

      const bar = document.querySelector(".ago-chat-widget-mobile-bar");
      const vtStyle = document.querySelector('style[id^="ago-vt-"]');
      const spacer = root.querySelector(".ago-chat-widget-spacer");
      expect(bar).not.toBeNull();
      expect(vtStyle).not.toBeNull();
      expect(spacer).not.toBeNull();

      widget.destroy();
      expect(bar!.isConnected).toBe(false);
      expect(vtStyle!.isConnected).toBe(false);
      expect(spacer!.isConnected).toBe(false);
      expect(document.documentElement.style.overflow).toBe("");

      root.remove();
      client.destroy();
    });

    it("mobile bar shows the logo when logoUrl is set", () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, {
        client,
        logoUrl: "https://example.test/logo.svg",
      });
      const bar = document.querySelector<HTMLElement>(
        ".ago-chat-widget-mobile-bar",
      )!;
      const img = bar.querySelector("img");
      expect(img).not.toBeNull();
      expect(img!.getAttribute("src")).toBe("https://example.test/logo.svg");
      expect(bar.querySelector("span")).toBeNull();

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("mobile bar falls back to the title text when no logoUrl", () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, {
        client,
        title: "CreditProx",
      });
      const bar = document.querySelector<HTMLElement>(
        ".ago-chat-widget-mobile-bar",
      )!;
      expect(bar.querySelector("img")).toBeNull();
      expect(bar.querySelector("span")?.textContent).toBe("CreditProx");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("mobile bar shows no branding when title is empty and no logoUrl", () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, {
        client,
        title: "",
      });
      const bar = document.querySelector<HTMLElement>(
        ".ago-chat-widget-mobile-bar",
      )!;
      expect(bar.querySelector("img")).toBeNull();
      expect(bar.querySelector("span")).toBeNull();

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("keeps the close button inside the aria-modal dialog", () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, { client });
      const container = root.querySelector<HTMLElement>(".ago-chat-widget")!;
      widget.open!();

      // The bar (and its close button) must be a descendant of the dialog, or
      // assistive tech would ignore it under aria-modal.
      expect(container.getAttribute("aria-modal")).toBe("true");
      const bar = container.querySelector(".ago-chat-widget-mobile-bar");
      expect(bar).not.toBeNull();
      expect(container.contains(bar)).toBe(true);
      expect(bar!.querySelector('button[aria-label="Close"]')).not.toBeNull();

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("traps Tab focus within the expanded sheet", () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, { client });
      const container = root.querySelector<HTMLElement>(".ago-chat-widget")!;
      widget.open!();

      // jsdom does no layout, so fake visibility for the getClientRects filter.
      const origGCR = Element.prototype.getClientRects;
      Element.prototype.getClientRects = () =>
        [{} as DOMRect] as unknown as DOMRectList;
      try {
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(
            'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
          ),
        );
        expect(focusables.length).toBeGreaterThan(1);
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        // Tab on the last focusable wraps to the first.
        last.focus();
        const fwd = new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(fwd);
        expect(fwd.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);

        // Shift+Tab on the first wraps to the last.
        first.focus();
        const back = new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(back);
        expect(back.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(last);
      } finally {
        Element.prototype.getClientRects = origGCR;
      }

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("hides the in-card header while full-screen and restores it on collapse", () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, {
        client,
        showHeader: true,
      });
      const header = root.querySelector<HTMLElement>(
        ".ago-chat-widget__header",
      )!;
      expect(header.style.display).toBe("flex");

      widget.open!();
      expect(header.style.display).toBe("none");

      widget.close!();
      expect(header.style.display).toBe("flex");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("tapping a suggested reply on mobile opens fullscreen, then sends it", async () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const sent: string[] = [];
      vi.spyOn(client, "sendMessage").mockImplementation(
        async (content: string) => {
          sent.push(content);
          return makeAssistantMessage({
            id: `assistant-${sent.length}`,
            followUpReplies: sent.length === 1 ? ["Pricing"] : undefined,
          });
        },
      );

      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client });
      const container = root.querySelector<HTMLElement>(".ago-chat-widget")!;

      await widget.sendMessage("hello");
      const button = root.querySelector<HTMLButtonElement>(
        ".ago-message__followup-btn",
      )!;
      expect(button).not.toBeNull();

      // Focusing the pill must NOT expand the card: that morph would flip it to
      // position:fixed mid-tap and eat the click (the original bug). Only the
      // click should drive the morph.
      button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(container.style.position).not.toBe("fixed");

      // The click expands to the fullscreen sheet first, then sends just after, so
      // the reply and its answer land in the full view.
      button.click();
      expect(container.style.position).toBe("fixed");
      await Promise.resolve();
      await Promise.resolve();
      expect(sent).toEqual(["hello", "Pricing"]);

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it('defaults to trigger "tap": expands when the card body is tapped, not just the input', async () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      vi.spyOn(client, "sendMessage").mockResolvedValue(
        makeAssistantMessage({ id: "a1" }),
      );
      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client });
      const container = root.querySelector<HTMLElement>(".ago-chat-widget")!;

      await widget.sendMessage("hi");
      const bubble = root.querySelector<HTMLElement>(".ago-message__content")!;
      expect(container.style.position).not.toBe("fixed");

      // Tapping a plain message bubble (not the input) morphs to full screen.
      bubble.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      expect(container.style.position).toBe("fixed");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it('default trigger "tap" leaves follow-up reply taps to expand-then-send (pointerdown does not eat the click)', async () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const sent: string[] = [];
      vi.spyOn(client, "sendMessage").mockImplementation(
        async (content: string) => {
          sent.push(content);
          return makeAssistantMessage({
            id: `assistant-${sent.length}`,
            followUpReplies: sent.length === 1 ? ["Pricing"] : undefined,
          });
        },
      );
      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client });
      const container = root.querySelector<HTMLElement>(".ago-chat-widget")!;

      await widget.sendMessage("hello");
      const button = root.querySelector<HTMLButtonElement>(
        ".ago-message__followup-btn",
      )!;

      // pointerdown on the pill must NOT expand: the morph would flip the card to
      // position:fixed mid-tap and eat the click, so the reply would open the
      // sheet without sending. The pill's own click handler owns the morph.
      button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      expect(container.style.position).not.toBe("fixed");

      button.click();
      expect(container.style.position).toBe("fixed");
      await Promise.resolve();
      await Promise.resolve();
      expect(sent).toEqual(["hello", "Pricing"]);

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it('mobile.trigger "focus" opts out: tapping the card body does not expand', async () => {
      stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      vi.spyOn(client, "sendMessage").mockResolvedValue(
        makeAssistantMessage({ id: "a1" }),
      );
      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, {
        client,
        mobile: { trigger: "focus" },
      });
      const container = root.querySelector<HTMLElement>(".ago-chat-widget")!;

      await widget.sendMessage("hi");
      const bubble = root.querySelector<HTMLElement>(".ago-message__content")!;

      // With trigger "focus" only the input opens the sheet, not the body.
      bubble.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      expect(container.style.position).not.toBe("fixed");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("widens message bubbles on a mobile viewport", async () => {
      const mq = stubMatchMedia({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      vi.spyOn(client, "sendMessage").mockResolvedValue(
        makeAssistantMessage({ id: "a1" }),
      );

      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client });

      await widget.sendMessage("hi");
      const bubble = () =>
        root.querySelector<HTMLElement>(
          ".ago-message--user .ago-message__content",
        )!;
      // User bubble is 75% on desktop; mobile reclaims the edge.
      expect(bubble().style.maxWidth).toBe("88%");

      // Crossing back to desktop reflows the thread to the narrower width.
      mq.fire(false);
      expect(bubble().style.maxWidth).toBe("75%");

      widget.destroy();
      root.remove();
      client.destroy();
    });
  });

  describe("streaming render + follow-the-bottom", () => {
    /** Give the pane real geometry: jsdom reports 0 for every scroll metric. */
    function sizePane(
      pane: HTMLElement,
      { scrollHeight = 600, clientHeight = 200 } = {},
    ) {
      Object.defineProperty(pane, "scrollHeight", {
        configurable: true,
        get: () => scrollHeight,
      });
      Object.defineProperty(pane, "clientHeight", {
        configurable: true,
        get: () => clientHeight,
      });
    }

    it("a streamed chunk swaps only the streaming bubble, not the whole thread", () => {
      const mock = createMockClient({
        overrides: { sendMessage: () => new Promise<AgoMessage>(() => {}) },
      });
      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client: mock });
      void widget.sendMessage("hello");

      const pane = root.querySelector<HTMLElement>(".ago-chat-widget__messages")!;
      const userNodeBefore = pane.querySelector(".ago-message--user");

      mock.__emitEvent("message:chunk", {
        content: "Par",
        conversationId: "c1",
        messageId: "m1",
      });
      mock.__emitEvent("message:chunk", {
        content: "tial",
        conversationId: "c1",
        messageId: "m1",
      });

      // Rebuilding the pane per token is what made a screen reader re-read the
      // whole conversation on every chunk, and what collapsed scrollHeight so a
      // stick-to-bottom check latched off. The user's bubble must survive
      // untouched across chunks.
      expect(pane.querySelector(".ago-message--user")).toBe(userNodeBefore);
      expect(pane.textContent).toContain("Partial");

      widget.destroy();
      root.remove();
      mock.destroy();
    });

    it("marks the log aria-busy while the answer is being written", () => {
      const mock = createMockClient({
        overrides: { sendMessage: () => new Promise<AgoMessage>(() => {}) },
      });
      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client: mock });
      const pane = root.querySelector<HTMLElement>(".ago-chat-widget__messages")!;

      expect(pane.getAttribute("aria-busy")).toBe("false");
      void widget.sendMessage("hello");
      // Announcements are deferred while streaming; the finished answer is
      // announced once, when aria-busy clears.
      expect(pane.getAttribute("aria-busy")).toBe("true");

      widget.destroy();
      root.remove();
      mock.destroy();
    });

    it("stops following the stream once the reader scrolls up, and offers a way back", async () => {
      const mock = createMockClient({
        overrides: { sendMessage: () => new Promise<AgoMessage>(() => {}) },
      });
      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client: mock });
      const pane = root.querySelector<HTMLElement>(".ago-chat-widget__messages")!;
      const jump = root.querySelector<HTMLElement>(".ago-chat-widget__jump")!;
      sizePane(pane);

      void widget.sendMessage("hello");
      expect(jump.style.display).toBe("none");
      // Scroll events a render itself provoked are ignored (that is what kept
      // the pane from latching itself detached on the first token). A real
      // gesture arrives in a later task, so let the current one drain.
      await Promise.resolve();

      // The reader scrolls up to re-read something (600 - 100 - 200 = 300 > 48).
      pane.scrollTop = 100;
      pane.dispatchEvent(new Event("scroll"));
      expect(jump.style.display).toBe("flex");

      // New tokens must NOT yank them back down.
      mock.__emitEvent("message:chunk", {
        content: "more text",
        conversationId: "c1",
        messageId: "m1",
      });
      expect(pane.scrollTop).toBe(100);

      // The jump button re-attaches.
      jump.click();
      expect(pane.scrollTop).toBe(600);
      expect(jump.style.display).toBe("none");

      widget.destroy();
      root.remove();
      mock.destroy();
    });

    it("sending re-attaches the pane even if the reader had scrolled away", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      vi.spyOn(client, "sendMessage").mockResolvedValue(
        makeAssistantMessage({ id: "a1" }),
      );
      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client });
      const pane = root.querySelector<HTMLElement>(".ago-chat-widget__messages")!;
      sizePane(pane);

      pane.scrollTop = 0;
      pane.dispatchEvent(new Event("scroll"));

      await widget.sendMessage("hi");
      // Sending is an explicit "show me the latest" gesture.
      expect(pane.scrollTop).toBe(600);

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("puts the user's text back in the composer when the send fails", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      vi.spyOn(client, "sendMessage").mockRejectedValue(new Error("offline"));
      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client });
      const textarea = root.querySelector<HTMLTextAreaElement>("textarea")!;

      await widget.sendMessage("deux boules pistache");

      // The composer is cleared on submit and the optimistic bubble is dropped
      // on failure, so without restoring the draft the message is gone for good.
      expect(textarea.value).toBe("deux boules pistache");
      expect(root.textContent).toContain("offline");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("does not clobber freshly typed text when restoring a failed draft", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      let reject: (e: Error) => void = () => {};
      vi.spyOn(client, "sendMessage").mockReturnValue(
        new Promise<AgoMessage>((_, r) => {
          reject = r;
        }),
      );
      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client });
      const textarea = root.querySelector<HTMLTextAreaElement>("textarea")!;

      const pending = widget.sendMessage("first");
      textarea.value = "something new";
      reject(new Error("offline"));
      await pending;

      expect(textarea.value).toBe("something new");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("gives every tap target at least 44px", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      vi.spyOn(client, "sendMessage").mockResolvedValue(
        makeAssistantMessage({ id: "a1", followUpReplies: ["Pricing"] }),
      );
      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client, allowFiles: true });

      await widget.sendMessage("hi");

      const send = root.querySelector<HTMLElement>('button[type="submit"]')!;
      expect(send.style.width).toBe("44px");
      expect(send.style.height).toBe("44px");

      const attach = root.querySelector<HTMLElement>(
        'button[aria-label="Attach file"]',
      )!;
      expect(attach.style.minWidth).toBe("44px");
      expect(attach.style.minHeight).toBe("44px");

      const pill = root.querySelector<HTMLElement>(".ago-message__followup-btn")!;
      expect(pill.style.minHeight).toBe("44px");

      widget.destroy();
      root.remove();
      client.destroy();
    });
  });

  describe("compact side panel + host-safe scroll lock", () => {
    /** Same shape as the mobile-fullscreen stub, scoped to this block. */
    function stubCompact(state: { mobile: boolean }) {
      const listeners = new Map<string, Set<(e: { matches: boolean }) => void>>();
      vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => {
          const isReduce = query.includes("prefers-reduced-motion");
          const set = listeners.get(query) ?? new Set();
          listeners.set(query, set);
          return {
            get matches() {
              return isReduce ? false : state.mobile;
            },
            media: query,
            addEventListener: (
              _: string,
              cb: (e: { matches: boolean }) => void,
            ) => set.add(cb),
            removeEventListener: (
              _: string,
              cb: (e: { matches: boolean }) => void,
            ) => set.delete(cb),
            dispatchEvent: () => true,
          };
        }),
      );
      return {
        compactQuery(): string {
          for (const query of listeners.keys()) {
            if (!query.includes("prefers-reduced-motion")) return query;
          }
          return "";
        },
      };
    }

    function mountSide(client: AgoClient) {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client, placement: "right" });
      const wrapper = root.querySelector<HTMLElement>(
        ".ago-chat-widget-panel",
      )!;
      const container = root.querySelector<HTMLElement>(".ago-chat-widget")!;
      return { root, widget, wrapper, container };
    }

    afterEach(() => {
      vi.unstubAllGlobals();
      document.body.removeAttribute("style");
      document.documentElement.removeAttribute("style");
    });

    it("compact layout also covers a short landscape viewport, not just narrow width", () => {
      const mq = stubCompact({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const { root, widget } = mountSide(client);

      // A phone in landscape is 844x390: a width-only query stops matching and
      // would switch the compact layout off on the viewport that needs it most.
      const query = mq.compactQuery();
      expect(query).toContain("max-width");
      expect(query).toContain("max-height");
      expect(query).toContain("orientation: landscape");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("restores the host's own inline body styles rather than deleting them", () => {
      stubCompact({ mobile: true });
      // The host pinned its own body (e.g. for its own modal) before we locked.
      document.body.style.position = "relative";
      document.body.style.top = "5px";
      document.documentElement.style.overflow = "auto";

      const client = new AgoClient({ baseUrl: "https://example.test" });
      const { root, widget } = mountSide(client);

      widget.open!();
      expect(document.body.style.position).toBe("fixed");

      widget.close!();
      // Deleting these (the old behavior) would silently break the host page.
      expect(document.body.style.position).toBe("relative");
      expect(document.body.style.top).toBe("5px");
      expect(document.documentElement.style.overflow).toBe("auto");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("the lock is per-owner: one widget cannot release another's", () => {
      stubCompact({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const a = mountSide(client);
      const b = mountSide(client);

      a.widget.open!();
      b.widget.open!();
      expect(document.body.style.position).toBe("fixed");

      // A leaves entirely; B still has the panel open, so the page stays pinned.
      a.widget.destroy();
      expect(document.body.style.position).toBe("fixed");
      // Destroying A twice must not hand the lock a second release.
      a.widget.destroy();
      expect(document.body.style.position).toBe("fixed");

      b.widget.destroy();
      expect(document.body.style.position).toBe("");

      a.root.remove();
      b.root.remove();
      client.destroy();
    });

    it("destroy() while open releases the lock", () => {
      stubCompact({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const { root, widget } = mountSide(client);

      widget.open!();
      expect(document.body.style.position).toBe("fixed");
      widget.destroy();
      expect(document.body.style.position).toBe("");

      root.remove();
      client.destroy();
    });

    it("a DESKTOP side panel is not modal: no aria-modal, no Tab trap, no lock", () => {
      stubCompact({ mobile: false });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const { root, widget, container } = mountSide(client);

      widget.open!();
      // The host page is still visible and usable beside the panel, so claiming
      // modality would lie to assistive tech and strand keyboard users.
      expect(container.getAttribute("aria-modal")).toBeNull();
      expect(container.getAttribute("role")).toBeNull();
      expect(document.body.style.position).toBe("");

      const tab = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(false);

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("a COMPACT side panel is modal and keeps the composer off the keyboard", async () => {
      stubCompact({ mobile: true });
      // jsdom has no visualViewport; drive it by hand. Layout viewport stays
      // window.innerHeight (768 in jsdom) — that is exactly why `bottom: 0`
      // ends up underneath the on-screen keyboard on iOS.
      const vvListeners = new Map<string, Set<() => void>>();
      const vv = {
        height: 768,
        offsetTop: 0,
        addEventListener: (type: string, cb: () => void) => {
          const set = vvListeners.get(type) ?? new Set();
          set.add(cb);
          vvListeners.set(type, set);
        },
        removeEventListener: (type: string, cb: () => void) => {
          vvListeners.get(type)?.delete(cb);
        },
      };
      vi.stubGlobal("visualViewport", vv);
      const fireVv = (type: string) => {
        for (const cb of vvListeners.get(type) ?? []) cb();
      };

      const client = new AgoClient({ baseUrl: "https://example.test" });
      const { root, widget, wrapper, container } = mountSide(client);

      widget.open!();
      expect(container.getAttribute("role")).toBe("dialog");
      expect(container.getAttribute("aria-modal")).toBe("true");
      // No keyboard yet: the panel spans the viewport.
      expect(wrapper.style.bottom).toBe("0px");

      // Keyboard opens: the visible viewport shrinks to 500 of a 768 layout.
      vv.height = 500;
      fireVv("resize");
      await new Promise((r) => requestAnimationFrame(r));
      // 768 - (0 + 500) = 268px of keyboard to clear. Written on the WRAPPER:
      // `container` is a static flex child here, so writing `top` on it (the
      // inline path's move) would do nothing at all.
      expect(wrapper.style.bottom).toBe("268px");

      widget.close!();
      // Desktop geometry is handed back to CSS, and later viewport changes are
      // ignored because the listeners were dropped.
      expect(wrapper.style.bottom).toBe("");
      vv.height = 300;
      fireVv("resize");
      expect(wrapper.style.bottom).toBe("");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("opening on a compact viewport does not pop the keyboard", () => {
      stubCompact({ mobile: true });
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const { root, widget, container } = mountSide(client);
      const textarea = container.querySelector("textarea")!;

      widget.open!();
      // Focusing the textarea would open the on-screen keyboard and eat half the
      // panel before anything is read. Focus lands on the dialog instead — the
      // launcher that was just clicked is now display:none, so doing nothing
      // would drop focus to <body> and restart Tab at the top of the host page.
      expect(document.activeElement).toBe(container);
      expect(document.activeElement).not.toBe(textarea);

      widget.destroy();
      root.remove();
      client.destroy();
    });
  });

  describe("persistConversation", () => {
    /** Seed the front-cached last active thread (id + last message time). */
    function seedThread(
      storage: StorageLike & { raw: Map<string, string> },
      value: string,
      lastMessageAt: number,
    ): void {
      storage.raw.set(
        "ago_last_thread",
        JSON.stringify({ value, lastMessageAt }),
      );
    }

    it("resumes the cached last active thread on mount (id comes from the front cache)", async () => {
      const storage = fakeStorage();
      seedThread(storage, "conv-restored", Date.now());
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const sendSpy = vi
        .spyOn(client, "sendMessage")
        .mockResolvedValue(makeAssistantMessage());
      const getSpy = vi
        .spyOn(client, "getConversation")
        .mockResolvedValue(makeConversation("conv-restored"));

      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, {
        client,
        persistConversation: { storage },
      });

      await widget.sendMessage("hi");

      // The resumed id comes from the front cache, and its history is loaded by id —
      // no need to look it up in the conversations list.
      expect(getSpy).toHaveBeenCalledWith("conv-restored");
      expect(sendSpy).toHaveBeenCalledWith(
        "hi",
        expect.objectContaining({ conversationId: "conv-restored" }),
      );

      sendSpy.mockRestore();
      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("loads the conversation list into widget.threads on mount and after a turn (loadThreads)", async () => {
      const storage = fakeStorage();
      const client = new AgoClient({ baseUrl: "https://example.test" });
      vi.spyOn(client, "sendMessage").mockResolvedValue(
        makeAssistantMessage({ conversationId: "conv-1" }),
      );
      const listSpy = vi.spyOn(client, "getConversations").mockResolvedValue({
        data: [makeConversation("conv-1"), makeConversation("conv-2")],
        hasMore: false,
        total: 2,
      });

      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, {
        client,
        loadThreads: true,
        persistConversation: { storage },
      });

      await vi.waitFor(() => {
        expect(widget.threads.map((t) => t.id)).toEqual(["conv-1", "conv-2"]);
      });

      // The list refreshes after a turn (e.g. a freshly created thread shows up).
      listSpy.mockResolvedValue({
        data: [makeConversation("conv-3")],
        hasMore: false,
        total: 1,
      });
      await widget.sendMessage("hi");
      await vi.waitFor(() => {
        expect(widget.threads.map((t) => t.id)).toEqual(["conv-3"]);
      });

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("does not load threads by default; refreshThreads() still works on demand", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const listSpy = vi.spyOn(client, "getConversations").mockResolvedValue({
        data: [makeConversation("conv-1")],
        hasMore: false,
        total: 1,
      });

      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client });

      // No automatic load on mount.
      expect(listSpy).not.toHaveBeenCalled();
      expect(widget.threads).toEqual([]);

      // Manual refresh still populates the same array reference.
      await widget.refreshThreads();
      expect(widget.threads.map((t) => t.id)).toEqual(["conv-1"]);

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("does not resume a thread idle past the ttl", async () => {
      const storage = fakeStorage();
      seedThread(storage, "conv-stale", 0); // very old
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const sendSpy = vi
        .spyOn(client, "sendMessage")
        .mockResolvedValue(
          makeAssistantMessage({ conversationId: "conv-new" }),
        );
      const getSpy = vi.spyOn(client, "getConversation");

      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, {
        client,
        persistConversation: { storage, ttlMs: 1000 },
      });

      await widget.sendMessage("hi");

      // Stale thread is ignored: history not loaded, send starts a fresh thread.
      expect(getSpy).not.toHaveBeenCalled();
      expect(sendSpy).toHaveBeenCalledWith(
        "hi",
        expect.objectContaining({ conversationId: undefined }),
      );

      sendSpy.mockRestore();
      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("caches the thread and its last message time after a turn", async () => {
      const storage = fakeStorage();
      const completedAt = new Date();
      const client = new AgoClient({ baseUrl: "https://example.test" });
      vi.spyOn(client, "sendMessage").mockResolvedValue(
        makeAssistantMessage({
          conversationId: "conv-9",
          createdAt: completedAt,
        }),
      );

      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, {
        client,
        persistConversation: { storage },
      });

      await widget.sendMessage("hi");

      const stored = JSON.parse(storage.raw.get("ago_last_thread")!);
      expect(stored.value).toBe("conv-9");
      expect(stored.lastMessageAt).toBe(completedAt.getTime());
      // Fresh timestamp → resumable on the front without a backend call.
      expect(widget.session?.getLastActiveThread()).toBe("conv-9");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("lets an explicit conversationId win over the cached thread", async () => {
      const storage = fakeStorage();
      seedThread(storage, "conv-saved", Date.now());
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const sendSpy = vi
        .spyOn(client, "sendMessage")
        .mockResolvedValue(makeAssistantMessage());
      vi.spyOn(client, "getConversation").mockResolvedValue(
        makeConversation("conv-explicit"),
      );

      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, {
        client,
        conversationId: "conv-explicit",
        persistConversation: { storage },
      });

      await widget.sendMessage("hi");

      expect(sendSpy).toHaveBeenCalledWith(
        "hi",
        expect.objectContaining({ conversationId: "conv-explicit" }),
      );

      sendSpy.mockRestore();
      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("exposes no session when persistConversation is unset", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client });

      expect(widget.session).toBeUndefined();

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("renders the previous messages when resuming a thread", async () => {
      const storage = fakeStorage();
      seedThread(storage, "conv-restored", Date.now());
      const client = new AgoClient({ baseUrl: "https://example.test" });
      vi.spyOn(client, "getConversation").mockResolvedValue(
        makeConversation("conv-restored", [
          {
            id: "m1",
            conversationId: "conv-restored",
            content: "Earlier question",
            role: "user",
            status: "DONE",
            createdAt: new Date(0),
          },
          makeAssistantMessage({ id: "m2", content: "Earlier answer" }),
        ]),
      );

      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, {
        client,
        persistConversation: { storage },
      });

      // loadHistory resolves on a later microtask; wait for it to paint.
      await vi.waitFor(() => {
        expect(root.textContent).toContain("Earlier answer");
      });
      expect(root.textContent).toContain("Earlier question");

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("displays uploaded files securely when resuming a thread", async () => {
      const storage = fakeStorage();
      seedThread(storage, "conv-files", Date.now());
      const client = new AgoClient({ baseUrl: "https://example.test" });
      vi.spyOn(client, "getConversation").mockResolvedValue(
        makeConversation("conv-files", [
          {
            id: "m1",
            conversationId: "conv-files",
            content: "see attached",
            role: "user",
            status: "DONE",
            createdAt: new Date(0),
            attachments: [
              {
                id: "img",
                name: "photo.png",
                contentType: "image/png",
                fileSize: 2048,
                url: "https://files.example.com/photo.png?sig=abc",
                isSafeImage: true,
              },
              {
                id: "doc",
                name: "report.pdf",
                contentType: "application/pdf",
                fileSize: 1024 * 1024,
                url: "https://files.example.com/report.pdf?sig=xyz",
                isSafeImage: false,
              },
              {
                id: "spoof",
                name: "evil.png",
                contentType: "image/png",
                fileSize: 100,
                url: "https://files.example.com/evil.png",
                // No safe verdict from the backend → must NOT be embedded.
                isSafeImage: false,
              },
            ],
          },
        ]),
      );

      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, {
        client,
        persistConversation: { storage },
      });

      await vi.waitFor(() => {
        expect(root.textContent).toContain("see attached");
      });

      const imgs = root.querySelectorAll<HTMLImageElement>(
        ".ago-message__attachments img",
      );
      // Only the backend-verified image is embedded; the unverified one is a link.
      expect(imgs).toHaveLength(1);
      expect(imgs[0].src).toBe("https://files.example.com/photo.png?sig=abc");

      // The PDF and the unverified image both render as download links, not <img>.
      expect(root.textContent).toContain("report.pdf");
      expect(root.textContent).toContain("evil.png");
      expect(
        Array.from(root.querySelectorAll<HTMLImageElement>("img")).some((el) =>
          el.src.includes("evil.png"),
        ),
      ).toBe(false);

      widget.destroy();
      root.remove();
      client.destroy();
    });
  });

  describe("stop button", () => {
    /** Send that never settles, so the widget stays in its answering state. */
    function mountAnswering(options: { allowStop?: boolean } = {}) {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      vi.spyOn(client, "sendMessage").mockImplementation(
        () => new Promise<AgoMessage>(() => {}),
      );
      const stopSpy = vi
        .spyOn(client, "stop")
        .mockImplementation(async () => null);

      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client, ...options });
      void widget.sendMessage("hello");

      return { client, root, widget, stopSpy };
    }

    it("replaces send with an enabled Stop button while the agent answers", () => {
      const { client, root, widget, stopSpy } = mountAnswering();

      const stopBtn = root.querySelector<HTMLButtonElement>(
        '.ago-chat-input button[aria-label="Stop generating"]',
      );
      expect(stopBtn).not.toBeNull();
      expect(stopBtn!.disabled).toBe(false);

      stopBtn!.click();
      expect(stopSpy).toHaveBeenCalledTimes(1);

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("keeps the disabled spinner when allowStop is false", () => {
      const { client, root, widget, stopSpy } = mountAnswering({
        allowStop: false,
      });

      expect(
        root.querySelector('.ago-chat-input button[aria-label="Stop generating"]'),
      ).toBeNull();
      const sendBtn = root.querySelector<HTMLButtonElement>(
        '.ago-chat-input button[aria-label="Send"]',
      )!;
      expect(sendBtn.disabled).toBe(true);
      sendBtn.click();
      expect(stopSpy).not.toHaveBeenCalled();

      widget.destroy();
      root.remove();
      client.destroy();
    });

    it("keeps the partial answer and releases the input when the turn is stopped", () => {
      const mock = createMockClient({
        overrides: {
          // Never settles: the widget stays in its answering state until the
          // stop event arrives.
          sendMessage: () => new Promise<AgoMessage>(() => {}),
        },
      });

      const root = document.createElement("div");
      document.body.appendChild(root);
      const widget = mountChatWidget(root, { client: mock });
      void widget.sendMessage("hello");

      // Some text streamed in before the user pressed Stop.
      mock.__emitEvent("message:chunk", {
        content: "Partial",
        conversationId: "c1",
        messageId: "m1",
      });
      mock.__emitEvent("message:stopped", {
        conversationId: "c1",
        messageId: "m1",
      });

      expect(root.textContent).toContain("Partial");
      // The input is released: the Stop button is gone, send is back.
      expect(
        root.querySelector('.ago-chat-input button[aria-label="Stop generating"]'),
      ).toBeNull();

      widget.destroy();
      root.remove();
    });
  });
});
