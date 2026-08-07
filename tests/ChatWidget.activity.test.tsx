import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgoClient } from "../src/client/AgoClient";
import { AgoProvider } from "../src/react/context/AgoContext";
import { ChatWidget } from "../src/react/components/ChatWidget";
import type { AgoMessage } from "../src/client/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A client we drive by hand, so a turn can be paused mid-flight. */
function createDrivableClient() {
  const handlers: Record<string, Array<(data: unknown) => void>> = {};
  const emit = (event: string, data: unknown) =>
    (handlers[event] ?? []).forEach((h) => h(data));
  const client = {
    on: (e: string, h: (data: unknown) => void) => {
      (handlers[e] ??= []).push(h);
    },
    off: (e: string, h: (data: unknown) => void) => {
      handlers[e] = (handlers[e] ?? []).filter((x) => x !== h);
    },
    sendMessage: vi.fn(() => new Promise<AgoMessage>(() => {})),
    stop: vi.fn(async () => null),
    getMessages: vi.fn(async () => []),
    approveFunction: vi.fn(async () => {}),
    rejectFunction: vi.fn(async () => {}),
  } as unknown as AgoClient;
  return { client, emit };
}

const streamingMessage: AgoMessage = {
  id: "m1",
  conversationId: "c1",
  role: "assistant",
  content: "",
  status: "IN_PROGRESS",
} as AgoMessage;

let roots: Root[] = [];
let containers: HTMLElement[] = [];

async function mount(client: AgoClient, node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(<AgoProvider client={client}>{node}</AgoProvider>);
  });
  return container;
}

afterEach(async () => {
  for (const root of roots) {
    await act(async () => root.unmount());
  }
  for (const c of containers) c.remove();
  roots = [];
  containers = [];
});

/** Drive a turn to the point where a client function is running. */
function startCall(
  emit: (e: string, d: unknown) => void,
  functionName: string,
  args: Record<string, unknown> = {}
) {
  emit("message:start", { conversationId: "c1", messageId: "m1" });
  emit("message:chunk", {
    content: "",
    conversationId: "c1",
    messageId: "m1",
    message: streamingMessage,
  });
  emit("stream:message", streamingMessage);
  emit("function:invoke", {
    invocationId: "inv-1",
    functionName,
    arguments: args,
    conversationId: "c1",
  });
}

describe("ChatWidget: what the agent is doing", () => {
  it("names the running client function instead of showing only dots", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
    });

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    // No mapping given: the function name is prettified by default.
    expect(status!.textContent).toContain("Lookup Flavor Prices");
  });

  it("uses a caller-supplied label", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(
      client,
      <ChatWidget
        functionLabels={{ lookupFlavorPrices: "Je regarde les prix" }}
      />
    );

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
    });

    expect(container.querySelector('[role="status"]')!.textContent).toContain(
      "Je regarde les prix"
    );
  });

  it("accepts a function for labels, with the call arguments", async () => {
    const { client, emit } = createDrivableClient();
    const seen: Record<string, unknown>[] = [];
    const container = await mount(
      client,
      <ChatWidget
        functionLabels={(name, args) => {
          seen.push(args);
          return `${name} -> ${String(args.priceSource)}`;
        }}
      />
    );

    await act(async () => {
      startCall(emit, "setPageState", { priceSource: "marche" });
    });

    expect(container.querySelector('[role="status"]')!.textContent).toContain(
      "setPageState -> marche"
    );
    expect(seen[0]).toEqual({ priceSource: "marche" });
  });

  it("keeps the label after the call returns, so a fast call is readable", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
      // A 40 ms call: clearing here is what made the row unreadable.
      emit("function:result", { invocationId: "inv-1", result: { ok: true } });
    });

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain("Lookup Flavor Prices");
  });

  it("is replaced by the next function, not blanked between the two", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
      emit("function:result", { invocationId: "inv-1", result: { ok: true } });
    });
    expect(container.querySelector('[role="status"]')!.textContent).toContain(
      "Lookup Flavor Prices"
    );

    await act(async () => {
      emit("function:invoke", {
        invocationId: "inv-2",
        functionName: "setPageState",
        arguments: {},
        conversationId: "c1",
      });
    });

    expect(container.querySelector('[role="status"]')!.textContent).toContain(
      "Updating the page"
    );
  });

  it("shows the agent's reasoning steps too", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
      emit("function:result", { invocationId: "inv-1", result: { ok: true } });
      emit("toolCall:received", {
        id: "r1",
        type: "reasoning",
        status: "completed",
        message: "Je compare les deux tarifs",
      });
    });

    expect(container.querySelector('[role="status"]')!.textContent).toContain(
      "Je compare les deux tarifs"
    );
  });

  it("showReasoning={false} keeps the function step instead", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget showReasoning={false} />);

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
      emit("toolCall:received", {
        id: "r1",
        type: "reasoning",
        status: "completed",
        message: "Je compare les deux tarifs",
      });
    });

    const text = container.querySelector('[role="status"]')!.textContent!;
    expect(text).toContain("Lookup Flavor Prices");
    expect(text).not.toContain("Je compare");
  });

  it("goes away when the turn ends", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
      emit("function:result", { invocationId: "inv-1", result: { ok: true } });
    });
    expect(container.querySelector('[role="status"]')).not.toBeNull();

    await act(async () => {
      emit("message:complete", {
        ...streamingMessage,
        content: "Voilà.",
        status: "DONE",
      });
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("does not open a new turn with the previous turn's step", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
      emit("function:result", { invocationId: "inv-1", result: { ok: true } });
      emit("message:complete", {
        ...streamingMessage,
        content: "Voilà.",
        status: "DONE",
      });
    });

    // Second turn: a new assistant message, nothing called yet.
    const second = { ...streamingMessage, id: "m2" } as AgoMessage;
    await act(async () => {
      emit("message:start", { conversationId: "c1", messageId: "m2" });
      emit("stream:message", second);
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("says when a call is held for approval", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      startCall(emit, "placeOrder");
      emit("function:awaiting-approval", {
        invocationId: "inv-1",
        functionName: "placeOrder",
        arguments: {},
        conversationId: "c1",
      });
    });

    // Still visible, and still the running row rather than a silent spinner.
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("functionLabels={false} keeps the plain indicator", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget functionLabels={false} />);

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("drops the empty answer bubble's dots while the row is up", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      startCall(emit, "navigateToPage", { page: "flavors" });
    });

    // The bug in the wild: the empty assistant bubble kept pulsing its dots
    // right above a row that already said "Je change de page".
    expect(container.innerHTML).not.toContain("ago-pulse");
    expect(container.querySelector(".ago-message__content")).toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("keeps the dots when there is no activity row to replace them", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      emit("message:start", { conversationId: "c1", messageId: "m1" });
      emit("stream:message", streamingMessage);
    });

    // Nothing called yet: the dots are still the only signal, so they stay.
    expect(container.innerHTML).toContain("ago-pulse");
  });

  it("shows no dots next to the label: the text is the indicator", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
    });

    const row = container.querySelector(".ago-activity")!;
    // The pulsing dots animate via `ago-pulse`; none of them belong in a row
    // that already spells out what is happening.
    expect(row.innerHTML).not.toContain("ago-pulse");
    expect(row.querySelector(".ago-activity__label")!.textContent).toBe(
      "Lookup Flavor Prices"
    );
  });

  it("renders simple markdown in the label", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
      emit("toolCall:received", {
        id: "r1",
        type: "reasoning",
        status: "completed",
        message: "Je compare **maison** et `coursDuJour`",
      });
    });

    const label = container.querySelector(".ago-activity__label")!;
    expect(label.querySelector("strong")?.textContent).toBe("maison");
    expect(label.querySelector("code")?.textContent).toBe("coursDuJour");
    // The delimiters themselves are gone, not shown literally.
    expect(label.textContent).toBe("Je compare maison et coursDuJour");
  });

  it("leaves unmatched markdown as literal text, and escapes HTML", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
      emit("toolCall:received", {
        id: "r1",
        type: "reasoning",
        status: "completed",
        message: "2 * 3 <b>pas du gras</b>",
      });
    });

    const label = container.querySelector(".ago-activity__label")!;
    expect(label.querySelector("b")).toBeNull();
    expect(label.textContent).toBe("2 * 3 <b>pas du gras</b>");
  });

  it("animates the label, and remounts it on each step for continuity", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
    });
    const first = container.querySelector(".ago-activity__label")!;
    const css = container.querySelector(".ago-activity style")!.textContent!;

    // A sweep that keeps travelling: a step sitting for seconds still looks
    // alive. And an enter animation so one step gives way to the next.
    expect(css).toContain("@keyframes ago-activity-sweep");
    expect(css).toContain("@keyframes ago-activity-enter");
    expect(css).toContain("infinite");

    await act(async () => {
      emit("function:invoke", {
        invocationId: "inv-2",
        functionName: "setPageState",
        arguments: {},
        conversationId: "c1",
      });
    });
    const second = container.querySelector(".ago-activity__label")!;

    // Keyed on the text: React swaps the node, so the enter animation replays
    // instead of the characters changing in place.
    expect(second).not.toBe(first);
    expect(second.textContent).toBe("Updating the page");
  });

  it("keeps the same node while the label is unchanged", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
    });
    const first = container.querySelector(".ago-activity__label")!;

    await act(async () => {
      // Same step, now finished: nothing to re-announce, so no restart.
      emit("function:result", { invocationId: "inv-1", result: { ok: true } });
    });

    expect(container.querySelector(".ago-activity__label")).toBe(first);
  });

  it("is themeable and respects reduced motion", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      startCall(emit, "lookupFlavorPrices");
    });

    const row = container.querySelector(".ago-activity") as HTMLElement;
    const css = container.querySelector(".ago-activity style")!.textContent!;

    // Colours go through --ago-* tokens rather than being baked in.
    expect(row.style.color).toContain("--ago-activity-color");
    expect(row.style.backgroundColor).toContain("--ago-activity-bg");
    expect(css).toContain("--ago-activity-sheen");
    // Every rule stays scoped; nothing leaks to the host page. Drop the
    // @keyframes bodies first (`from`/`to` are stops, not selectors).
    const withoutKeyframes = css.replace(
      /@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
      ""
    );
    const selectors = [...withoutKeyframes.matchAll(/([^{}@]+)\{/g)]
      .map((m) => m[1].trim())
      // `supports (...)` / `media (...)` are at-rule preludes, not selectors:
      // the `@` is stripped by the character class above.
      .filter((s) => !/^(supports|media)\b/.test(s));
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector.startsWith(".ago-")).toBe(true);
    }
    expect(css).toContain("prefers-reduced-motion");
    // The sheen hides the text colour, so it must be guarded.
    expect(css).toContain("@supports");
  });

  it("shows nothing when no function is running", async () => {
    const { client, emit } = createDrivableClient();
    const container = await mount(client, <ChatWidget />);

    await act(async () => {
      emit("message:start", { conversationId: "c1", messageId: "m1" });
      emit("stream:message", streamingMessage);
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
