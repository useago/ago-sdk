import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { AgoMessage, Conversation } from "../src/client/types";
import type { StorageLike } from "../src/state/createStore";
import { mountChatWidget } from "../src/widget/createChatWidget";

// The bubble widget loads the thread list on mount; keep unmocked mounts off the
// network. Tests that care about threads spy on client.getConversations.
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
  vi.useRealTimers();
  document.body.replaceChildren();
  document.body.removeAttribute("style");
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

const HOUR = 60 * 60 * 1000;

function thread(id: string, agoMs: number, title = `Thread ${id}`): Conversation {
  return { id, title, lastMessageDate: new Date(Date.now() - agoMs) };
}

function assistant(overrides: Partial<AgoMessage> = {}): AgoMessage {
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

async function flush(): Promise<void> {
  // Two turns: one for the mocked request, one for the render that follows.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function mountBubble(
  options: Partial<Parameters<typeof mountChatWidget>[1]> = {},
  threads: Conversation[] = [],
  // Runs before the widget mounts, for anything it requests on mount.
  setup?: (client: AgoClient) => void,
) {
  const client = new AgoClient({ baseUrl: "https://example.test" });
  const listSpy = vi
    .spyOn(client, "getConversations")
    .mockResolvedValue({ data: threads, hasMore: false, total: threads.length });
  const getSpy = vi.spyOn(client, "getConversation").mockImplementation(
    async (id) => ({
      id,
      title: `Thread ${id}`,
      lastMessageDate: new Date(),
      messages: [
        {
          id: `u-${id}`,
          conversationId: id,
          content: "earlier question",
          role: "user",
          status: "DONE",
          createdAt: new Date(0),
        },
        assistant({ id: `a-${id}`, conversationId: id, content: "earlier answer" }),
      ],
    }),
  );
  const storage = fakeStorage();
  setup?.(client);
  const widget = mountChatWidget(document.body, {
    client,
    placement: "bubble",
    persistConversation: { storage },
    ...options,
  });
  const root = document.body;
  return {
    client,
    widget,
    root,
    storage,
    listSpy,
    getSpy,
    launcher: () =>
      root.querySelector<HTMLButtonElement>(".ago-chat-widget-launcher")!,
    panel: () => root.querySelector<HTMLElement>(".ago-chat-widget-bubble")!,
    teaser: () => root.querySelector<HTMLElement>(".ago-chat-widget-teaser"),
    cleanup: () => {
      widget.destroy();
      client.destroy();
    },
  };
}

describe("placement: bubble (launcher, teaser, panel)", () => {
  it("renders a 54px launcher and a hidden panel", () => {
    const b = mountBubble();
    const launcher = b.launcher();
    expect(launcher).not.toBeNull();
    expect(launcher.style.width).toBe("54px");
    expect(launcher.style.height).toBe("54px");
    expect(launcher.style.backgroundColor).toContain("--ago-launcher-background");
    expect(launcher.getAttribute("aria-expanded")).toBe("false");
    expect(b.panel().style.display).toBe("none");
    expect(b.panel().getAttribute("aria-hidden")).toBe("true");
    b.cleanup();
  });

  it("shows the teaser after one second and opens the panel from it", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const b = mountBubble({ prompt: "Need a hand?", onOpen });
    vi.advanceTimersByTime(999);
    expect(b.teaser()).toBeNull();
    vi.advanceTimersByTime(1);
    const teaser = b.teaser();
    expect(teaser).not.toBeNull();
    expect(teaser!.textContent).toContain("Need a hand?");

    teaser!.querySelector<HTMLElement>(".ago-chat-widget-teaser__text")!.click();
    expect(b.panel().style.display).toBe("block");
    expect(b.teaser()).toBeNull();
    expect(onOpen).toHaveBeenCalledTimes(1);
    b.cleanup();
  });

  it("dismisses the teaser with its X without opening", () => {
    vi.useFakeTimers();
    const b = mountBubble();
    vi.advanceTimersByTime(1000);
    b.teaser()!.querySelector<HTMLButtonElement>(".ago-chat-widget-teaser__close")!.click();
    expect(b.teaser()).toBeNull();
    expect(b.panel().style.display).toBe("none");
    b.cleanup();
  });

  it("skips the teaser with prompt: false", () => {
    vi.useFakeTimers();
    const b = mountBubble({ prompt: false });
    vi.advanceTimersByTime(2000);
    expect(b.teaser()).toBeNull();
    b.cleanup();
  });

  it("toggles the panel from the launcher and closes from the header", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const b = mountBubble({ onOpen, onClose });
    b.launcher().click();
    expect(b.panel().style.display).toBe("block");
    expect(b.launcher().getAttribute("aria-expanded")).toBe("true");
    expect(b.launcher().getAttribute("aria-label")).toBe("Close AGO Chatbot");
    expect(onOpen).toHaveBeenCalledTimes(1);
    // Desktop: the launcher stays visible while open and toggles.
    expect(b.launcher().style.display).toBe("flex");

    b.panel().querySelector<HTMLButtonElement>(".ago-chat-widget__close")!.click();
    expect(b.panel().style.display).toBe("none");
    expect(onClose).toHaveBeenCalledTimes(1);

    b.launcher().click();
    b.launcher().click();
    expect(b.panel().style.display).toBe("none");
    b.cleanup();
  });

  it("closes on Escape unless typing in a field", () => {
    const b = mountBubble();
    b.widget.open!();
    const textarea = b.panel().querySelector("textarea")!;
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(b.panel().style.display).toBe("block");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(b.panel().style.display).toBe("none");
    b.cleanup();
  });

  it("shows the default title and a two-tab footer, Home active", () => {
    const b = mountBubble();
    expect(b.panel().querySelector(".ago-chat-widget__title")!.textContent).toBe(
      "AGO Chatbot",
    );
    const tabs = b.panel().querySelectorAll(".ago-chat-widget__tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute("aria-current")).toBe("page");
    expect(tabs[1].getAttribute("aria-current")).toBeNull();
    b.cleanup();
  });

  it("drops the footer with hideFooter", () => {
    const b = mountBubble({ hideFooter: true });
    expect(b.panel().querySelector(".ago-chat-widget__footer")).toBeNull();
    b.cleanup();
  });

  it("applies the width as --ago-panel-width and warns on an invalid one", () => {
    const b = mountBubble({ width: 700 });
    expect(b.panel().style.getPropertyValue("--ago-panel-width")).toBe("700px");
    b.cleanup();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = mountBubble({ width: "auto" });
    expect(bad.panel().style.getPropertyValue("--ago-panel-width")).toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    bad.cleanup();
  });

  it("derives the header text color from the header background", () => {
    const light = mountBubble({ theme: { headerBg: "#ffffff" } });
    const container = light.panel().querySelector<HTMLElement>(".ago-chat-widget")!;
    expect(container.style.getPropertyValue("--ago-header-text-color")).toBe(
      "#000000",
    );
    light.cleanup();

    const dark = mountBubble();
    const darkContainer = dark.panel().querySelector<HTMLElement>(".ago-chat-widget")!;
    expect(darkContainer.style.getPropertyValue("--ago-header-text-color")).toBe(
      "#FFFFFF",
    );
    dark.cleanup();
  });

  it("maps the embed snippet colors onto theme tokens, gradients included", () => {
    const b = mountBubble({
      colors: {
        button: "#ff0000",
        header: "linear-gradient(90deg, #03182f, #1b5fc4)",
        background: "#f0f0f0",
      },
    });
    const panel = b.panel();
    expect(panel.style.getPropertyValue("--ago-launcher-background")).toBe("#ff0000");
    expect(panel.style.getPropertyValue("--ago-send-button-background")).toBe("#ff0000");
    expect(panel.style.getPropertyValue("--ago-header-background")).toContain(
      "linear-gradient",
    );
    expect(panel.style.getPropertyValue("--ago-panel-background")).toBe("#f0f0f0");
    const header = panel.querySelector<HTMLElement>(".ago-chat-widget__header")!;
    expect(header.style.background).toContain("--ago-header-background");
    b.cleanup();
  });

  it("removes everything on destroy", () => {
    vi.useFakeTimers();
    const b = mountBubble();
    vi.advanceTimersByTime(1000);
    expect(b.teaser()).not.toBeNull();
    b.widget.destroy();
    expect(document.querySelector(".ago-chat-widget-bubble")).toBeNull();
    expect(document.querySelector(".ago-chat-widget-launcher")).toBeNull();
    expect(document.querySelector(".ago-chat-widget-teaser")).toBeNull();
    b.client.destroy();
  });
});

describe("placement: bubble (screens)", () => {
  it("lists threads newest first on the Chats screen and opens one", async () => {
    const b = mountBubble({}, [
      thread("old", 30 * HOUR, "Older"),
      thread("new", 5 * HOUR, "Newer"),
    ]);
    await flush();
    b.widget.showScreen!("history");
    expect(b.widget.screen).toBe("history");
    expect(b.panel().querySelector(".ago-chat-widget__title")!.textContent).toBe(
      "History",
    );
    const rows = b.panel().querySelectorAll<HTMLElement>(".ago-chat-widget__thread");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector("h3")!.textContent).toBe("Newer");
    expect(rows[0].textContent).toContain("5h ago");
    expect(rows[1].querySelector("h3")!.textContent).toBe("Older");
    expect(rows[1].textContent).toContain("1d ago");

    rows[0].click();
    await flush();
    expect(b.getSpy).toHaveBeenCalledWith("new");
    expect(b.widget.screen).toBe("chat");
    expect(b.panel().textContent).toContain("earlier answer");
    // Drill-in chrome: back chevron shown, footer hidden.
    const back = b.panel().querySelector<HTMLElement>(".ago-chat-widget__back")!;
    expect(back.style.display).toBe("flex");
    expect(
      b.panel().querySelector<HTMLElement>(".ago-chat-widget__footer")!.style.display,
    ).toBe("none");

    back.click();
    expect(b.widget.screen).toBe("history");
    b.cleanup();
  });

  it("shows the empty state when there are no threads", async () => {
    const b = mountBubble();
    await flush();
    b.widget.showScreen!("history");
    expect(b.panel().textContent).toContain("No chat history yet");
    b.cleanup();
  });

  it("starts a new conversation from the pill: home screen, thread forgotten", async () => {
    const b = mountBubble({}, [thread("t1", HOUR)]);
    await flush();
    // Auto-resumed into t1 (1h old).
    expect(b.widget.screen).toBe("chat");
    expect(b.widget.session!.getLastActiveThread()).toBe("t1");

    b.widget.showScreen!("history");
    b.panel()
      .querySelector<HTMLButtonElement>(".ago-chat-widget__new-conversation")!
      .click();
    expect(b.widget.screen).toBe("home");
    expect(b.widget.session!.getLastActiveThread()).toBeNull();

    const sendSpy = vi
      .spyOn(b.client, "sendMessage")
      .mockResolvedValue(assistant({ conversationId: "conv-9" }));
    await b.widget.sendMessage("hello");
    expect(sendSpy).toHaveBeenCalledWith("hello", {
      conversationId: undefined,
      files: undefined,
    });
    expect(b.widget.screen).toBe("chat");
    b.cleanup();
  });

  it("sends from the home screen and lands on the chat screen", async () => {
    const b = mountBubble();
    vi.spyOn(b.client, "sendMessage").mockResolvedValue(assistant());
    expect(b.widget.screen).toBe("home");
    // The composer lives on the home screen while it is shown.
    expect(b.panel().querySelector(".ago-chat-widget__home textarea")).not.toBeNull();
    await b.widget.sendMessage("hello");
    expect(b.widget.screen).toBe("chat");
    expect(b.panel().querySelector(".ago-chat-widget__chat textarea")).not.toBeNull();
    expect(b.panel().querySelector(".ago-message--user")!.textContent).toContain(
      "hello",
    );
    expect(b.panel().querySelector(".ago-message--assistant")!.textContent).toContain(
      "Hi there!",
    );
    b.cleanup();
  });

  it("renders the title lines, subtitle and starter cards on the home screen", async () => {
    const b = mountBubble({
      title: "Hello\nthere",
      subtitle: "Ask me **anything**",
      conversationStarters: [
        { label: "Pricing", message: "Tell me about pricing" },
        { label: "Support" },
      ],
    });
    const sendSpy = vi.spyOn(b.client, "sendMessage").mockResolvedValue(assistant());
    const home = b.panel().querySelector<HTMLElement>(".ago-chat-widget__home")!;
    expect(home.querySelectorAll(".ago-chat-widget__home-title > div")).toHaveLength(2);
    expect(home.querySelector(".ago-chat-widget__home-subtitle strong")!.textContent).toBe(
      "anything",
    );
    const cards = home.querySelectorAll<HTMLButtonElement>(".ago-chat-widget__starter");
    expect(cards).toHaveLength(2);
    cards[0].click();
    await flush();
    expect(sendSpy).toHaveBeenCalledWith(
      "Tell me about pricing",
      expect.anything(),
    );
    expect(b.widget.screen).toBe("chat");
    b.cleanup();
  });
});

describe("placement: bubble (auto-resume)", () => {
  it("reopens a thread whose last message is under two hours old", async () => {
    const b = mountBubble({}, [thread("fresh", HOUR)]);
    await flush();
    expect(b.getSpy).toHaveBeenCalledWith("fresh");
    expect(b.widget.screen).toBe("chat");
    b.cleanup();
  });

  it("stays home when the newest thread is stale", async () => {
    const b = mountBubble({}, [thread("stale", 3 * HOUR)]);
    await flush();
    expect(b.getSpy).not.toHaveBeenCalled();
    expect(b.widget.screen).toBe("home");
    b.cleanup();
  });

  it("stays home with autoResume: false", async () => {
    const b = mountBubble({ autoResume: false }, [thread("fresh", HOUR)]);
    await flush();
    expect(b.getSpy).not.toHaveBeenCalled();
    expect(b.widget.screen).toBe("home");
    b.cleanup();
  });

  it("does not redirect a visitor who already navigated", async () => {
    const b = mountBubble({}, [thread("fresh", HOUR)]);
    b.widget.showScreen!("history");
    await flush();
    expect(b.getSpy).not.toHaveBeenCalled();
    expect(b.widget.screen).toBe("history");
    b.cleanup();
  });

  it("resumes from the front-side cache before the list arrives", async () => {
    const storage = fakeStorage();
    // Seed the session with a fresh thread, as a previous visit would have.
    const first = mountBubble({ persistConversation: { storage } });
    first.widget.session!.setActiveThread("cached", Date.now());
    first.cleanup();

    const b = mountBubble({ persistConversation: { storage } });
    expect(b.widget.screen).toBe("chat");
    await flush();
    expect(b.getSpy).toHaveBeenCalledWith("cached");
    b.cleanup();
  });

  it("opens an explicit conversationId directly", async () => {
    const b = mountBubble({ conversationId: "given" }, [thread("fresh", HOUR)]);
    await flush();
    expect(b.getSpy).toHaveBeenCalledWith("given");
    expect(b.getSpy).not.toHaveBeenCalledWith("fresh");
    expect(b.widget.screen).toBe("chat");
    b.cleanup();
  });

  it("falls back to home when the cached thread no longer loads", async () => {
    const storage = fakeStorage();
    const first = mountBubble({ persistConversation: { storage } });
    first.widget.session!.setActiveThread("gone", Date.now());
    first.cleanup();

    const b = mountBubble({ persistConversation: { storage } });
    b.getSpy.mockRejectedValue(new Error("404"));
    // The mount already kicked off the load with the earlier mock; wait for it.
    await flush();
    // Re-open to exercise the failure path explicitly.
    await b.widget.openConversation!("gone");
    expect(b.widget.screen).toBe("home");
    expect(b.widget.session!.getLastActiveThread()).toBeNull();
    b.cleanup();
  });
});

describe("placement: bubble (mobile)", () => {
  function stubCompact(matches: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width") ? matches : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }

  it("goes full screen, hides the launcher and locks the page while open", () => {
    stubCompact(true);
    const b = mountBubble();
    b.widget.open!();
    expect(b.panel().dataset.agoLayout).toBe("fullscreen");
    expect(b.launcher().style.display).toBe("none");
    expect(document.body.style.position).toBe("fixed");
    const container = b.panel().querySelector<HTMLElement>(".ago-chat-widget")!;
    expect(container.getAttribute("role")).toBe("dialog");

    b.widget.close!();
    expect(b.launcher().style.display).toBe("flex");
    expect(document.body.style.position).not.toBe("fixed");
    expect(container.getAttribute("role")).toBeNull();
    b.cleanup();
  });

  it("keeps the desktop panel geometry when not compact", () => {
    stubCompact(false);
    const b = mountBubble();
    b.widget.open!();
    expect(b.panel().dataset.agoLayout).toBe("panel");
    expect(b.panel().style.borderRadius).toBe("16px");
    b.cleanup();
  });
});

describe("placement: bubble (loadHomeConfig)", () => {
  const homePage = {
    title: "How can we help?",
    subtitle: "Answers from the **docs**",
    starters: [
      {
        id: "s1",
        label: "How much does it cost?",
        message: "Tell me about pricing",
        agentId: "ag-sales",
      },
    ],
  };

  /** The dashboard config, with only the fields the home screen reads. */
  function stubConfig(home: unknown): (client: AgoClient) => void {
    return (client) => {
      vi.spyOn(client, "getConfig").mockResolvedValue({
        permissions: [
          {
            agents: [],
            fileAttachmentsEnabled: false,
            voiceEnabled: false,
            ...(home ? { homePage: home } : {}),
          },
        ],
        proactive: { enabled: false },
      } as Awaited<ReturnType<AgoClient["getConfig"]>>);
    };
  }

  it("does not fetch the config unless asked", async () => {
    let configSpy: ReturnType<typeof vi.spyOn> | undefined;
    const b = mountBubble({ title: "Ask AGO" }, [], (client) => {
      configSpy = vi.spyOn(client, "getConfig");
    });
    await flush();
    expect(configSpy).not.toHaveBeenCalled();
    b.cleanup();
  });

  it("replaces the home title, subtitle and starters with the dashboard's", async () => {
    const b = mountBubble(
      {
        loadHomeConfig: true,
        title: "Ask AGO",
        subtitle: "hardcoded",
        conversationStarters: [{ label: "hardcoded card" }],
      },
      [],
      stubConfig(homePage),
    );
    const sendSpy = vi.spyOn(b.client, "sendMessage").mockResolvedValue(assistant());
    await flush();

    const home = b.panel().querySelector<HTMLElement>(".ago-chat-widget__home")!;
    expect(home.querySelector(".ago-chat-widget__home-title")!.textContent).toBe(
      "How can we help?",
    );
    expect(home.querySelector(".ago-chat-widget__home-subtitle strong")!.textContent).toBe(
      "docs",
    );
    // The header keeps the option's title, as in the hosted widget.
    expect(b.panel().querySelector(".ago-chat-widget__header")!.textContent).toContain(
      "Ask AGO",
    );

    const cards = home.querySelectorAll<HTMLButtonElement>(".ago-chat-widget__starter");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("How much does it cost?");
    cards[0].click();
    await flush();
    expect(sendSpy).toHaveBeenCalledWith(
      "Tell me about pricing",
      expect.objectContaining({ agentId: "ag-sales" }),
    );
    b.cleanup();
  });

  it("keeps what the options set for anything the dashboard leaves empty", async () => {
    const b = mountBubble(
      {
        loadHomeConfig: true,
        title: "Ask AGO",
        subtitle: "kept",
        conversationStarters: [{ label: "kept card" }],
      },
      [],
      stubConfig({ starters: [] }),
    );
    await flush();
    const home = b.panel().querySelector<HTMLElement>(".ago-chat-widget__home")!;
    expect(home.querySelector(".ago-chat-widget__home-title")!.textContent).toBe("Ask AGO");
    expect(home.querySelector(".ago-chat-widget__home-subtitle")!.textContent).toBe("kept");
    expect(home.querySelectorAll(".ago-chat-widget__starter")).toHaveLength(1);
    b.cleanup();
  });

  it("keeps the home screen when the config request fails", async () => {
    const b = mountBubble({ loadHomeConfig: true, title: "Ask AGO" }, [], (client) => {
      vi.spyOn(client, "getConfig").mockRejectedValue(new Error("offline"));
    });
    await flush();
    expect(
      b.panel().querySelector(".ago-chat-widget__home-title")!.textContent,
    ).toBe("Ask AGO");
    b.cleanup();
  });

  it("sends the dashboard's widget starter when the panel is first opened", async () => {
    const b = mountBubble(
      { loadHomeConfig: true },
      [],
      stubConfig({
        ...homePage,
        widgetStarter: { id: "ws1", message: "Hi! Anything I can look up?" },
      }),
    );
    const sendSpy = vi.spyOn(b.client, "sendMessage").mockResolvedValue(assistant());
    await flush();
    await flush();
    // Nothing is spent on a visitor who never clicks the launcher.
    expect(sendSpy).not.toHaveBeenCalled();

    b.launcher().click();
    await flush();
    expect(sendSpy).toHaveBeenCalledWith(
      "Hi! Anything I can look up?",
      expect.anything(),
    );
    expect(b.widget.screen).toBe("chat");
    b.cleanup();
  });

  it("skips the widget starter when a thread is resumed instead", async () => {
    const b = mountBubble(
      { loadHomeConfig: true },
      [thread("fresh", HOUR)],
      stubConfig({
        ...homePage,
        widgetStarter: { id: "ws1", message: "Hi! Anything I can look up?" },
      }),
    );
    const sendSpy = vi.spyOn(b.client, "sendMessage").mockResolvedValue(assistant());
    await flush();
    await flush();
    b.launcher().click();
    await flush();
    expect(b.getSpy).toHaveBeenCalledWith("fresh");
    expect(sendSpy).not.toHaveBeenCalled();
    b.cleanup();
  });
});
