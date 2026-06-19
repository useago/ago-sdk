import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { AgoMessage, Conversation } from "../src/client/types";
import { mountChatWidget } from "../src/widget/createChatWidget";
import type { CreateFormCollectorOptions } from "../src/forms/createFormCollector";
import type { StorageLike } from "../src/state/createStore";

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
    }))
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

function makeConversation(id: string, messages: AgoMessage[] = []): Conversation {
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
      "update_order"
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
          execute: (name: string, args: Record<string, unknown>) => Promise<unknown>;
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
    const handler = vi.fn(async () => ({ message: "Commande #1234 confirmée." }));
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
          followUpReplies: sent.length === 1 ? ["Pricing", "Book a demo"] : undefined,
        });
      });

    const root = document.createElement("div");
    document.body.appendChild(root);
    const widget = mountChatWidget(root, { client });

    await widget.sendMessage("hello");

    const buttons = root.querySelectorAll<HTMLButtonElement>(
      ".ago-message__followup-btn"
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
          followUpReplies: sent.length === 1 ? ["Pricing", "Book a demo"] : undefined,
        });
      }
    );

    const root = document.createElement("div");
    document.body.appendChild(root);
    const widget = mountChatWidget(root, { client });

    await widget.sendMessage("hello");
    expect(
      root.querySelectorAll(".ago-message__followup-btn")
    ).toHaveLength(2);

    // Second turn: the first reply is no longer the last message, so its
    // stale suggestions must disappear.
    await widget.sendMessage("tell me more");
    expect(
      root.querySelectorAll(".ago-message__followup-btn")
    ).toHaveLength(0);

    widget.destroy();
    root.remove();
    client.destroy();
  });

  it("renders suggested replies as disabled when onFollowUpClick is false", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    vi.spyOn(client, "sendMessage").mockResolvedValue(
      makeAssistantMessage({ followUpReplies: ["A"] })
    );

    const root = document.createElement("div");
    document.body.appendChild(root);
    const widget = mountChatWidget(root, { client, onFollowUpClick: false });

    await widget.sendMessage("hello");

    const button = root.querySelector<HTMLButtonElement>(
      ".ago-message__followup-btn"
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
        ".ago-message--assistant .ago-message__content"
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
        ".ago-message--assistant .ago-message__content"
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
        ".ago-message--assistant .ago-message__content"
      );
      expect(assistant).not.toBeNull();
      expect(assistant!.style.padding).toBe("10px 14px");
      expect(assistant!.style.backgroundColor).not.toBe("transparent");
      const assistantTail = assistant!.querySelector<HTMLElement>(
        ".ago-message__tail"
      );
      expect(assistantTail).not.toBeNull();
      expect(assistantTail!.style.left).not.toBe("");
      expect(assistantTail!.style.right).toBe("");
      expect(assistantTail!.style.borderBottomRightRadius).not.toBe("");

      // User message: tail bulge on the bottom-right.
      const user = root.querySelector<HTMLElement>(
        ".ago-message--user .ago-message__content"
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
        ".ago-chat-widget-launcher"
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
      const wrapper = root.querySelector<HTMLElement>(".ago-chat-widget-panel")!;
      const launcher = root.querySelector<HTMLElement>(
        ".ago-chat-widget-launcher"
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
      const wrapper = root.querySelector<HTMLElement>(".ago-chat-widget-panel")!;

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

  describe("persistConversation", () => {
    /** Seed the front-cached last active thread (id + last message time). */
    function seedThread(
      storage: StorageLike & { raw: Map<string, string> },
      value: string,
      lastMessageAt: number
    ): void {
      storage.raw.set("ago_last_thread", JSON.stringify({ value, lastMessageAt }));
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
        expect.objectContaining({ conversationId: "conv-restored" })
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
        makeAssistantMessage({ conversationId: "conv-1" })
      );
      const listSpy = vi
        .spyOn(client, "getConversations")
        .mockResolvedValue([makeConversation("conv-1"), makeConversation("conv-2")]);

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
      listSpy.mockResolvedValue([makeConversation("conv-3")]);
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
      const listSpy = vi
        .spyOn(client, "getConversations")
        .mockResolvedValue([makeConversation("conv-1")]);

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
        .mockResolvedValue(makeAssistantMessage({ conversationId: "conv-new" }));
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
        expect.objectContaining({ conversationId: undefined })
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
        makeAssistantMessage({ conversationId: "conv-9", createdAt: completedAt })
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
        makeConversation("conv-explicit")
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
        expect.objectContaining({ conversationId: "conv-explicit" })
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
        ])
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
  });
});
