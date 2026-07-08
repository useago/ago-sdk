import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { AgoClient } from "../src/client/AgoClient";
import {
  useAgoActivity,
  type UseAgoActivityOptions,
  type UseAgoActivityResult,
} from "../src/react/hooks/useAgoActivity";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A minimal event-bus fake standing in for AgoClient: useAgoActivity only needs
// on/off plus the approve/reject/submit methods, and lets the test drive events.
function makeFakeClient() {
  const handlers: Record<string, Array<(d: unknown) => void>> = {};
  const client = {
    on: (event: string, h: (d: unknown) => void) => {
      (handlers[event] ||= []).push(h);
    },
    off: (event: string, h: (d: unknown) => void) => {
      handlers[event] = (handlers[event] || []).filter((x) => x !== h);
    },
    emit: (event: string, data: unknown) => {
      for (const h of handlers[event] || []) h(data);
    },
    approveFunction: vi.fn(async () => {}),
    rejectFunction: vi.fn(async () => {}),
    confirmToolCall: vi.fn(async () => {}),
    rejectToolCall: vi.fn(async () => {}),
    submitToolCallForm: vi.fn(async () => ({ status: "ok" })),
  };
  return client;
}

type Fake = ReturnType<typeof makeFakeClient>;

async function mountHook(client: Fake, opts?: Omit<UseAgoActivityOptions, "client">) {
  const ref: { current: UseAgoActivityResult | null } = { current: null };
  function Harness() {
    ref.current = useAgoActivity({ client: client as unknown as AgoClient, ...opts });
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
  const emit = async (event: string, data: unknown) => {
    await act(async () => {
      client.emit(event, data);
    });
  };
  return { ref, root, emit };
}

describe("useAgoActivity: normalization", () => {
  it("turns a navigation invocation into a labeled, running→done item", async () => {
    const client = makeFakeClient();
    const { ref, emit } = await mountHook(client);

    await emit("message:start", { conversationId: "c1", messageId: "m1" });
    await emit("function:invoke", {
      invocationId: "inv1",
      functionName: "navigateToPage",
      arguments: { page: "products" },
      conversationId: "c1",
    });

    expect(ref.current!.items).toHaveLength(1);
    const item = ref.current!.items[0];
    expect(item.kind).toBe("navigation");
    expect(item.label).toBe("Navigating to Products");
    expect(item.status).toBe("running");
    expect(item.messageId).toBe("m1");
    expect(ref.current!.latest?.id).toBe("inv1");

    await emit("function:result", { invocationId: "inv1", result: { success: true } });
    expect(ref.current!.items[0].status).toBe("done");
  });

  it("suppresses reasoning by default and includes it when asked", async () => {
    const reasoning = {
      id: "r1",
      type: "reasoning",
      status: "completed",
      toolName: "",
      message: "thinking hard",
    };

    const off = makeFakeClient();
    const a = await mountHook(off);
    await a.emit("toolCall:received", reasoning);
    expect(a.ref.current!.items).toHaveLength(0);

    const on = makeFakeClient();
    const b = await mountHook(on, { includeReasoning: true });
    await b.emit("toolCall:received", reasoning);
    expect(b.ref.current!.items).toHaveLength(1);
    expect(b.ref.current!.items[0].kind).toBe("reasoning");
  });

  it("lets labelFor override the default label", async () => {
    const client = makeFakeClient();
    const { ref, emit } = await mountHook(client, {
      labelFor: (i) =>
        i.kind === "navigation" ? `Go → ${String(i.arguments?.page)}` : undefined,
    });

    await emit("function:invoke", {
      invocationId: "inv1",
      functionName: "navigateToPage",
      arguments: { page: "products" },
      conversationId: "c1",
    });
    expect(ref.current!.items[0].label).toBe("Go → products");
  });

  it("settles still-running items to done when the turn completes", async () => {
    const client = makeFakeClient();
    const { ref, emit } = await mountHook(client);
    await emit("function:invoke", {
      invocationId: "inv1",
      functionName: "navigateToPage",
      arguments: { page: "products" },
      conversationId: "c1",
    });
    expect(ref.current!.items[0].status).toBe("running");
    await emit("message:complete", { id: "m1" });
    expect(ref.current!.items[0].status).toBe("done");
  });
});

describe("useAgoActivity: approvals", () => {
  it("marks a gated function awaiting-approval and routes approve to approveFunction", async () => {
    const client = makeFakeClient();
    const { ref, emit } = await mountHook(client);

    await emit("function:invoke", {
      invocationId: "inv1",
      functionName: "setPageState",
      arguments: { statusFilter: "pending" },
      conversationId: "c1",
    });
    await emit("function:awaiting-approval", {
      invocationId: "inv1",
      functionName: "setPageState",
      arguments: { statusFilter: "pending" },
      conversationId: "c1",
    });

    const item = ref.current!.items[0];
    expect(item.kind).toBe("action");
    expect(item.status).toBe("awaiting-approval");
    expect(item.requiresApproval).toBe(true);
    expect(ref.current!.isAwaitingApproval).toBe(true);

    await act(async () => {
      await ref.current!.approve("inv1");
    });
    expect(client.approveFunction).toHaveBeenCalledWith("inv1");
    expect(client.confirmToolCall).not.toHaveBeenCalled();
  });

  it("routes a confirmation tool call to confirmToolCall / rejectToolCall", async () => {
    const client = makeFakeClient();
    const { ref, emit } = await mountHook(client);

    await emit("toolCall:received", {
      id: "cf1",
      type: "confirmation_input",
      status: "waiting_confirmation",
      toolName: "delete_thing",
      message: "Delete it?",
    });
    expect(ref.current!.items[0].requiresApproval).toBe(true);
    expect(ref.current!.isAwaitingApproval).toBe(true);

    await act(async () => {
      await ref.current!.reject("cf1");
    });
    expect(client.rejectToolCall).toHaveBeenCalledWith("cf1");
    expect(ref.current!.items[0].status).toBe("rejected");
  });

  it("submitForm forwards to submitToolCallForm and marks the item done", async () => {
    const client = makeFakeClient();
    const { ref, emit } = await mountHook(client);

    await emit("toolCall:received", {
      id: "f1",
      type: "form",
      status: "waiting_input",
      toolName: "ticket",
      message: "Fill it",
      formSchema: { type: "object", properties: {} },
    });

    await act(async () => {
      await ref.current!.submitForm("f1", { subject: "hi" });
    });
    expect(client.submitToolCallForm).toHaveBeenCalledWith("f1", { subject: "hi" });
    expect(ref.current!.items[0].status).toBe("done");
  });
});
