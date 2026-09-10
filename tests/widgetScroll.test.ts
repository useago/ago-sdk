import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgoMessage } from "../src/client/types";
import { createMockClient } from "../src/testing/createMockClient";
import { mountChatWidget } from "../src/widget/createChatWidget";
import type { MountChatWidgetOptions } from "../src/widget/types";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});

function setup(options: MountChatWidgetOptions) {
  let resolveSend!: (message: AgoMessage) => void;
  const client = createMockClient({
    overrides: {
      sendMessage: () => new Promise<AgoMessage>((resolve) => { resolveSend = resolve; }),
    },
  });
  const root = document.createElement("div");
  document.body.appendChild(root);
  const widget = mountChatWidget(root, {
    client,
    defaultOpen: true,
    persistConversation: false,
    loadThreads: false,
    autoResume: false,
    prompt: false,
    feedback: false,
    ...options,
  });
  cleanups.push(() => { widget.destroy(); client.destroy(); root.remove(); });
  widget.showScreen?.("chat");
  const pane = root.querySelector<HTMLElement>(".ago-chat-widget__messages")!;
  const list = root.querySelector<HTMLElement>(".ago-chat-widget__list") ?? pane;
  const jump = root.querySelector<HTMLButtonElement>(".ago-chat-widget__jump")!;
  // jsdom has no layout. Model browser geometry, including scrollTop clamping.
  const geometry = { height: 600, viewport: 200, top: 0 };
  Object.defineProperties(pane, {
    scrollHeight: { configurable: true, get: () => geometry.height },
    clientHeight: { configurable: true, get: () => geometry.viewport },
    scrollTop: {
      configurable: true,
      get: () => geometry.top,
      set: (value: number) => {
        geometry.top = Math.max(0, Math.min(value, geometry.height - geometry.viewport));
      },
    },
  });
  let content = "";
  return {
    widget, pane, list, jump, geometry,
    jumpVisible: () => options.placement === "bubble"
      ? jump.style.opacity === "1" && jump.style.pointerEvents === "auto"
      : jump.style.display === "flex",
    chunk(height: number) {
      geometry.height = height;
      content += "More text. ";
      client.__emitEvent("message:chunk", {
        content: "More text. ", conversationId: "c1", messageId: "m1",
      });
    },
    complete() {
      const message: AgoMessage = {
        id: "m1", conversationId: "c1", content, role: "assistant",
        status: "DONE", createdAt: new Date(0),
      };
      client.__emitEvent("message:answer-complete", message);
      client.__emitEvent("message:complete", message);
      resolveSend(message);
    },
    scroll(top: number) {
      pane.scrollTop = top;
      pane.dispatchEvent(new Event("scroll"));
    },
  };
}

describe.each(["inline", "bubble"] as const)("%s widget scrolling", (placement) => {
  it.each([undefined, true])("keeps automatic following with autoScroll=%s", async (autoScroll) => {
    const chat = setup({ placement, autoScroll });
    void chat.widget.sendMessage("hello");
    expect(chat.pane.scrollTop).toBe(400);
    chat.chunk(800);
    expect(chat.pane.scrollTop).toBe(600);
    expect(chat.jumpVisible()).toBe(false);

    await Promise.resolve();
    chat.scroll(100);
    chat.chunk(1000);
    expect(chat.pane.scrollTop).toBe(100);
    expect(chat.jumpVisible()).toBe(true);

    chat.jump.click();
    expect(chat.pane.scrollTop).toBe(800);
    chat.chunk(1200);
    expect(chat.pane.scrollTop).toBe(1000);
    expect(chat.jumpVisible()).toBe(false);
  });

  it("keeps manual positions during chunks, including when the reader was at the bottom", async () => {
    const chat = setup({ placement, autoScroll: false });
    void chat.widget.sendMessage("hello");
    expect(chat.pane.scrollTop).toBe(400);
    chat.chunk(800);
    expect(chat.pane.scrollTop).toBe(400);
    expect(chat.pane.style.overflowAnchor).toBe("none");

    await Promise.resolve();
    chat.scroll(120);
    chat.chunk(1000);
    expect(chat.pane.scrollTop).toBe(120);
    await Promise.resolve();
    chat.scroll(800);
    expect(chat.jumpVisible()).toBe(false);
    chat.chunk(1200);
    expect(chat.pane.scrollTop).toBe(800);
    expect(chat.jumpVisible()).toBe(true);
  });

  it("jumps once in manual mode without enabling automatic following", () => {
    const chat = setup({ placement, autoScroll: false });
    void chat.widget.sendMessage("hello");
    chat.chunk(800);
    expect(chat.jumpVisible()).toBe(true);
    chat.jump.click();
    expect(chat.pane.scrollTop).toBe(600);
    expect(chat.jumpVisible()).toBe(false);

    chat.chunk(1000);
    expect(chat.pane.scrollTop).toBe(600);
    expect(chat.jumpVisible()).toBe(true);
  });

  it("preserves manual position across DOM replacement and completion, then jumps on send", async () => {
    const chat = setup({ placement, autoScroll: false });
    const pending = chat.widget.sendMessage("hello");
    chat.chunk(1000);
    await Promise.resolve();
    chat.scroll(350);

    // Browsers can clamp the offset when removing the rendered content. Force
    // that layout effect here; jsdom's replaceChildren/replaceChild do not.
    const replaceChildren = chat.list.replaceChildren.bind(chat.list);
    vi.spyOn(chat.list, "replaceChildren").mockImplementation((...nodes) => {
      replaceChildren(...nodes);
      chat.pane.scrollTop = 0;
    });
    const replaceChild = chat.list.replaceChild.bind(chat.list);
    vi.spyOn(chat.list, "replaceChild").mockImplementation((next, previous) => {
      const removed = replaceChild(next, previous);
      chat.pane.scrollTop = 0;
      return removed;
    });
    chat.chunk(1200);
    expect(chat.pane.scrollTop).toBe(350);
    chat.complete();
    await pending;
    expect(chat.pane.scrollTop).toBe(350);
    expect(chat.pane.textContent).toContain("More text.");

    void chat.widget.sendMessage("another question");
    expect(chat.pane.scrollTop).toBe(1000);
    chat.chunk(1400);
    expect(chat.pane.scrollTop).toBe(1000);
  });
});
