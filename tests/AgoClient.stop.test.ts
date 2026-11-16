import { describe, it, expect, vi, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { createMessageStream } from "../src/streaming/helpers";
import type { AgoMessage } from "../src/client/types";

// ---------------------------------------------------------------------------
// Harness: an SSE response that emits a few frames and then hangs, so a test can
// stop the turn mid-stream. The hang is what a real stream does between chunks;
// the abort listener mirrors fetch, which errors the body when the signal fires.
// ---------------------------------------------------------------------------

function hangingSseResponse(chunks: string[], signal?: AbortSignal): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => {
        controller.error(
          new DOMException("The operation was aborted.", "AbortError")
        );
      });
    },
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
        return;
      }
      // Still generating: never resolves, so the reader waits for the abort.
      return new Promise<void>(() => {});
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

type FetchCall = { url: string; method: string };

/** Fetch stub: streams the send/continue calls, answers everything else JSON. */
function stubFetch(
  chunks: string[],
  stopBody: unknown = { status: "stopping", message_status: "IN_PROGRESS" }
) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? "GET" });
    if (u.endsWith("/stop")) return jsonResponse(stopBody);
    if (u.endsWith("/messages") || u.endsWith("/continue")) {
      return hangingSseResponse(chunks, init?.signal ?? undefined);
    }
    return jsonResponse({ ok: true });
  });
  return { fn, calls };
}

function makeClient(): AgoClient {
  return new AgoClient({ baseUrl: "https://x.example.com", agent: "agent-1" });
}

const STREAM = [
  'data: {"message_id":"m1","thread":{"id":"c1"},"content":"Hel"}\n\n',
  'data: {"message_id":"m1","thread":{"id":"c1"},"content":"lo"}\n\n',
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stop(): interrupting a streaming turn", () => {
  it.each(["logout", "stop"] as const)("handles %s while waiting for the initial response", async (action) => {
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      }),
    );
    const client = new AgoClient({ baseUrl: "https://x.example.com", userJwt: "old", fetch: fetcher as typeof fetch });
    const conversation = client.conversation();
    const stopped = vi.fn();
    const complete = vi.fn();
    client.on("message:stopped", stopped);
    client.on("message:complete", complete);
    const sent = conversation.sendMessage("private message");
    expect(fetcher).toHaveBeenCalledOnce();

    if (action === "logout") {
      client.updateConfig({ userJwt: null });
      const messagesAfterReset = conversation.getMessages();
      await expect(sent).rejects.toMatchObject({ code: "request_detached" });
      expect(stopped).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
      expect(conversation.getMessages()).toEqual(messagesAfterReset);
      expect(client.isGenerating()).toBe(false);
    } else {
      await client.stop();
      await expect(sent).resolves.toMatchObject({ status: "CANCELED", id: "" });
      expect(stopped).toHaveBeenCalledOnce();
      expect(complete).not.toHaveBeenCalled();
    }
    client.destroy();
  });

  it("closes the stream, tells the backend, and keeps the partial answer", async () => {
    const { fn, calls } = stubFetch(STREAM);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();

    const events: string[] = [];
    client.on("message:complete", (m) => events.push(`complete:${m.status}`));
    client.on("message:stopped", () => events.push("stopped"));
    client.on("message:error", () => events.push("error"));

    const chunked = new Promise<void>((resolve) => {
      client.on("message:chunk", (chunk) => {
        if (chunk.content === "lo") resolve();
      });
    });
    const sent = client.sendMessage("hi");
    await chunked;

    const result = await client.stop();
    expect(result).toEqual({ status: "stopping", messageStatus: "IN_PROGRESS" });

    // The send resolves rather than rejecting: a stop is not a failure.
    const message = await sent;
    expect(message.status).toBe("CANCELED");
    expect(message.content).toBe("Hello");
    expect(message.id).toBe("m1");

    expect(calls.some((c) => c.url.endsWith("/messages/m1/stop"))).toBe(true);
    expect(events).toEqual(["complete:CANCELED", "stopped"]);
  });

  it("stops the message the stream named, once", async () => {
    const { fn, calls } = stubFetch(STREAM);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();

    const chunked = client.waitFor("message:chunk");
    const sent = client.sendMessage("hi");
    await chunked;

    await client.stop();
    // A second press has nothing left to stop.
    expect(await client.stop()).toBeNull();
    await sent;

    const stops = calls.filter((c) => c.url.endsWith("/stop"));
    expect(stops).toHaveLength(1);
    expect(stops[0].method).toBe("POST");
  });

  it("is a no-op when nothing is generating", async () => {
    const { fn, calls } = stubFetch(STREAM);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();

    expect(client.isGenerating()).toBe(false);
    expect(await client.stop()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("reports a turn as generating only while it streams", async () => {
    const { fn } = stubFetch(STREAM);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();

    const chunked = client.waitFor("message:chunk");
    const sent = client.sendMessage("hi");
    await chunked;
    expect(client.isGenerating()).toBe(true);

    await client.stop();
    await sent;
    expect(client.isGenerating()).toBe(false);
  });

  it("survives a backend that rejects the stop, still closing the stream", async () => {
    const calls: string[] = [];
    const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/stop")) return new Response("nope", { status: 500 });
      return hangingSseResponse(STREAM, init?.signal ?? undefined);
    });
    vi.stubGlobal("fetch", fn);
    const client = makeClient();

    const chunked = new Promise<void>((resolve) => {
      client.on("message:chunk", (chunk) => {
        if (chunk.content === "lo") resolve();
      });
    });
    const sent = client.sendMessage("hi");
    await chunked;

    expect(await client.stop()).toBeNull();
    const message = await sent;
    expect(message.status).toBe("CANCELED");
    expect(message.content).toBe("Hello");
  });
});

describe("createMessageStream(): stopping mid-iteration", () => {
  it("ends the generator even when the stop beats the message id", async () => {
    // A stream that never emits a frame: the turn is stopped before the backend
    // names the message, so there is no `message:complete` to end the loop.
    const { fn } = stubFetch([]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();

    const seen: string[] = [];
    const iterating = (async () => {
      for await (const event of createMessageStream(client, "hi")) {
        seen.push(event.type);
      }
    })();

    await new Promise((r) => setTimeout(r, 5));
    expect(await client.stop()).toBeNull();

    await iterating;
    expect(seen).toEqual([]);
  });
});

describe("stopMessage(): stopping a turn by id", () => {
  it("maps the backend envelope onto the SDK shape", async () => {
    const { fn } = stubFetch(STREAM, {
      status: "not_running",
      message_status: "DONE",
    });
    vi.stubGlobal("fetch", fn);
    const client = makeClient();

    expect(await client.stopMessage("m9")).toEqual({
      status: "not_running",
      messageStatus: "DONE",
    });
  });
});

describe("stop(): a turn paused on client functions", () => {
  const PAUSED = [
    'data: {"message_id":"m1","thread":{"id":"c1"},"content":"Un instant"}\n\n',
    'data: {"tool_call_data":true,"type":"client_function","status":"waiting_input",' +
      '"id":"call1","function_name":"slowLookup","arguments":{},"thread":{"id":"c1"}}\n\n',
    'data: {"message_id":"m1","thread":{"id":"c1"},"status":"WAITING_CLIENT","waiting_tool_call_ids":["call1"]}\n\n',
  ];

  function stubPausedFetch() {
    const calls: string[] = [];
    const fn = vi.fn(async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/stop")) return jsonResponse({ status: "stopping" });
      if (u.endsWith("/submit")) {
        return jsonResponse({
          status: "completed",
          resume: { message_id: "m1", ready: true },
        });
      }
      // The send stream ends at WAITING_CLIENT and closes.
      const encoder = new TextEncoder();
      let i = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (i < PAUSED.length) controller.enqueue(encoder.encode(PAUSED[i++]));
            else controller.close();
          },
        }),
        { status: 200 }
      );
    });
    return { fn, calls };
  }

  it("stops the paused turn and does not resume it", async () => {
    const { fn, calls } = stubPausedFetch();
    vi.stubGlobal("fetch", fn);
    const client = makeClient();

    // A function slow enough that the turn is still paused when Stop is pressed.
    let releaseFunction: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      releaseFunction = resolve;
    });
    client.registerFunction({
      name: "slowLookup",
      description: "A lookup that takes a while",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        await running;
        return { ok: true };
      },
    });

    const paused: AgoMessage = await client.sendMessage("hi");
    expect(paused.status).toBe("WAITING_CLIENT");
    // The stream is closed, but the turn is still live for the user.
    expect(client.isGenerating()).toBe(true);

    const stopped = client.waitFor("message:stopped");
    expect(await client.stop()).toEqual({ status: "stopping" });
    await stopped;

    // Let the function finish: its result is still submitted, but the turn the
    // user stopped must not be continued behind their back.
    releaseFunction();
    await new Promise((r) => setTimeout(r, 20));

    expect(calls.some((u) => u.endsWith("/messages/m1/stop"))).toBe(true);
    expect(calls.some((u) => u.endsWith("/continue"))).toBe(false);
    expect(client.isGenerating()).toBe(false);
  });

  it.each(["paused", "polled"])("suppresses a %s stop event after session reset", async (kind) => {
    let finishStop!: (response: Response) => void;
    let stopSignal: AbortSignal | null | undefined;
    const fetcher: typeof fetch = async (url, options) => {
      if (String(url).endsWith("/stop")) {
        stopSignal = options?.signal;
        return new Promise((resolve) => { finishStop = resolve; });
      }
      if (kind === "paused") return new Response(PAUSED[0] + PAUSED[2]);
      return jsonResponse({
        id: "c1",
        title: "Conversation",
        messages: [{ id: "m1", role: "assistant", status: "IN_PROGRESS", content: "Partial answer" }],
      });
    };
    const client = new AgoClient({ baseUrl: "https://x.example.com", userJwt: "old", fetch: fetcher });
    const stopped = vi.fn();
    client.on("message:stopped", stopped);
    if (kind === "paused") {
      expect((await client.sendMessage("hi")).status).toBe("WAITING_CLIENT");
    } else {
      client.setActiveConversation("c1");
      await client.conversation("c1").load();
    }
    expect(client.isGenerating()).toBe(true);

    const stop = client.stop();
    expect(finishStop).toBeTypeOf("function");
    client.setActiveConversation("other");
    client.updateConfig({ userJwt: null });
    expect(stopSignal?.aborted).toBe(true);
    finishStop(jsonResponse({ status: "stopping" }));

    await expect(stop).resolves.toEqual({ status: "stopping" });
    expect(stopped).not.toHaveBeenCalled();
    client.destroy();
  });
});
