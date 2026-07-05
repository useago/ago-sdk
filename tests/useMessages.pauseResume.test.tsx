import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../src/client/AgoClient";
import { useMessages, type UseMessagesResult } from "../src/react/hooks/useMessages";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200 });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const PAUSED_STREAM = [
  'data: {"message_id":"m1","thread":{"id":"c1"},"status":"IN_PROGRESS"}\n\n',
  'data: {"tool_call_data":true,"type":"client_function","status":"waiting_input","id":"bag1","function_name":"navigateToPage","arguments":{"page":"parfums"},"thread":{"id":"c1"}}\n\n',
  'data: {"message_id":"m1","thread":{"id":"c1"},"status":"WAITING_CLIENT","waiting_tool_call_ids":["bag1"]}\n\n',
];

const RESUMED_STREAM = [
  'data: {"message_id":"m1","thread":{"id":"c1"},"status":"IN_PROGRESS"}\n\n',
  'data: {"content":"Vous ","message_id":"m1","thread":{"id":"c1"}}\n\n',
  'data: {"content":"y êtes.","message_id":"m1","thread":{"id":"c1"}}\n\n',
  'data: {"message_id":"m1","thread":{"id":"c1"},"status":"DONE"}\n\n',
];

function stubPauseResumeFetch() {
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/messages")) return sseResponse(PAUSED_STREAM);
    if (u.includes("/tool-calls/bag1/submit")) {
      return jsonResponse({ status: "completed", resume: { message_id: "m1", ready: true } });
    }
    if (u.endsWith("/messages/m1/continue")) return sseResponse(RESUMED_STREAM);
    throw new Error(`Unmatched fetch: ${u}`);
  });
}

async function mountUseMessages(client: AgoClient) {
  const result: { current: UseMessagesResult | null } = { current: null };
  function Harness() {
    result.current = useMessages({ client });
    return <span>ok</span>;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
  return { result, root };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMessages: pause/resume turn", () => {
  it("shows ONE assistant bubble that ends DONE with the resumed text (no duplicates)", async () => {
    vi.stubGlobal("fetch", stubPauseResumeFetch());
    const client = new AgoClient({
      baseUrl: "https://x.example.com",
      clientFunctionsMode: "pause",
    });
    client.registerFunction({
      name: "navigateToPage",
      description: "Navigate",
      parameters: { type: "object", properties: {} },
      handler: () => ({ ok: true }),
    });

    const { result, root } = await mountUseMessages(client);
    const completed = client.waitFor("message:complete", { timeout: 2000 });

    await act(async () => {
      await result.current!.sendMessage("va sur la page parfums");
      await completed; // the auto-resume finishes the turn
      await new Promise((r) => setTimeout(r, 20)); // let React state settle
    });

    const messages = result.current!.messages;
    const assistants = messages.filter((m) => m.role === "assistant");

    // One logical turn = one assistant bubble, completed with the resumed text.
    expect(assistants).toHaveLength(1);
    expect(assistants[0].id).toBe("m1");
    expect(assistants[0].status).toBe("DONE");
    expect(assistants[0].content).toBe("Vous y êtes.");
    // No duplicate ids (duplicate React keys break the transcript rendering).
    const ids = messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.current!.isLoading).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps isLoading true while the turn is paused (before the resume)", async () => {
    // Only serve the paused stream + submit; block the continue behind a gate so
    // the paused state is observable.
    let releaseGate!: () => void;
    vi.stubGlobal("fetch", stubPauseResumeFetch());
    const client = new AgoClient({
      baseUrl: "https://x.example.com",
      clientFunctionsMode: "pause",
    });
    client.registerFunction({
      name: "navigateToPage",
      description: "Navigate",
      parameters: { type: "object", properties: {} },
      handler: () => ({ ok: true }),
    });
    client.registerResumeGate(
      () =>
        new Promise<void>((resolve) => {
          releaseGate = resolve;
        })
    );

    const { result, root } = await mountUseMessages(client);
    const completed = client.waitFor("message:complete", { timeout: 2000 });

    await act(async () => {
      await result.current!.sendMessage("va sur la page parfums");
      await new Promise((r) => setTimeout(r, 20));
    });

    // Paused: the turn is not over — the input must stay in "answering" state.
    expect(result.current!.isLoading).toBe(true);
    const paused = result.current!.messages.filter((m) => m.role === "assistant");
    expect(paused).toHaveLength(1);
    expect(paused[0].status).toBe("WAITING_CLIENT");

    await act(async () => {
      releaseGate();
      await completed;
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current!.isLoading).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });
});
