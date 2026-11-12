import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { AgoMessage, Conversation } from "../src/client/types";
import type { CreateFormCollectorOptions } from "../src/forms/createFormCollector";
import type { StorageLike } from "../src/state/createStore";
import { createMockClient } from "./widgetMockClient";
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

    const onFormSubmitting = vi.fn();
    const onFormSubmitted = vi.fn();
    const widget = mountChatWidget(root, {
      client,
      forms: [
        {
          ...orderForm,
          submit: { via: "client", handler: async () => ({ id: 42 }) },
        },
      ],
      onFormSubmitting,
      onFormSubmitted,
    });

    await completeOrderForm(client);

    expect(onFormSubmitting).toHaveBeenCalledExactlyOnceWith({
      name: "order",
      values: { product: "Widget", quantity: 2 },
    });
    expect(onFormSubmitted).toHaveBeenCalledWith({
      name: "order",
      values: { product: "Widget", quantity: 2 },
      result: { id: 42 },
    });

    widget.destroy();
    client.emitFormEvent("form:submitting", { name: "order", values: {} });
    expect(onFormSubmitting).toHaveBeenCalledTimes(1);
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

    it("themes the launcher, which is mounted outside the panel", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const root = document.createElement("div");
      document.body.appendChild(root);

      const widget = mountChatWidget(root, {
        client,
        placement: "right",
        theme: { brand: "#ff0000" },
      });

      const launcher = root.querySelector<HTMLElement>(
        ".ago-chat-widget-launcher",
      )!;
      expect(launcher.style.getPropertyValue("--ago-brand-color")).toBe(
        "#ff0000",
      );

      widget.destroy();
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
      await vi.waitFor(() => expect(sent).toEqual(["hello", "Pricing"]));

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
      await vi.waitFor(() => expect(sent).toEqual(["hello", "Pricing"]));

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

      const pane = root.querySelector<HTMLElement>(
        ".ago-chat-widget__messages",
      )!;
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
      const pane = root.querySelector<HTMLElement>(
        ".ago-chat-widget__messages",
      )!;

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
      const pane = root.querySelector<HTMLElement>(
        ".ago-chat-widget__messages",
      )!;
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
      const pane = root.querySelector<HTMLElement>(
        ".ago-chat-widget__messages",
      )!;
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

      const pill = root.querySelector<HTMLElement>(
        ".ago-message__followup-btn",
      )!;
      expect(pill.style.minHeight).toBe("44px");

      widget.destroy();
      root.remove();
      client.destroy();
    });
  });

  describe("compact side panel + host-safe scroll lock", () => {
    /** Same shape as the mobile-fullscreen stub, scoped to this block. */
    function stubCompact(state: { mobile: boolean }) {
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
        .spyOn(client, "setActiveConversation")
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
      vi.spyOn(client, "setActiveConversation").mockResolvedValue(
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
      vi.spyOn(client, "setActiveConversation").mockResolvedValue(
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
      vi.spyOn(client, "setActiveConversation").mockResolvedValue(
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

    it("replaces send with an enabled Stop button while the agent answers", async () => {
      const { client, root, widget, stopSpy } = mountAnswering();

      await vi.waitFor(() => expect(root.querySelector('.ago-chat-input button[aria-label="Stop generating"]')).not.toBeNull());
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
        root.querySelector(
          '.ago-chat-input button[aria-label="Stop generating"]',
        ),
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
        root.querySelector(
          '.ago-chat-input button[aria-label="Stop generating"]',
        ),
      ).toBeNull();

      widget.destroy();
      root.remove();
    });
  });
});

it("switches text-only widget chrome without fetching form config or losing the composer draft", () => {
  const getConfig = vi.fn();
  const client = createMockClient({
    overrides: { getConfig, getLanguage: () => "fr" },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const widget = mountChatWidget(host, { client });
  try {
    const input = host.querySelector("textarea")!;
    expect(input.placeholder).toBe("Écrivez un message...");
    input.value = "Unsent draft";
    client.__emitEvent("config:changed", { language: "de-DE" });
    expect(input.placeholder).toBe("Nachricht eingeben...");
    expect(input.value).toBe("Unsent draft");
    expect(host.querySelector('button[aria-label="Senden"]')).not.toBeNull();
    expect(getConfig).not.toHaveBeenCalled();
  } finally {
    widget.destroy();
    host.remove();
  }
});

describe("response state", () => {
  it("replaces privileged approval data, blocks input and submits the exact approval", async () => {
    const client = createMockClient({
      overrides: {
        getConversation: async () => ({
          id: "conv-1",
          title: "Thread",
          lastMessageDate: new Date(),
          messages: [],
        }),
        submitApprovalDecision: async () => undefined,
      },
    });
    const root = document.createElement("div");
    document.body.append(root);
    const widget = mountChatWidget(root, {
      client,
      conversationId: "conv-1",
      welcomeMessage: "",
    });
    await Promise.resolve();
    await Promise.resolve();
    const message = makeAssistantMessage({
      status: "WAITING_APPROVAL",
      canStop: false,
      content: "",
      progress: {
        steps: null,
        activity: [{ text: "Working", timestamp: null }],
        truncated: false,
      },
      approval: {
        id: "approval-a",
        status: "pending",
        allowedDecisions: ["approve", "reject"],
        actions: [
          {
            name: "publish",
            arguments: { input: "<img src=x onerror=alert(1)>" },
          },
        ],
        expiresAt: null,
      },
    });
    client.__emitEvent("conversation:update", {
      conversationId: "conv-1",
      interaction: { canSendMessage: false, blockingMessageId: message.id },
    });
    client.__emitEvent("message:update", message);
    expect(root.textContent).toContain("Working");
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(root.querySelector(".ago-response-state img")).toBeNull();
    expect(root.querySelector("textarea")?.disabled).toBe(true);
    const approve = [
      ...root.querySelectorAll(".ago-response-state button"),
    ].find((b) => b.textContent === "Approve")!;
    approve.click();
    await Promise.resolve();
    expect(client.__callsFor("submitApprovalDecision")[0]?.args).toEqual([
      "approval-a",
      "approve",
    ]);
    client.__emitEvent("message:update", {
      ...message,
      approval: { ...message.approval!, actions: [], allowedDecisions: [] },
    });
    expect(root.textContent).not.toContain("<img src=x");
    expect(root.querySelectorAll(".ago-response-state button")).toHaveLength(0);
    await widget.sendMessage("blocked");
    expect(client.__callsFor("sendMessage")).toHaveLength(0);
    widget.destroy();
    root.remove();
  });
});

describe("background response ownership", () => {
  it("keeps a fast fork final snapshot when the initial send settles later", async () => {
    let finish!: (message: AgoMessage) => void;
    const client = createMockClient({
      overrides: {
        sendMessage: () =>
          new Promise<AgoMessage>((resolve) => {
            finish = resolve;
          }),
      },
    });
    const root = document.createElement("div");
    document.body.append(root);
    const widget = mountChatWidget(root, { client, welcomeMessage: "" });
    const sent = widget.sendMessage("hello");
    client.__emitEvent(
      "message:update",
      makeAssistantMessage({
        id: "fork-answer",
        conversationId: "fork",
        content: "Final report",
        status: "DONE",
        canStop: false,
      }),
    );
    client.__emitEvent("conversation:update", {
      conversationId: "fork",
      interaction: { canSendMessage: true, blockingMessageId: null },
    });
    finish(
      makeAssistantMessage({
        id: "fork-answer",
        conversationId: "fork",
        content: "Old running state",
        status: "IN_PROGRESS",
        canStop: false,
      }),
    );
    await sent;
    expect(root.textContent).toContain("Final report");
    expect(root.textContent).not.toContain("Old running state");
    widget.destroy();
    root.remove();
  });

  it("suspends a hidden server-owned response and reopens without Stop", async () => {
    const waiting = makeAssistantMessage({
      id: "job",
      content: "Waiting",
      status: "WAITING_APPROVAL",
      canStop: false,
    });
    const client = createMockClient({
      overrides: {
        getConversation: async () => ({
          id: "conv-1",
          title: "Thread",
          lastMessageDate: new Date(),
          messages: [waiting],
          interaction: { canSendMessage: false, blockingMessageId: "job" },
        }),
      },
    });
    const activate = vi.spyOn(client, "setActiveConversation");
    const root = document.createElement("div");
    document.body.append(root);
    const widget = mountChatWidget(root, {
      client,
      placement: "right",
      defaultOpen: true,
      conversationId: "conv-1",
    });
    await vi.waitFor(() => expect(root.textContent).toContain("Waiting"));
    widget.close?.();
    expect(activate).toHaveBeenCalledWith(null);
    expect(client.__callsFor("stop")).toHaveLength(0);
    widget.open?.();
    await vi.waitFor(() =>
      expect(
        activate.mock.calls.filter(([id]) => id === "conv-1"),
      ).toHaveLength(2),
    );
    widget.destroy();
    root.remove();
  });

  it("clears drafts and prevents a late old send from repopulating after an identity reset", async () => {
    let finish!: (message: AgoMessage) => void;
    const client = createMockClient({
      overrides: {
        sendMessage: () =>
          new Promise<AgoMessage>((resolve) => {
            finish = resolve;
          }),
      },
    });
    const root = document.createElement("div");
    document.body.append(root);
    const widget = mountChatWidget(root, { client, welcomeMessage: "" });
    const sent = widget.sendMessage("old secret");
    client.__emitEvent("conversation:update", {
      conversationId: null,
      interaction: null,
    });
    finish(makeAssistantMessage({ content: "old private response" }));
    await sent;
    expect(root.textContent).not.toContain("old secret");
    expect(root.textContent).not.toContain("old private response");
    expect(root.querySelector("textarea")?.value).toBe("");
    widget.destroy();
    root.remove();
  });
});

describe("identity-bound forms", () => {
  it("does not restore a form notice after a pending submission crosses logout", async () => {
    let finish!: (value: { message: string }) => void;
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const root = document.createElement("div");
    document.body.append(root);
    const widget = mountChatWidget(root, {
      client,
      forms: [
        {
          ...orderForm,
          submit: {
            via: "client",
            handler: () =>
              new Promise((resolve) => {
                finish = resolve;
              }),
          },
        },
      ],
    });
    const registry = (
      client as unknown as {
        functionRegistry: {
          execute(
            name: string,
            args: Record<string, unknown>,
          ): Promise<unknown>;
        };
      }
    ).functionRegistry;
    const pending = registry.execute("update_order", {
      product: "item",
      quantity: 1,
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    client.updateConfig({ userJwt: null });
    finish({ message: "private old form result" });
    await pending;
    expect(root.textContent).not.toContain("private old form result");
    widget.destroy();
    client.destroy();
    root.remove();
  });
});

describe("preparation policy", () => {
  it("blocks the composer and programmatic send before an assistant message exists", async () => {
    const client = createMockClient({
      overrides: {
        getConversation: async () => ({
          id: "conv-1",
          title: "Thread",
          lastMessageDate: new Date(),
          messages: [],
          interaction: { canSendMessage: false, blockingMessageId: null },
        }),
      },
    });
    const root = document.createElement("div");
    document.body.append(root);
    const widget = mountChatWidget(root, {
      client,
      conversationId: "conv-1",
      welcomeMessage: "",
    });
    await vi.waitFor(() =>
      expect(root.querySelector("textarea")?.disabled).toBe(true),
    );
    await widget.sendMessage("should not send");
    expect(client.__callsFor("sendMessage")).toHaveLength(0);
    widget.destroy();
    root.remove();
  });
});

describe("send ownership", () => {
  it("does not send after the onMessageSent callback resets identity", async () => {
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
    });
    const send = vi.spyOn(client, "sendMessage");
    const root = document.createElement("div");
    document.body.append(root);
    const widget = mountChatWidget(root, {
      client,
      onMessageSent: () => client.updateConfig({ userJwt: null }),
    });
    await widget.sendMessage("secret");
    expect(send).not.toHaveBeenCalled();
    widget.destroy();
    client.destroy();
    root.remove();
  });
});

describe("navigation cancellation", () => {
  it.each(["open", "new"] as const)(
    "keeps ordinary automatic Stop when navigating to %s",
    async (destination) => {
      const client = createMockClient({
        overrides: {
          sendMessage: () => new Promise(() => {}),
          getConversation: async (id: string) => ({
            id,
            title: "Thread",
            lastMessageDate: new Date(),
            messages: [],
          }),
        },
      });
      const root = document.createElement("div");
      document.body.append(root);
      const widget = mountChatWidget(root, {
        client,
        placement: "bubble",
        defaultOpen: true,
        autoResume: false,
        loadThreads: false,
      });
      void widget.sendMessage("ordinary");
      client.__emitEvent(
        "message:update",
        makeAssistantMessage({
          conversationId: "conv-1",
          status: "IN_PROGRESS",
          canStop: undefined,
        }),
      );
      if (destination === "open") await widget.openConversation!("other");
      else widget.newConversation();
      expect(client.__callsFor("stop")).toHaveLength(1);
      widget.destroy();
      root.remove();
    },
  );

  it.each(["open", "new"] as const)(
    "does not Stop a response with canStop false when navigating to %s",
    async (destination) => {
      const client = createMockClient({
        overrides: {
          sendMessage: () => new Promise(() => {}),
          getConversation: async (id: string) => ({
            id,
            title: "Thread",
            lastMessageDate: new Date(),
            messages: [],
          }),
        },
      });
      const root = document.createElement("div");
      document.body.append(root);
      const widget = mountChatWidget(root, {
        client,
        placement: "bubble",
        defaultOpen: true,
        autoResume: false,
        loadThreads: false,
      });
      void widget.sendMessage("background");
      client.__emitEvent(
        "message:update",
        makeAssistantMessage({
          conversationId: "conv-1",
          status: "IN_PROGRESS",
          canStop: false,
        }),
      );
      if (destination === "open") await widget.openConversation!("other");
      else widget.newConversation();
      expect(client.__callsFor("stop")).toHaveLength(0);
      widget.destroy();
      root.remove();
    },
  );
});

describe("send callback reentry", () => {
  it("does not send after the host imperatively changes the active view", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const send = vi.spyOn(client, "sendMessage");
    const root = document.createElement("div");
    document.body.append(root);
    const widget = mountChatWidget(root, {
      client,
      onMessageSent: () => {
        void client.setActiveConversation(null).catch(() => {});
      },
    });
    await widget.sendMessage("secret");
    expect(send).not.toHaveBeenCalled();
    widget.destroy();
    client.destroy();
    root.remove();
  });
});

describe("ordinary hidden streaming", () => {
  it("keeps processing an ordinary stream while the panel is closed", async () => {
    const client = createMockClient({
      overrides: { sendMessage: () => new Promise(() => {}) },
    });
    const root = document.createElement("div");
    document.body.append(root);
    const widget = mountChatWidget(root, {
      client,
      placement: "right",
      defaultOpen: true,
    });
    void widget.sendMessage("hello");
    client.__emitEvent("message:start", { conversationId: "conv-1" });
    widget.close?.();
    client.__emitEvent("message:chunk", { content: "continued while hidden" });
    widget.open?.();
    expect(root.textContent).toContain("continued while hidden");
    expect(client.__callsFor("stop")).toHaveLength(0);
    widget.destroy();
    root.remove();
  });
});

describe("response outcomes", () => {
  it.each([
    ["PAUSED", null, "Paused"],
    ["DONE", "incomplete", "Incomplete"],
    ["ERROR", "failed", "Failed"],
  ] as const)(
    "shows %s / %s on its response",
    async (status, outcome, label) => {
      const client = createMockClient({
        overrides: {
          getConversation: async () => ({
            id: "conv-1",
            title: "Thread",
            lastMessageDate: new Date(),
            messages: [],
          }),
        },
      });
      const root = document.createElement("div");
      document.body.append(root);
      const widget = mountChatWidget(root, {
        client,
        conversationId: "conv-1",
        welcomeMessage: "",
      });
      await Promise.resolve();
      await Promise.resolve();
      client.__emitEvent(
        "message:update",
        makeAssistantMessage({ content: "", status, outcome, canStop: false }),
      );
      expect(root.querySelector(".ago-response-state")?.textContent).toContain(
        label,
      );
      widget.destroy();
      root.remove();
    },
  );
});

describe("principal verification before widget sends", () => {
  it.each(["same", "different"] as const)("verifies a %s viewer before sending and blocks re-entry", async (viewer) => {
    const { readFileSync } = await import("node:fs");
    const id = "11111111-1111-4111-8111-111111111111";
    const history = readFileSync("tests/fixtures/background-sdk/history-final.json", "utf8");
    let release!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => { release = resolve; });
    let histories = 0;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return new Response('data: {"message_id":"fresh","thread":{"id":"fresh"},"status":"DONE"}\n\n', { headers: { "Content-Type": "text/event-stream" } });
      if (String(url).includes("/conversations/")) return ++histories === 1 ? new Response(history) : held;
      throw new Error(`unexpected ${String(url)}`);
    });
    const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old", fetch: fetcher as typeof fetch });
    let changed = false;
    const root = document.createElement("div"); document.body.append(root);
    const widget = mountChatWidget(root, { client, conversationId: id, onMessageSent: () => { if (!changed) { changed = true; client.updateConfig({ userJwt: "new" }); } } });
    await vi.waitFor(() => expect(root.textContent).toContain("report is complete"));
    const pending = widget.sendMessage("old draft");
    await widget.sendMessage("duplicate");
    expect(root.querySelector("textarea")?.disabled).toBe(true);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    release(new Response(viewer === "same" ? history : history.replaceAll("viewer-staff-1", "viewer-other")));
    await pending;
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(viewer === "same" ? 1 : 0);
    if (viewer === "different") {
      await widget.sendMessage("new viewer draft");
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    }
    widget.destroy(); client.destroy(); root.remove();
  });

  it("restores a draft after 503 and retries verification only on the next send", async () => {
    const { readFileSync } = await import("node:fs");
    const id = "11111111-1111-4111-8111-111111111111";
    const history = readFileSync("tests/fixtures/background-sdk/history-final.json", "utf8");
    let release!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => { release = resolve; });
    let histories = 0;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return new Response('data: {"message_id":"m","thread":{"id":"a"},"status":"DONE"}\n\n', { headers: { "Content-Type": "text/event-stream" } });
      if (String(url).includes("/conversations/")) return ++histories === 2 ? held : new Response(history);
      throw new Error(`unexpected ${String(url)}`);
    });
    const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old", fetch: fetcher as typeof fetch });
    let changed = false;
    const root = document.createElement("div"); document.body.append(root);
    const widget = mountChatWidget(root, { client, conversationId: id, onMessageSent: () => { if (!changed) { changed = true; client.updateConfig({ userJwt: "new" }); } } });
    await vi.waitFor(() => expect(root.textContent).toContain("report is complete"));
    const textarea = root.querySelector("textarea")!;
    textarea.value = "retry draft"; textarea.dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(textarea.disabled).toBe(true);
    release(new Response("unavailable", { status: 503 }));
    await vi.waitFor(() => expect(textarea.value).toBe("retry draft"));
    expect(histories).toBe(2);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
    expect(histories).toBe(3);
    widget.destroy(); client.destroy(); root.remove();
  });
});

it("blocks reentrant sends while the host send callback is running", async () => {
  const client = createMockClient();
  const root = document.createElement("div"); document.body.append(root);
  let widget!: ReturnType<typeof mountChatWidget>;
  widget = mountChatWidget(root, { client, onMessageSent: () => { void widget.sendMessage("duplicate"); } });
  await widget.sendMessage("original");
  expect(client.__callsFor("sendMessage")).toHaveLength(1);
  expect(client.__callsFor("sendMessage")[0].args[0]).toBe("original");
  widget.destroy(); root.remove();
});

describe("authoritative widget history and visibility", () => {
  it("does not resurrect a hidden terminal response on completion or delayed initial settlement", async () => {
    let finish!: (message: AgoMessage) => void;
    const client = createMockClient({ overrides: { sendMessage: () => new Promise<AgoMessage>((resolve) => { finish = resolve; }) } });
    const received = vi.fn();
    const root = document.createElement("div"); document.body.append(root);
    const widget = mountChatWidget(root, { client, welcomeMessage: "", onMessageReceived: received });
    const pending = widget.sendMessage("request");
    const hidden = makeAssistantMessage({ id: "hidden-answer", conversationId: "conv-1", content: "private hidden body", status: "DONE", hidden: true });
    client.__emitEvent("message:update", hidden);
    client.__emitEvent("message:complete", hidden);
    finish({ ...hidden, hidden: false, content: "old initial body" });
    await pending;
    expect(root.textContent).not.toContain("private hidden body");
    expect(root.textContent).not.toContain("old initial body");
    expect(received).not.toHaveBeenCalled();
    client.__emitEvent("message:update", { ...hidden, hidden: false, content: "visible again" });
    expect(root.textContent).toContain("visible again");
    widget.destroy(); root.remove();
  });

  it.each([false, true])("replaces reopened history and preserves a fast newer follow (fast: %s)", async (fast) => {
    const { readFileSync } = await import("node:fs");
    const id = "11111111-1111-4111-8111-111111111111";
    const source = JSON.parse(readFileSync("tests/fixtures/background-sdk/history-running.json", "utf8"));
    const first = structuredClone(source);
    const firstAssistant = first.messages.find((message: { role: string }) => message.role === "assistant");
    firstAssistant.id = "old-id";
    firstAssistant.content = "old private response";
    firstAssistant.attachments = [{ id: "old-file", name: "old-private.csv", content_type: "text/csv", file_size: 10, file_url: "https://example.test/old.csv", is_safe_image: false }];
    first.interaction.blocking_message_id = "old-id";
    const reopened = structuredClone(source);
    if (!fast) {
      reopened.messages = [];
      reopened.interaction = { can_send_message: true, blocking_message_id: null };
    }
    const never = new Promise<Response>(() => {});
    const final = readFileSync("tests/fixtures/background-sdk/follow-to-final.sse", "utf8");
    let histories = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes("/conversations/")) return new Response(JSON.stringify(++histories === 1 ? first : reopened));
      if (path.includes("/messages/old-id/")) return never;
      if (path.endsWith("/events")) return new Response(final, { headers: { "Content-Type": "text/event-stream" } });
      throw new Error(`unexpected ${path}`);
    });
    const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "viewer", fetch: fetcher as typeof fetch });
    const root = document.createElement("div"); document.body.append(root);
    const widget = mountChatWidget(root, { client, placement: "right", defaultOpen: true, conversationId: id });
    await vi.waitFor(() => expect(root.textContent).toContain("old private response"));
    expect(root.textContent).toContain("old-private.csv");
    widget.close?.(); widget.open?.();
    await vi.waitFor(() => expect(histories).toBe(2));
    await vi.waitFor(() => expect(root.textContent).not.toContain("old private response"));
    expect(root.textContent).not.toContain("old-private.csv");
    if (fast) await vi.waitFor(() => expect(root.textContent).toContain("The report is complete"));
    widget.destroy(); client.destroy(); root.remove();
  });
});

describe("history advancement during activation", () => {
  it("keeps a newer message snapshot if history arrives afterward", async () => {
    let release!: (value: Conversation) => void;
    const client = createMockClient({ overrides: { getConversation: () => new Promise<Conversation>((resolve) => { release = resolve; }) } });
    const root = document.createElement("div"); document.body.append(root);
    const widget = mountChatWidget(root, { client, conversationId: "conv-1", welcomeMessage: "" });
    const old = makeAssistantMessage({ id: "answer", content: "old snapshot", status: "IN_PROGRESS" });
    const newer = { ...old, content: "new final", status: "DONE" as const };
    client.__emitEvent("message:update", newer);
    const history = makeConversation("conv-1", [old]);
    client.__emitEvent("conversation:loaded", history);
    release(history);
    await Promise.resolve(); await Promise.resolve();
    expect(root.textContent).toContain("new final");
    expect(root.textContent).not.toContain("old snapshot");
    widget.destroy(); root.remove();
  });

  it("filters hidden messages from the initial history", async () => {
    const client = createMockClient({ overrides: { getConversation: async () => makeConversation("conv-1", [makeAssistantMessage({ content: "hidden history", hidden: true })]) } });
    const root = document.createElement("div"); document.body.append(root);
    const widget = mountChatWidget(root, { client, conversationId: "conv-1", welcomeMessage: "" });
    await vi.waitFor(() => expect(client.__callsFor("getConversation")).toHaveLength(1));
    await Promise.resolve();
    expect(root.textContent).not.toContain("hidden history");
    widget.destroy(); root.remove();
  });
});

describe("authoritative message visibility", () => {
  it("keeps a hidden response hidden when later snapshots omit visibility", async () => {
    let finish!: (message: AgoMessage) => void;
    const client = createMockClient({ overrides: { sendMessage: () => new Promise<AgoMessage>((resolve) => { finish = resolve; }) } });
    const received = vi.fn();
    const root = document.createElement("div"); document.body.append(root);
    const widget = mountChatWidget(root, { client, welcomeMessage: "", onMessageReceived: received });
    const pending = widget.sendMessage("request");
    const hidden = makeAssistantMessage({ id: "answer", content: "secret", hidden: true, status: "DONE" });
    client.__emitEvent("message:update", hidden);
    const omitted = { ...hidden, content: "must remain hidden" }; delete omitted.hidden;
    client.__emitEvent("message:update", omitted);
    client.__emitEvent("message:answer-complete", omitted);
    client.__emitEvent("message:complete", omitted);
    finish(omitted); await pending;
    expect(root.textContent).not.toContain("must remain hidden");
    expect(received).not.toHaveBeenCalled();
    client.__emitEvent("message:update", { ...hidden, hidden: false, content: "explicitly visible" });
    expect(root.textContent).toContain("explicitly visible");
    widget.destroy(); root.remove();
  });

  it("keeps a previously unknown legacy message visible when visibility is omitted", async () => {
    const client = createMockClient({ overrides: { getConversation: async () => makeConversation("conv-1", []) } });
    const root = document.createElement("div"); document.body.append(root);
    const widget = mountChatWidget(root, { client, conversationId: "conv-1", welcomeMessage: "" });
    await Promise.resolve(); await Promise.resolve();
    const legacy = makeAssistantMessage({ content: "legacy visible" });
    delete legacy.hidden;
    client.__emitEvent("message:update", legacy);
    expect(root.textContent).toContain("legacy visible");
    widget.destroy(); root.remove();
  });

  it("does not let an older hidden completion override a reentrant visible update", async () => {
    let finish!: (message: AgoMessage) => void;
    const client = createMockClient({ overrides: { sendMessage: () => new Promise<AgoMessage>((resolve) => { finish = resolve; }) } });
    const hidden = makeAssistantMessage({ id: "answer", content: "old hidden content", hidden: true, status: "DONE" });
    client.on("message:complete", () => client.__emitEvent("message:update", { ...hidden, hidden: false, content: "new visible content" }));
    const received = vi.fn();
    const root = document.createElement("div"); document.body.append(root);
    const widget = mountChatWidget(root, { client, welcomeMessage: "", onMessageReceived: received });
    const pending = widget.sendMessage("request");
    client.__emitEvent("message:update", hidden);
    client.__emitEvent("message:complete", hidden);
    client.__emitEvent("message:answer-complete", hidden);
    finish(hidden); await pending;
    expect(root.textContent).toContain("new visible content");
    expect(root.textContent).not.toContain("old hidden content");
    expect(received).not.toHaveBeenCalled();
    widget.destroy(); root.remove();
  });
});
