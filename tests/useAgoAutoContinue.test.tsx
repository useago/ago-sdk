import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../src/client/AgoClient";
import { AgoProvider } from "../src/react/context/AgoContext";
import { useAgoAutoContinueAfterNavigation } from "../src/react/hooks/useAgoAutoContinue";
import type { AgoMessage } from "../src/client/types";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function emit(client: AgoClient, event: string, payload: unknown) {
  (
    client as unknown as { eventEmitter: { emit: (e: string, p: unknown) => void } }
  ).eventEmitter.emit(event, payload);
}

function navigate(client: AgoClient, conversationId = "c1") {
  emit(client, "function:invoke", {
    functionName: "navigateToPage",
    arguments: {},
    conversationId,
    invocationId: "inv1",
  });
}

function complete(client: AgoClient, conversationId = "c1") {
  emit(client, "message:complete", {
    id: "m1",
    conversationId,
    content: "",
    role: "assistant",
    status: "DONE",
    createdAt: new Date(),
  } satisfies AgoMessage);
}

function registerPageState(client: AgoClient) {
  client.registerPageStateFunction([
    { name: "flavorFilter", description: "Filter", schema: { type: "string" }, get: () => "all", set: () => {} },
  ]);
}

async function mount(client: AgoClient, Component: React.FC) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <AgoProvider client={client}>
        <Component />
      </AgoProvider>
    );
  });
  return { root };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("useAgoAutoContinueAfterNavigation", () => {
  it("sends a hidden continuation once the destination registers page-state", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const send = vi.spyOn(client, "sendMessage").mockResolvedValue({} as AgoMessage);

    function Harness() {
      useAgoAutoContinueAfterNavigation({ settleMs: 0, readinessTimeoutMs: 200 });
      return <span>ok</span>;
    }
    const { root } = await mount(client, Harness);

    await act(async () => {
      navigate(client);
      registerPageState(client); // destination page mounted its useAgoPageState
      complete(client);
      await tick(30);
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.any(String), {
      conversationId: "c1",
      hidden: true,
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("does not continue when the destination has no page-state (timeout)", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const send = vi.spyOn(client, "sendMessage").mockResolvedValue({} as AgoMessage);

    function Harness() {
      useAgoAutoContinueAfterNavigation({ settleMs: 0, readinessTimeoutMs: 20 });
      return <span>ok</span>;
    }
    const { root } = await mount(client, Harness);

    await act(async () => {
      navigate(client);
      complete(client);
      await tick(60); // past the readiness timeout
    });

    expect(send).not.toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
  });

  it("ignores turns that did not call a navigation function", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const send = vi.spyOn(client, "sendMessage").mockResolvedValue({} as AgoMessage);

    function Harness() {
      useAgoAutoContinueAfterNavigation({ settleMs: 0, readinessTimeoutMs: 200 });
      return <span>ok</span>;
    }
    const { root } = await mount(client, Harness);

    await act(async () => {
      emit(client, "function:invoke", {
        functionName: "showToast",
        arguments: {},
        conversationId: "c1",
        invocationId: "inv1",
      });
      registerPageState(client);
      complete(client);
      await tick(30);
    });

    expect(send).not.toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
  });

  it("respects a custom navigationFunctions list", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const send = vi.spyOn(client, "sendMessage").mockResolvedValue({} as AgoMessage);

    function Harness() {
      useAgoAutoContinueAfterNavigation({
        navigationFunctions: ["openThing"],
        settleMs: 0,
        readinessTimeoutMs: 200,
      });
      return <span>ok</span>;
    }
    const { root } = await mount(client, Harness);

    await act(async () => {
      emit(client, "function:invoke", {
        functionName: "openThing",
        arguments: {},
        conversationId: "c1",
        invocationId: "inv1",
      });
      registerPageState(client);
      complete(client);
      await tick(30);
    });

    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.unmount();
    });
  });

  it("cancels a pending continuation when the user starts a new turn", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const send = vi.spyOn(client, "sendMessage").mockResolvedValue({} as AgoMessage);

    function Harness() {
      useAgoAutoContinueAfterNavigation({ settleMs: 0, readinessTimeoutMs: 200 });
      return <span>ok</span>;
    }
    const { root } = await mount(client, Harness);

    await act(async () => {
      navigate(client);
      complete(client); // begins waiting for page-state (not registered yet)
      emit(client, "message:start", { conversationId: "c1", messageId: "m2" }); // user moved on
      registerPageState(client); // fires context:changed, but run was cancelled
      await tick(30);
    });

    expect(send).not.toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
  });
});
