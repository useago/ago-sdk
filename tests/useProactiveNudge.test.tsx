import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgoProvider } from "../src/react/context/AgoContext";
import { AgoNudge } from "../src/react/components/AgoNudge";
import {
  useProactiveNudge,
  type UseProactiveNudgeResult,
} from "../src/react/hooks/useProactiveNudge";
import { createMockClient, type MockAgoClient } from "../src/testing/createMockClient";
import type {
  ProactiveController,
  ProactiveNudgeInstance,
} from "../src/proactive/types";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeNudge(
  overrides: Partial<ProactiveNudgeInstance> = {}
): ProactiveNudgeInstance {
  return {
    id: "n1",
    triggerId: "t1",
    source: "static",
    message: "Need a hand with this page?",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeController(): ProactiveController {
  return {
    optOut: vi.fn(),
    optIn: vi.fn(),
    isOptedOut: vi.fn(() => false),
    setEngaged: vi.fn(),
    signalFieldError: vi.fn(),
    getSignalsSnapshot: vi.fn(),
    getActiveNudge: vi.fn(() => null),
    shown: vi.fn(),
    accept: vi.fn(async () => {}),
    dismiss: vi.fn(),
    markConverted: vi.fn(),
    destroy: vi.fn(),
  } as unknown as ProactiveController;
}

let container: HTMLDivElement;
let root: Root;
let mock: MockAgoClient;
let controller: ProactiveController;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mock = createMockClient();
  controller = makeController();
  mock.proactive = controller;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("useProactiveNudge", () => {
  let latest: UseProactiveNudgeResult;

  function Harness({ onExpand }: { onExpand?: (n: ProactiveNudgeInstance) => void }) {
    latest = useProactiveNudge({ onExpand });
    return <span>{latest.nudge ? latest.nudge.message : "none"}</span>;
  }

  async function mount(onExpand?: (n: ProactiveNudgeInstance) => void) {
    await act(async () => {
      root.render(
        <AgoProvider client={mock}>
          <Harness onExpand={onExpand} />
        </AgoProvider>
      );
    });
  }

  it("starts with no nudge, surfaces nudge:ready, and marks it shown", async () => {
    await mount();
    expect(latest.nudge).toBeNull();

    const nudge = makeNudge();
    await act(async () => {
      mock.__emitEvent("nudge:ready", nudge);
    });

    expect(latest.nudge).toEqual(nudge);
    expect(controller.shown).toHaveBeenCalledWith(nudge);
    expect(container.textContent).toContain("Need a hand with this page?");
  });

  it("accept() delegates to the controller and expands goal-bearing nudges", async () => {
    const onExpand = vi.fn();
    await mount(onExpand);

    const nudge = makeNudge({ goal: "finish checkout" });
    await act(async () => {
      mock.__emitEvent("nudge:ready", nudge);
    });
    await act(async () => {
      await latest.accept();
    });

    expect(controller.accept).toHaveBeenCalledWith(nudge);
    expect(onExpand).toHaveBeenCalledWith(nudge);
    expect(latest.nudge).toBeNull();
  });

  it("accept() does not expand a plain static nudge (no goal, not agent)", async () => {
    const onExpand = vi.fn();
    await mount(onExpand);

    await act(async () => {
      mock.__emitEvent("nudge:ready", makeNudge());
    });
    await act(async () => {
      await latest.accept();
    });

    expect(onExpand).not.toHaveBeenCalled();
  });

  it("dismiss() delegates to the controller and clears the nudge", async () => {
    await mount();
    const nudge = makeNudge();
    await act(async () => {
      mock.__emitEvent("nudge:ready", nudge);
    });
    await act(async () => {
      latest.dismiss();
    });

    expect(controller.dismiss).toHaveBeenCalledWith(nudge);
    expect(latest.nudge).toBeNull();
  });

  it("clears the nudge when it is resolved elsewhere (another consumer)", async () => {
    await mount();
    const nudge = makeNudge();
    await act(async () => {
      mock.__emitEvent("nudge:ready", nudge);
    });
    await act(async () => {
      mock.__emitEvent("nudge:dismissed", { nudge });
    });
    expect(latest.nudge).toBeNull();
  });
});

describe("<AgoNudge />", () => {
  async function mountNudge(props: Partial<React.ComponentProps<typeof AgoNudge>> = {}) {
    await act(async () => {
      root.render(
        <AgoProvider client={mock}>
          <AgoNudge {...props} />
        </AgoProvider>
      );
    });
  }

  it("renders nothing until a nudge is ready, then a dismissable toast", async () => {
    await mountNudge();
    expect(container.querySelector(".ago-nudge")).toBeNull();

    const nudge = makeNudge();
    await act(async () => {
      mock.__emitEvent("nudge:ready", nudge);
    });

    const toast = container.querySelector(".ago-nudge");
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toContain("Need a hand with this page?");

    const close = container.querySelector<HTMLButtonElement>(".ago-nudge__close");
    expect(close).not.toBeNull();
    await act(async () => {
      close!.click();
    });
    expect(controller.dismiss).toHaveBeenCalledWith(nudge);
    expect(container.querySelector(".ago-nudge")).toBeNull();
  });

  it("renders the action button and accepts through it", async () => {
    await mountNudge();
    const nudge = makeNudge({
      action: { label: "Pré-remplir", functionName: "prefillForm" },
    });
    await act(async () => {
      mock.__emitEvent("nudge:ready", nudge);
    });

    const action = container.querySelector<HTMLButtonElement>(".ago-nudge__action");
    expect(action).not.toBeNull();
    expect(action!.textContent).toBe("Pré-remplir");
    await act(async () => {
      action!.click();
    });
    expect(controller.accept).toHaveBeenCalledWith(nudge);
  });

  it("shows the open-chat affordance for agent nudges and expands on click", async () => {
    const onExpand = vi.fn();
    await mountNudge({ onExpand, openChatLabel: "Ouvrir le chat" });
    const nudge = makeNudge({ source: "agent", serverNudgeId: "s1" });
    await act(async () => {
      mock.__emitEvent("nudge:ready", nudge);
    });

    const expand = container.querySelector<HTMLButtonElement>(".ago-nudge__expand");
    expect(expand).not.toBeNull();
    expect(expand!.textContent).toBe("Ouvrir le chat");
    await act(async () => {
      expand!.click();
    });
    expect(controller.accept).toHaveBeenCalledWith(nudge);
    expect(onExpand).toHaveBeenCalledWith(nudge);
  });

  it("auto-hides (as a dismissal) when autoHideMs is set", async () => {
    vi.useFakeTimers();
    try {
      await mountNudge({ autoHideMs: 3000 });
      const nudge = makeNudge();
      await act(async () => {
        mock.__emitEvent("nudge:ready", nudge);
      });
      expect(container.querySelector(".ago-nudge")).not.toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(controller.dismiss).toHaveBeenCalledWith(nudge);
      expect(container.querySelector(".ago-nudge")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
