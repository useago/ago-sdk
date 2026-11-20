import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { AgoClientEvents, Conversation } from "../src/client/types";
import { annotateStaffNames, normalizeRole, parseConversationMarker } from "../src/handoff/handoff";

// ---------------------------------------------------------------------------
// Harness: a routing fetch. `/live` returns a controllable SSE stream that
// errors on abort (like fetch); everything else answers from `routes`.
// ---------------------------------------------------------------------------

interface LiveStream {
  url: string;
  push(frame: unknown): void;
  close(): void;
  aborted: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sse(frames: unknown[]): Response {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function conversation(handoff: unknown, messages: unknown[] = []) {
  return { id: "conv-1", title: "T", created_at: "2026-01-01T00:00:00Z", handoff, messages };
}

function harness() {
  const streams: LiveStream[] = [];
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const routes: {
    conversation: () => Response;
    live: () => Response | null;
    messages?: () => Response;
  } = {
    conversation: () => json(conversation(null)),
    live: () => null,
  };
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/live")) {
      const forced = routes.live();
      if (forced) return forced;
      const encoder = new TextEncoder();
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const stream: LiveStream = {
        url,
        aborted: false,
        push: (frame) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)),
        close: () => controller.close(),
      };
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          init?.signal?.addEventListener("abort", () => {
            stream.aborted = true;
            c.error(new DOMException("Aborted", "AbortError"));
          });
        },
      });
      streams.push(stream);
      return new Response(body, { status: 200 });
    }
    if (url.endsWith("/read")) return json({ status: "ok" });
    if (url.endsWith("/messages") && routes.messages) return routes.messages();
    if (url.includes("/conversations/conv-1")) return routes.conversation();
    if (url.includes("/config")) return json({ permissions: [] });
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { streams, calls, routes, fetchMock };
}

const flush = async (times = 10) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

const HUMAN = { state: "human", agent_name: "Jane", requested_at: null };
const WAITING = { state: "waiting", agent_name: null, requested_at: "2026-01-01T00:00:00Z" };

describe("conversation markers and roles", () => {
  it("parses the four handoff markers into a typed shape", () => {
    expect(parseConversationMarker('{"event":"handoff_requested","available":false}')).toEqual({
      event: "handoff_requested",
      available: false,
    });
    expect(parseConversationMarker('{"event":"handoff_accepted","agent_name":"Jane"}')).toEqual({
      event: "handoff_accepted",
      agentName: "Jane",
    });
    expect(parseConversationMarker('{"event":"handoff_transferred","agent_name":null}')).toEqual({
      event: "handoff_transferred",
      agentName: null,
    });
    expect(parseConversationMarker('{"event":"handoff_ended"}')).toEqual({ event: "handoff_ended" });
  });

  it("returns null for unknown events, malformed JSON and plain text", () => {
    expect(parseConversationMarker('{"event":"page_viewed"}')).toBeNull();
    expect(parseConversationMarker('{"event":')).toBeNull();
    expect(parseConversationMarker("The user navigated")).toBeNull();
    expect(parseConversationMarker(undefined)).toBeNull();
  });

  it("maps the backend's capitalized roles", () => {
    expect(normalizeRole("Staff")).toBe("staff");
    expect(normalizeRole("SYSTEM")).toBe("system");
    expect(normalizeRole("User")).toBe("user");
    expect(normalizeRole("anything-else")).toBe("assistant");
  });

  it("names each staff reply after the agent who held the conversation then", () => {
    const messages = [
      { role: "system", marker: { event: "handoff_accepted", agentName: "Jane" } },
      { role: "staff" },
      { role: "system", marker: { event: "handoff_transferred", agentName: "Omar" } },
      { role: "staff" },
      { role: "system", marker: { event: "handoff_ended" } },
      { role: "staff" },
    ] as Parameters<typeof annotateStaffNames>[0];
    annotateStaffNames(messages, { state: "human", agentName: "Lea", requestedAt: null });
    expect(messages.map((m) => m.staffName)).toEqual([undefined, "Jane", undefined, "Omar", undefined, "Lea"]);
  });
});

describe("AgoClient live human takeover", () => {
  let h: ReturnType<typeof harness>;
  let client: AgoClient;

  beforeEach(() => {
    vi.useFakeTimers();
    h = harness();
    client = new AgoClient({ baseUrl: "https://api.test", widgetId: "w" });
  });

  afterEach(() => {
    client.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("maps staff and system messages from getConversation", async () => {
    h.routes.conversation = () =>
      json(
        conversation(HUMAN, [
          { id: "m1", role: "user", content: "help", status: "DONE", created_at: "2026-01-01T00:00:00Z" },
          { id: "m2", role: "System", content: '{"event":"handoff_accepted","agent_name":"Jane"}', status: "DONE", created_at: "2026-01-01T00:00:01Z" },
          { id: "m3", role: "Staff", content: "Hi, Jane here", status: "DONE", created_at: "2026-01-01T00:00:02Z" },
        ]),
      );
    const conv = await client.getConversation("conv-1");
    expect(conv.handoff).toEqual({ state: "human", agentName: "Jane", requestedAt: null });
    expect(conv.messages?.map((m) => m.role)).toEqual(["user", "system", "staff"]);
    expect(conv.messages?.[1].marker).toEqual({ event: "handoff_accepted", agentName: "Jane" });
    expect(conv.messages?.[2].staffName).toBe("Jane");
  });

  it("opens the live stream only while handed off", async () => {
    await client.getConversation("conv-1");
    await flush();
    expect(h.streams).toHaveLength(0);

    h.routes.conversation = () => json(conversation(WAITING));
    await client.getConversation("conv-1");
    await flush();
    expect(h.streams).toHaveLength(1);
    expect(h.streams[0].url).toContain("/api/sdk/v1/conversations/conv-1/live");
    // Remote assistance is off: the capability is not announced.
    expect(h.streams[0].url).not.toContain("remote_assist");
  });

  it("refetches on an update frame and closes the stream when the handoff ends", async () => {
    h.routes.conversation = () => json(conversation(HUMAN));
    await client.getConversation("conv-1");
    await flush();
    const updates: Conversation[] = [];
    client.on("conversation:updated", (c) => updates.push(c));

    h.routes.conversation = () =>
      json(
        conversation(null, [
          { id: "m9", role: "System", content: '{"event":"handoff_ended"}', status: "DONE", created_at: "2026-01-01T00:00:00Z" },
        ]),
      );
    h.streams[0].push({ type: "ready", handoff: HUMAN });
    h.streams[0].push({ type: "update", handoff: { state: "ai" } });
    await vi.advanceTimersByTimeAsync(0);
    await flush(20);

    expect(updates).toHaveLength(1);
    expect(updates[0].messages?.[0].marker).toEqual({ event: "handoff_ended" });
    expect(client.getHandoff("conv-1")).toBeNull();
    expect(h.streams[0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.streams).toHaveLength(1);
  });

  it("reconnects with a growing backoff after network failures, and stops on a 4xx", async () => {
    let failures = 2;
    h.routes.live = () => {
      if (failures-- > 0) throw new TypeError("Failed to fetch");
      return json({ error: { type: "invalid_request_error", code: "forbidden", message: "no" } }, 403);
    };
    h.routes.conversation = () => json(conversation(HUMAN));
    await client.getConversation("conv-1");
    await flush();
    const liveCalls = () => h.calls.filter((c) => c.url.includes("/live")).length;
    expect(liveCalls()).toBe(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(liveCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(liveCalls()).toBe(2);
    // Second retry waits twice as long.
    await vi.advanceTimersByTimeAsync(1_999);
    expect(liveCalls()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(liveCalls()).toBe(3);
    // That third attempt was a 403: no more attempts.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(liveCalls()).toBe(3);
  });

  it("reconnects after the server closes the stream", async () => {
    h.routes.conversation = () => json(conversation(HUMAN));
    await client.getConversation("conv-1");
    await flush();
    h.streams[0].push({ type: "ready", handoff: HUMAN });
    h.streams[0].close();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.streams).toHaveLength(2);
  });

  it("aborts the stream when the visitor switches conversation or the client is destroyed", async () => {
    h.routes.conversation = () => json(conversation(HUMAN));
    await client.getConversation("conv-1");
    await flush();
    client.setActiveConversation(null);
    expect(h.streams[0].aborted).toBe(true);

    client.setActiveConversation("conv-1");
    await flush();
    expect(h.streams).toHaveLength(2);
    client.destroy();
    expect(h.streams[1].aborted).toBe(true);

    // React StrictMode destroys then revives the same client: the stream comes back.
    client.reviveAfterDestroy();
    await flush();
    expect(h.streams).toHaveLength(3);
  });

  it("defers the refetch while a turn streams for that conversation", async () => {
    h.routes.conversation = () => json(conversation(HUMAN));
    await client.getConversation("conv-1");
    await flush();
    let release!: () => void;
    h.routes.messages = () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode(`data: ${JSON.stringify({ thread: { id: "conv-1" }, handoff: HUMAN, handoff_paused: true })}\n\n`));
          release = () => c.close();
        },
      });
      return new Response(body, { status: 200 });
    };
    const sending = client.sendMessage("hello", { conversationId: "conv-1" });
    await flush(20);
    const before = h.calls.filter((c) => c.url.endsWith("/conversations/conv-1")).length;
    h.streams[0].push({ type: "update", handoff: HUMAN });
    await flush(20);
    expect(h.calls.filter((c) => c.url.endsWith("/conversations/conv-1")).length).toBe(before);

    release();
    await sending;
    await flush(20);
    expect(h.calls.filter((c) => c.url.endsWith("/conversations/conv-1")).length).toBe(before + 1);
  });

  it("ends a message sent while paused without an answer, an error or an empty-reply warning", async () => {
    h.routes.messages = () => sse([{ thread: { id: "conv-1" }, handoff: HUMAN, handoff_paused: true }]);
    const completes = vi.fn();
    const errors = vi.fn();
    const paused: Array<AgoClientEvents["message:handoff-paused"]> = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    client.on("message:complete", completes);
    client.on("message:error", errors);
    client.on("message:empty", completes);
    client.on("message:handoff-paused", (d) => paused.push(d));

    const message = await client.sendMessage("are you there?", { conversationId: "conv-1" });
    await vi.advanceTimersByTimeAsync(0);

    expect(message.handoffPaused).toBe(true);
    expect(completes).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(paused).toEqual([
      { conversationId: "conv-1", handoff: { state: "human", agentName: "Jane", requestedAt: null } },
    ]);
    expect(client.isGenerating()).toBe(false);
    warn.mockRestore();
  });

  it("leaves no blank answer in the conversation object when a send is paused for the human", async () => {
    h.routes.conversation = () => json(conversation(HUMAN));
    h.routes.messages = () => sse([{ thread: { id: "conv-1" }, handoff: HUMAN, handoff_paused: true }]);
    const conv = client.conversation("conv-1");
    await conv.load();
    const paused = vi.fn();
    conv.on("message:handoff-paused", paused);

    await conv.sendMessage("still there?");

    expect(conv.getMessages().map((m) => [m.role, m.content])).toEqual([["user", "still there?"]]);
    expect(conv.isGenerating()).toBe(false);
    expect(paused).toHaveBeenCalledTimes(1);
  });

  it("follows the conversation on screen: staff replies reach its object, other conversations stay closed", async () => {
    h.routes.conversation = () => json(conversation(HUMAN));
    const conv = client.conversation("conv-1");
    client.setActiveConversation("conv-1");
    const unsubscribe = conv.subscribe(() => {});
    await flush(20);
    expect(h.streams).toHaveLength(1);

    h.routes.conversation = () =>
      json(
        conversation(HUMAN, [
          { id: "m1", role: "user", content: "help", status: "DONE", created_at: "2026-01-01T00:00:00Z" },
          { id: "m2", role: "Staff", content: "On it", status: "DONE", created_at: "2026-01-01T00:00:01Z" },
        ]),
      );
    h.streams[0].push({ type: "update", handoff: HUMAN });
    await flush(30);
    expect(conv.getMessages().map((m) => [m.role, m.staffName ?? null, m.content])).toEqual([
      ["user", null, "help"],
      ["staff", "Jane", "On it"],
    ]);

    // A conversation the app moved away from has no live stream.
    client.setActiveConversation("conv-2");
    expect(h.streams[0].aborted).toBe(true);
    await flush(20);
    expect(h.streams).toHaveLength(1);
    unsubscribe();
  });

  it("sends a read receipt when the conversation opened turns out to be handed off", async () => {
    h.routes.conversation = () => json(conversation(HUMAN));
    await client.getConversation("conv-1");
    await flush();
    expect(h.calls.filter((c) => c.url.endsWith("/conversations/conv-1/read"))).toHaveLength(1);
  });

  it("sends read receipts only while the conversation is visible", async () => {
    h.routes.conversation = () => json(conversation(HUMAN));
    client.setConversationVisible(false);
    await client.getConversation("conv-1");
    await flush();
    const reads = () => h.calls.filter((c) => c.url.endsWith("/conversations/conv-1/read") && c.method === "PUT");
    expect(reads()).toHaveLength(0);

    client.setConversationVisible(true);
    await flush();
    expect(reads()).toHaveLength(1);

    // And after each live refetch.
    h.streams[0].push({ type: "update", handoff: HUMAN });
    await flush(30);
    expect(reads()).toHaveLength(2);
  });
});
