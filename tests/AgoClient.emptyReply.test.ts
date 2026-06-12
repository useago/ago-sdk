import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";

// Builds a Response whose body is a real SSE ReadableStream, mirroring the
// harness in SSEHandler.test.ts but driven through AgoClient.sendMessage.
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

function stubFetchWithStreams(streams: string[][]) {
  let call = 0;
  return vi.fn(async () => {
    // First N calls stream SSE; any further calls (e.g. the client-function
    // result submit) get a plain JSON 200.
    if (call < streams.length) {
      return sseResponse(streams[call++]);
    }
    return new Response('{"ok":true}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

const flushTimers = () => new Promise((r) => setTimeout(r, 5));

describe("empty-reply detection (message:empty + console warning)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("emits message:empty AFTER sendMessage resolves and warns once, naming the agent", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetchWithStreams([
        ['data: {"status":"DONE","message_id":"m1","thread":{"id":"t1"}}\n\n'],
      ])
    );
    const client = new AgoClient({
      baseUrl: "https://x.example.com",
      agent: "does-not-exist-xyz",
    });

    const reply = await client.sendMessage("hi");
    expect(reply.status).toBe("DONE");
    expect(reply.content).toBe("");

    // Subscribing after the await must still catch the event (deferred emit).
    const event = await client.waitFor("message:empty", { timeout: 1000 });
    expect(event).toEqual({ conversationId: "t1", messageId: "m1" });

    await flushTimers();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const text = String(warnSpy.mock.calls[0][0]);
    expect(text).toContain("does-not-exist-xyz");
    expect(text).toContain("message:empty");
  });

  it("fires message:empty after message:complete (ordering)", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetchWithStreams([
        ['data: {"status":"DONE","message_id":"m1","thread":{"id":"t1"}}\n\n'],
      ])
    );
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    const order: string[] = [];
    client.on("message:complete", () => order.push("complete"));
    client.on("message:empty", () => order.push("empty"));

    await client.sendMessage("hi");
    await flushTimers();

    expect(order).toEqual(["complete", "empty"]);
  });

  it("does NOT fire for a reply with content", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetchWithStreams([
        [
          'data: {"content":"Hello","message_id":"m1","thread":{"id":"t1"}}\n\n',
          'data: {"status":"DONE","message_id":"m1","thread":{"id":"t1"}}\n\n',
        ],
      ])
    );
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const onEmpty = vi.fn();
    client.on("message:empty", onEmpty);

    await client.sendMessage("hi");
    await flushTimers();

    expect(onEmpty).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT fire for an action-only turn (client function, no text) — false-positive guard", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetchWithStreams([
        [
          'data: {"type":"client_function","function_name":"navigate","id":"inv-1","arguments":{"path":"/x"},"message_id":"m1","thread":{"id":"t1"}}\n\n',
          'data: {"status":"DONE","message_id":"m1","thread":{"id":"t1"}}\n\n',
        ],
      ])
    );
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    client.registerFunction({
      name: "navigate",
      parameters: { type: "object", properties: {} },
      handler: async () => "ok",
    });
    const onEmpty = vi.fn();
    client.on("message:empty", onEmpty);

    await client.sendMessage("go to x");
    await flushTimers();

    expect(onEmpty).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT fire when the reply carries follow-up replies only", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetchWithStreams([
        [
          'data: {"status":"DONE","message_id":"m1","thread":{"id":"t1"}}\n\n',
          'data: {"follow_up_replies":["Pricing","Demo"],"message_id":"m1","thread":{"id":"t1"}}\n\n',
        ],
      ])
    );
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const onEmpty = vi.fn();
    client.on("message:empty", onEmpty);

    await client.sendMessage("hi");
    await flushTimers();

    expect(onEmpty).not.toHaveBeenCalled();
  });

  it("treats whitespace-only content as empty", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetchWithStreams([
        [
          'data: {"content":"   ","message_id":"m1","thread":{"id":"t1"}}\n\n',
          'data: {"status":"DONE","message_id":"m1","thread":{"id":"t1"}}\n\n',
        ],
      ])
    );
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const onEmpty = vi.fn();
    client.on("message:empty", onEmpty);

    await client.sendMessage("hi");
    await flushTimers();

    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it("branches the warning copy for an eventless 200 stream (no message data)", async () => {
    vi.stubGlobal("fetch", stubFetchWithStreams([[""]]));
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const onEmpty = vi.fn();
    client.on("message:empty", onEmpty);

    await client.sendMessage("hi");
    await flushTimers();

    expect(onEmpty).toHaveBeenCalledWith({ conversationId: "", messageId: "" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const text = String(warnSpy.mock.calls[0][0]);
    expect(text).toContain("server-sent events");
  });

  it("warns once per conversation but emits the event every time", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetchWithStreams([
        ['data: {"status":"DONE","message_id":"m1","thread":{"id":"t1"}}\n\n'],
        ['data: {"status":"DONE","message_id":"m2","thread":{"id":"t1"}}\n\n'],
      ])
    );
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const onEmpty = vi.fn();
    client.on("message:empty", onEmpty);

    await client.sendMessage("hi");
    await client.sendMessage("hi again", { conversationId: "t1" });
    await flushTimers();

    expect(onEmpty).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("warnOnEmptyReply: false silences the warning but keeps the event", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetchWithStreams([
        ['data: {"status":"DONE","message_id":"m1","thread":{"id":"t1"}}\n\n'],
      ])
    );
    const client = new AgoClient({
      baseUrl: "https://x.example.com",
      warnOnEmptyReply: false,
    });
    const onEmpty = vi.fn();
    client.on("message:empty", onEmpty);

    await client.sendMessage("hi");
    await flushTimers();

    expect(onEmpty).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
