import { describe, it, expect, vi, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { Conversation } from "../src/client/types";

// ---------------------------------------------------------------------------
// Harness: a URL-routing fetch stub so one test can serve the three endpoints
// of the pause/resume round-trip (send stream, tool-call submit, continue
// stream) with different payloads.
// ---------------------------------------------------------------------------

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
  routes: Array<{
    match: (url: string) => boolean;
    respond: () => Response;
  }>
) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({
      url: u,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
    });
    const route = routes.find((r) => r.match(u));
    if (!route) throw new Error(`Unmatched fetch: ${u}`);
    return route.respond();
  });
  return { fn, calls };
}

const PAUSED_STREAM = [
  'data: {"message_id":"m1","thread":{"id":"c1"},"content":"On y va. "}\n\n',
  'data: {"tool_call_data":true,"type":"client_function","status":"waiting_input","id":"bag1","function_name":"navigateToPage","arguments":{"path":"/billing"},"thread":{"id":"c1"}}\n\n',
  'data: {"message_id":"m1","thread":{"id":"c1"},"status":"WAITING_CLIENT","waiting_tool_call_ids":["bag1"]}\n\n',
];

const RESUMED_STREAM = [
  'data: {"message_id":"m1","thread":{"id":"c1"},"content":"Vous y êtes."}\n\n',
  'data: {"message_id":"m1","thread":{"id":"c1"},"status":"DONE"}\n\n',
];

function makePauseClient(): AgoClient {
  return new AgoClient({
    baseUrl: "https://x.example.com",
    agent: "agent-1",
    clientFunctionsMode: "pause",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pause/resume: sendMessage opt-in", () => {
  it("sends client_functions_mode=pause only when functions are registered", async () => {
    const { fn, calls } = routedFetch([
      { match: (u) => u.endsWith("/messages"), respond: () => sseResponse(RESUMED_STREAM) },
    ]);
    vi.stubGlobal("fetch", fn);
    const client = makePauseClient();

    await client.sendMessage("hi");
    expect(calls[0].body?.client_functions_mode).toBeUndefined();

    client.registerFunction({
      name: "navigateToPage",
      description: "Navigate",
      parameters: { type: "object", properties: {} },
      handler: () => ({ ok: true }),
    });
    // The second send streams the same canned reply; only the body matters here.
    await client.sendMessage("hi again", { conversationId: "c1" });
    expect(calls[1].body?.client_functions_mode).toBe("pause");
  });

  it("defaults to pause mode when no mode is configured", async () => {
    const { fn, calls } = routedFetch([
      { match: (u) => u.endsWith("/messages"), respond: () => sseResponse(RESUMED_STREAM) },
    ]);
    vi.stubGlobal("fetch", fn);
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    client.registerFunction({
      name: "navigateToPage",
      description: "Navigate",
      parameters: { type: "object", properties: {} },
      handler: () => ({ ok: true }),
    });

    await client.sendMessage("hi");
    expect(calls[0].body?.client_functions).toBeDefined();
    expect(calls[0].body?.client_functions_mode).toBe("pause");
  });

  it("does not send the mode in explicit placeholder mode", async () => {
    const { fn, calls } = routedFetch([
      { match: (u) => u.endsWith("/messages"), respond: () => sseResponse(RESUMED_STREAM) },
    ]);
    vi.stubGlobal("fetch", fn);
    const client = new AgoClient({
      baseUrl: "https://x.example.com",
      clientFunctionsMode: "placeholder",
    });
    client.registerFunction({
      name: "navigateToPage",
      description: "Navigate",
      parameters: { type: "object", properties: {} },
      handler: () => ({ ok: true }),
    });

    await client.sendMessage("hi");
    expect(calls[0].body?.client_functions).toBeDefined();
    expect(calls[0].body?.client_functions_mode).toBeUndefined();
  });
});

describe("pause/resume: full auto flow", () => {
  it("executes the function, submits, auto-continues the SAME message, and completes once", async () => {
    const { fn, calls } = routedFetch([
      { match: (u) => u.endsWith("/messages"), respond: () => sseResponse(PAUSED_STREAM) },
      {
        match: (u) => u.includes("/tool-calls/bag1/submit"),
        respond: () =>
          jsonResponse({
            status: "completed",
            resume: { message_id: "m1", ready: true },
          }),
      },
      {
        match: (u) => u.endsWith("/messages/m1/continue"),
        respond: () => sseResponse(RESUMED_STREAM),
      },
    ]);
    vi.stubGlobal("fetch", fn);

    const client = makePauseClient();
    const handler = vi.fn(() => ({ navigated: true }));
    client.registerFunction({
      name: "navigateToPage",
      description: "Navigate",
      parameters: { type: "object", properties: {} },
      handler,
    });

    const waitingEvents: unknown[] = [];
    const completeEvents: unknown[] = [];
    client.on("message:waiting-client", (e) => waitingEvents.push(e));
    client.on("message:complete", (e) => completeEvents.push(e));
    const completed = client.waitFor("message:complete", { timeout: 2000 });

    const paused = await client.sendMessage("emmène-moi sur la facturation");

    // The paused stream resolves sendMessage with the non-final status…
    expect(paused.status).toBe("WAITING_CLIENT");
    expect(waitingEvents).toEqual([
      { conversationId: "c1", messageId: "m1", waitingToolCallIds: ["bag1"] },
    ]);

    // …then the auto-resume finishes the SAME logical turn.
    const final = await completed;
    expect(final.id).toBe("m1");
    expect(final.status).toBe("DONE");
    expect(final.content).toBe("Vous y êtes.");
    // Exactly one message:complete for the whole turn (none for the paused stream).
    expect(completeEvents).toHaveLength(1);

    expect(handler).toHaveBeenCalledWith({ path: "/billing" });

    const submitCall = calls.find((c) => c.url.includes("/tool-calls/bag1/submit"));
    expect(submitCall?.body?.formData).toMatchObject({
      result: { navigated: true },
      _type: "client_function_result",
    });
    // The continue request re-ships the CURRENT page's functions.
    const continueCall = calls.find((c) => c.url.endsWith("/messages/m1/continue"));
    expect(continueCall?.body?.client_functions).toBeDefined();
  });

  it("waits for the resume gate before continuing", async () => {
    let releaseGate!: () => void;
    const gateReached = vi.fn();
    const { fn, calls } = routedFetch([
      { match: (u) => u.endsWith("/messages"), respond: () => sseResponse(PAUSED_STREAM) },
      {
        match: (u) => u.includes("/tool-calls/bag1/submit"),
        respond: () =>
          jsonResponse({ status: "completed", resume: { message_id: "m1", ready: true } }),
      },
      {
        match: (u) => u.endsWith("/messages/m1/continue"),
        respond: () => sseResponse(RESUMED_STREAM),
      },
    ]);
    vi.stubGlobal("fetch", fn);

    const client = makePauseClient();
    client.registerFunction({
      name: "navigateToPage",
      description: "Navigate",
      parameters: { type: "object", properties: {} },
      handler: () => ({ ok: true }),
    });
    client.registerResumeGate(
      (info) =>
        new Promise<void>((resolve) => {
          gateReached(info);
          releaseGate = resolve;
        })
    );

    const completed = client.waitFor("message:complete", { timeout: 2000 });
    await client.sendMessage("go");

    // Both signals are in (stream closed + submit ready) but the gate holds.
    await new Promise((r) => setTimeout(r, 20));
    expect(gateReached).toHaveBeenCalledWith({ conversationId: "c1", messageId: "m1" });
    expect(calls.some((c) => c.url.endsWith("/messages/m1/continue"))).toBe(false);

    releaseGate();
    await completed;
    expect(calls.some((c) => c.url.endsWith("/messages/m1/continue"))).toBe(true);
  });

  it("continues only when the LAST result flips resume.ready (multiple functions)", async () => {
    const twoFunctionStream = [
      'data: {"message_id":"m1","thread":{"id":"c1"},"content":""}\n\n',
      'data: {"tool_call_data":true,"type":"client_function","status":"waiting_input","id":"bag1","function_name":"navigateToPage","arguments":{"path":"/a"},"thread":{"id":"c1"}}\n\n',
      'data: {"tool_call_data":true,"type":"client_function","status":"waiting_input","id":"bag2","function_name":"openCart","arguments":{},"thread":{"id":"c1"}}\n\n',
      'data: {"message_id":"m1","thread":{"id":"c1"},"status":"WAITING_CLIENT","waiting_tool_call_ids":["bag1","bag2"]}\n\n',
    ];
    const { fn, calls } = routedFetch([
      { match: (u) => u.endsWith("/messages"), respond: () => sseResponse(twoFunctionStream) },
      {
        match: (u) => u.includes("/tool-calls/bag1/submit"),
        respond: () =>
          jsonResponse({ status: "completed", resume: { message_id: "m1", ready: false } }),
      },
      {
        match: (u) => u.includes("/tool-calls/bag2/submit"),
        respond: () =>
          jsonResponse({ status: "completed", resume: { message_id: "m1", ready: true } }),
      },
      {
        match: (u) => u.endsWith("/messages/m1/continue"),
        respond: () => sseResponse(RESUMED_STREAM),
      },
    ]);
    vi.stubGlobal("fetch", fn);

    const client = makePauseClient();
    client.registerFunction({
      name: "navigateToPage",
      description: "Navigate",
      parameters: { type: "object", properties: {} },
      handler: () => ({ ok: true }),
    });
    client.registerFunction({
      name: "openCart",
      description: "Open cart",
      parameters: { type: "object", properties: {} },
      handler: () => ({ opened: true }),
    });

    const completed = client.waitFor("message:complete", { timeout: 2000 });
    await client.sendMessage("go");
    await completed;

    const continueCalls = calls.filter((c) => c.url.endsWith("/messages/m1/continue"));
    expect(continueCalls).toHaveLength(1);
  });
});

describe("pause/resume: reload restore", () => {
  function pausedConversation(): Conversation {
    return {
      id: "c1",
      title: "Conv",
      lastMessageDate: new Date(),
      messages: [
        {
          id: "u1",
          conversationId: "c1",
          content: "go",
          role: "user",
          status: "DONE",
          createdAt: new Date(),
        },
        {
          id: "m1",
          conversationId: "c1",
          content: "On y va.",
          role: "assistant",
          status: "WAITING_CLIENT",
          createdAt: new Date(),
          toolCalls: [
            {
              id: "bag1",
              type: "client_function",
              status: "waiting_input",
              toolName: "client__navigateToPage",
              functionName: "navigateToPage",
              arguments: { path: "/billing" },
            },
          ],
        },
      ],
    };
  }

  it("re-executes waiting functions, submits, and continues the paused turn", async () => {
    const { fn, calls } = routedFetch([
      {
        match: (u) => u.includes("/tool-calls/bag1/submit"),
        respond: () =>
          jsonResponse({ status: "completed", resume: { message_id: "m1", ready: true } }),
      },
      {
        match: (u) => u.endsWith("/messages/m1/continue"),
        respond: () => sseResponse(RESUMED_STREAM),
      },
    ]);
    vi.stubGlobal("fetch", fn);

    const client = makePauseClient();
    const handler = vi.fn(() => ({ navigated: true }));
    client.registerFunction({
      name: "navigateToPage",
      description: "Navigate",
      parameters: { type: "object", properties: {} },
      handler,
    });

    const final = await client.resumePendingClientFunctions(pausedConversation());

    expect(handler).toHaveBeenCalledWith({ path: "/billing" });
    expect(final?.status).toBe("DONE");
    expect(final?.content).toBe("Vous y êtes.");
    expect(calls.map((c) => c.url)).toEqual([
      "https://x.example.com/api/sdk/v1/tool-calls/bag1/submit",
      "https://x.example.com/api/sdk/v1/messages/m1/continue",
    ]);
  });

  it("returns null when nothing is paused or the function is not registered", async () => {
    const { fn } = routedFetch([]);
    vi.stubGlobal("fetch", fn);
    const client = makePauseClient();

    // Function not registered on this page: do not resume half-blind.
    expect(await client.resumePendingClientFunctions(pausedConversation())).toBeNull();

    // Nothing paused at all.
    const done = pausedConversation();
    done.messages![1].status = "DONE";
    expect(await client.resumePendingClientFunctions(done)).toBeNull();

    expect(fn).not.toHaveBeenCalled();
  });
});
