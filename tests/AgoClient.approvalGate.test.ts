import { describe, it, expect, vi, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { ClientFunctionInvocation } from "../src/client/types";

// Reuses the routed-fetch SSE harness shape from AgoClient.pauseResume.test.ts:
// a client function pauses the turn (WAITING_CLIENT); with an approval gate the
// SDK must hold execution until approveFunction / rejectFunction is called.

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

type FetchCall = { url: string; body: Record<string, unknown> | undefined };

function routedFetch(
  routes: Array<{ match: (url: string) => boolean; respond: () => Response }>
) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({
      url: u,
      body: init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined,
    });
    const route = routes.find((r) => r.match(u));
    if (!route) throw new Error(`Unmatched fetch: ${u}`);
    return route.respond();
  });
  return { fn, calls };
}

const PAGESTATE_PAUSED_STREAM = [
  'data: {"message_id":"m1","thread":{"id":"c1"},"content":""}\n\n',
  'data: {"tool_call_data":true,"type":"client_function","status":"waiting_input","id":"bag1","function_name":"setPageState","arguments":{"statusFilter":"pending"},"thread":{"id":"c1"}}\n\n',
  'data: {"message_id":"m1","thread":{"id":"c1"},"status":"WAITING_CLIENT","waiting_tool_call_ids":["bag1"]}\n\n',
];

const RESUMED_STREAM = [
  'data: {"message_id":"m1","thread":{"id":"c1"},"content":"Done."}\n\n',
  'data: {"message_id":"m1","thread":{"id":"c1"},"status":"DONE"}\n\n',
];

function gatedRoutes() {
  return routedFetch([
    { match: (u) => u.endsWith("/messages"), respond: () => sseResponse(PAGESTATE_PAUSED_STREAM) },
    {
      match: (u) => u.includes("/tool-calls/bag1/submit"),
      respond: () => jsonResponse({ status: "completed", resume: { message_id: "m1", ready: true } }),
    },
    { match: (u) => u.endsWith("/messages/m1/continue"), respond: () => sseResponse(RESUMED_STREAM) },
  ]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("approval gate: holds a gated call until approved", () => {
  it("does not run or submit the function until approveFunction is called", async () => {
    const { fn, calls } = gatedRoutes();
    vi.stubGlobal("fetch", fn);

    const client = new AgoClient({
      baseUrl: "https://x.example.com",
      agent: "a1",
      clientFunctionsMode: "pause",
      approvalPolicy: (inv) => inv.functionName === "setPageState",
    });
    const handler = vi.fn(() => ({ applied: { statusFilter: "pending" } }));
    client.registerFunction({
      name: "setPageState",
      description: "Set page state",
      parameters: { type: "object", properties: {} },
      handler,
    });

    const awaiting: ClientFunctionInvocation[] = [];
    client.on("function:awaiting-approval", (e) => awaiting.push(e));
    const completed = client.waitFor("message:complete", { timeout: 2000 });

    const paused = await client.sendMessage("filter to pending");

    // Paused, waiting on the user — not auto-run, no submit yet.
    expect(paused.status).toBe("WAITING_CLIENT");
    expect(awaiting).toHaveLength(1);
    expect(awaiting[0].invocationId).toBe("bag1");
    expect(handler).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.includes("/tool-calls/bag1/submit"))).toBe(false);

    // Approve → run, submit, resume the SAME turn.
    await client.approveFunction("bag1");
    const final = await completed;
    expect(handler).toHaveBeenCalledWith({ statusFilter: "pending" });
    expect(final.status).toBe("DONE");

    const submit = calls.find((c) => c.url.includes("/tool-calls/bag1/submit"));
    expect(submit?.body?.formData).toMatchObject({
      result: { applied: { statusFilter: "pending" } },
      _type: "client_function_result",
    });
  });

  it("rejectFunction submits a rejection without running the handler, and resumes", async () => {
    const { fn, calls } = gatedRoutes();
    vi.stubGlobal("fetch", fn);

    const client = new AgoClient({
      baseUrl: "https://x.example.com",
      agent: "a1",
      clientFunctionsMode: "pause",
      approvalPolicy: (inv) => inv.functionName === "setPageState",
    });
    const handler = vi.fn(() => ({ applied: {} }));
    client.registerFunction({
      name: "setPageState",
      description: "Set page state",
      parameters: { type: "object", properties: {} },
      handler,
    });

    const completed = client.waitFor("message:complete", { timeout: 2000 });
    await client.sendMessage("filter to pending");
    await client.rejectFunction("bag1");
    const final = await completed;

    expect(handler).not.toHaveBeenCalled();
    expect(final.status).toBe("DONE");
    const submit = calls.find((c) => c.url.includes("/tool-calls/bag1/submit"));
    expect(submit?.body?.formData).toMatchObject({
      result: { approved: false, reason: "user_rejected" },
      _type: "client_function_result",
    });
  });

  it("a per-function requiresApproval flag gates even without a policy", async () => {
    const { fn, calls } = gatedRoutes();
    vi.stubGlobal("fetch", fn);

    const client = new AgoClient({
      baseUrl: "https://x.example.com",
      agent: "a1",
      clientFunctionsMode: "pause",
    });
    const handler = vi.fn(() => ({ applied: {} }));
    client.registerFunction({
      name: "setPageState",
      description: "Set page state",
      parameters: { type: "object", properties: {} },
      handler,
      requiresApproval: true,
    });

    const awaiting: ClientFunctionInvocation[] = [];
    client.on("function:awaiting-approval", (e) => awaiting.push(e));

    const paused = await client.sendMessage("filter to pending");
    expect(paused.status).toBe("WAITING_CLIENT");
    expect(awaiting).toHaveLength(1);
    expect(handler).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.includes("/tool-calls/bag1/submit"))).toBe(false);
  });
});

describe("approval gate: leaves ungated calls alone", () => {
  it("runs immediately when the policy returns false (no approval needed)", async () => {
    const { fn, calls } = gatedRoutes();
    vi.stubGlobal("fetch", fn);

    const client = new AgoClient({
      baseUrl: "https://x.example.com",
      agent: "a1",
      clientFunctionsMode: "pause",
      approvalPolicy: () => false,
    });
    const handler = vi.fn(() => ({ applied: {} }));
    client.registerFunction({
      name: "setPageState",
      description: "Set page state",
      parameters: { type: "object", properties: {} },
      handler,
    });

    const awaiting: ClientFunctionInvocation[] = [];
    client.on("function:awaiting-approval", (e) => awaiting.push(e));
    const completed = client.waitFor("message:complete", { timeout: 2000 });

    await client.sendMessage("filter to pending");
    await completed;

    expect(awaiting).toHaveLength(0);
    expect(handler).toHaveBeenCalledWith({ statusFilter: "pending" });
    expect(calls.some((c) => c.url.includes("/tool-calls/bag1/submit"))).toBe(true);
  });
});
