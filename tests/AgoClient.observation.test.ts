import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";

const fixture = (name: string) =>
  readFileSync(`tests/fixtures/background-sdk/${name}`, "utf8");
const conversationId = "11111111-1111-4111-8111-111111111111";
const messageId = "33333333-3333-4333-8333-333333333333";
const textResponse = (text: string) =>
  new Response(text, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
const jsonResponse = (name: string) =>
  new Response(fixture(name), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const activate = (client: AgoClient, id: string) => {
  client.setActiveConversation(id);
  return client.conversation(id).load();
};

function expiredTokenResponse(): Response {
  return Response.json({ error: {
    type: "authentication_error", code: "token_expired", message: "The authentication token has expired",
  } }, { status: 401 });
}

describe("conversation observation", () => {
  it("preserves observation state on token expiry and reconnects with updated credentials", async () => {
    vi.useFakeTimers();
    const eventTokens: Array<string | null> = [];
    const statusTokens: Array<string | null> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith(`/conversations/${conversationId}`)) return jsonResponse("history-running.json");
      const authorization = new Headers(init?.headers).get("authorization");
      if (path.endsWith("/events")) {
        eventTokens.push(authorization);
        return eventTokens.length === 1 ? expiredTokenResponse() : textResponse(fixture("follow-to-final.sse"));
      }
      if (path.endsWith("/status")) {
        statusTokens.push(authorization);
        return jsonResponse("status-running.json");
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old", fetch: fetcher as typeof fetch });
    const connectionStatus = vi.fn();
    const complete = vi.fn();
    client.on("connection:status", connectionStatus);
    client.on("message:complete", complete);
    try {
      await activate(client, conversationId);
      await vi.advanceTimersByTimeAsync(0);
      expect(client.getActiveConversation()).toBe(conversationId);
      expect(client.conversation(conversationId).getMessages().map((message) => message.id)).toContain(messageId);
      expect(connectionStatus).toHaveBeenCalledWith(expect.objectContaining({
        conversationId, connected: false,
        error: expect.objectContaining({ statusCode: 401, type: "authentication_error", code: "token_expired" }),
      }));
      expect(eventTokens).toEqual(["Bearer old"]);
      client.updateConfig({ userJwt: "new" });
      await vi.advanceTimersByTimeAsync(0);
      expect(eventTokens).toEqual(["Bearer old"]);
      expect(statusTokens).toEqual([]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(statusTokens).toEqual(["Bearer new"]);
      expect(eventTokens).toEqual(["Bearer old", "Bearer new"]);
      expect(client.getActiveConversation()).toBe(conversationId);
      expect(complete).toHaveBeenCalledTimes(1);
    } finally {
      client.destroy();
      vi.useRealTimers();
    }
  });

  it("preserves loaded history when another history request encounters an expired token", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse("history-final.json"))
      .mockResolvedValueOnce(expiredTokenResponse());
    const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old", fetch: fetcher });
    const update = vi.fn();
    client.on("conversation:update", update);
    try {
      await activate(client, conversationId);
      const conversation = client.conversation(conversationId);
      const messageIds = conversation.getMessages().map((message) => message.id);
      expect(messageIds).toContain(messageId);
      update.mockClear();
      await expect(client.getConversation(conversationId)).rejects.toMatchObject({
        statusCode: 401, type: "authentication_error", code: "token_expired",
      });
      expect(client.getActiveConversation()).toBe(conversationId);
      expect(conversation.getMessages().map((message) => message.id)).toEqual(messageIds);
      expect(update).not.toHaveBeenCalled();
    } finally {
      client.destroy();
    }
  });

  it("stops completion delivery after a listener detaches and reselects the view", async () => {
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: (async (url: string | URL | Request) =>
        String(url).includes("/conversations/")
          ? jsonResponse("history-running.json")
          : textResponse(fixture("follow-to-final.sse"))) as typeof fetch,
    });
    const conversation = client.conversation(conversationId);
    const laterClient = vi.fn();
    const scoped = vi.fn();
    client.on("message:complete", () => {
      client.setActiveConversation(null);
      client.setActiveConversation(conversationId);
    });
    client.on("message:complete", laterClient);
    conversation.on("message:complete", scoped);
    await activate(client, conversationId);
    await settle();
    expect(laterClient).not.toHaveBeenCalled();
    expect(scoped).not.toHaveBeenCalled();
    client.destroy();
  });

  it("does not deliver or resume a client function after logout during its result submission", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/tool-calls/")) return pending;
      return new Response("{}", { status: 200 });
    });
    const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old", fetch: fetcher as typeof fetch });
    client.registerFunction({ name: "lookup", description: "Lookup", parameters: { type: "object", properties: {} }, handler: () => "result" });
    const results = vi.fn();
    client.on("function:result", results);
    const resumed = client.resumePendingClientFunctions({
      id: "c1", title: "", lastMessageDate: new Date(), messages: [{
        id: "m1", conversationId: "c1", role: "assistant", status: "WAITING_CLIENT", content: "", createdAt: new Date(),
        toolCalls: [{ id: "call", type: "client_function", status: "waiting_input", toolName: "", functionName: "lookup", arguments: {} }],
      }],
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    results.mockClear();
    client.updateConfig({ userJwt: null });
    release(new Response(JSON.stringify({ resume: { ready: true, message_id: "m1" } }), { status: 200 }));
    await expect(resumed).rejects.toMatchObject({ code: "request_detached" });
    expect(results).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/continue"))).toBe(false);
    client.destroy();
  });

  it("continues a stream on token refresh without fetching history", async () => {
    let histories = 0;
    const fetcher = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).includes("/conversations/")) { histories++; return jsonResponse("history-final.json"); }
      if (String(url).endsWith("/messages")) return textResponse(
        `data: ${JSON.stringify({ message_id: "m2", thread: { id: conversationId }, content: "first" })}\n\n` +
        `data: ${JSON.stringify({ message_id: "m2", thread: { id: conversationId }, content: "second", status: "DONE" })}\n\n`,
      );
      throw new Error(String(url));
    });
    const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old", fetch: fetcher as typeof fetch });
    await client.getConversation(conversationId);
    const conversation = client.conversation(conversationId);
    client.on("message:chunk", ({ content }) => { if (content === "first") client.updateConfig({ userJwt: "new" }); });
    const sent = conversation.sendMessage("hello");
    await settle();
    await sent;
    expect(histories).toBe(1);
    expect(fetcher.mock.calls.find(([url]) => String(url).endsWith("/messages"))?.[1]?.headers).toMatchObject({ Authorization: "Bearer old" });
    expect(conversation.getMessages().find((message) => message.id === "m2")?.content).toBe("firstsecond");
    client.destroy();
  });

  it("replaces snapshots and completes once when an observed response becomes terminal", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith(`/conversations/${conversationId}`))
        return jsonResponse("history-running.json");
      if (path.endsWith(`/messages/${messageId}/events`))
        return textResponse(fixture("follow-to-final.sse"));
      throw new Error(path);
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
    });
    const updates: string[] = [];
    const complete: unknown[] = [];
    client.on("message:update", (message) => updates.push(message.status));
    client.on("message:complete", (message) =>
      complete.push(JSON.parse(JSON.stringify(message))),
    );
    client.setActiveConversation(conversationId);
    await client.conversation(conversationId).load();
    await settle();
    expect(updates).toContain("IN_PROGRESS");
    expect(updates.at(-1)).toBe("DONE");
    expect(complete).toEqual([
      JSON.parse(fixture("expected/final-message.json")),
    ]);
    client.destroy();
  });

  it("does not replay completion when a historical terminal conversation opens", async () => {
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: (async () => jsonResponse("history-final.json")) as typeof fetch,
    });
    const done = vi.fn();
    client.on("message:complete", done);
    client.setActiveConversation(conversationId);
    await client.conversation(conversationId).load();
    await settle();
    expect(done).not.toHaveBeenCalled();
    client.destroy();
  });

  it.each([undefined, "old"])("uses replacement credentials without a verification request (prior: %s)", async (token) => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: [], has_more: false, total: 0 }), { status: 200 }));
    const client = new AgoClient({ baseUrl: "https://example.test", userJwt: token, fetch: fetcher as typeof fetch });
    client.updateConfig({ userJwt: "new" });
    expect(fetcher).not.toHaveBeenCalled();
    await client.getConversations();
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer new" });
    client.destroy();
  });

  it.each([null, "new"])("handles a delayed history read across credential update %s", async (token) => {
    let release!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { release = resolve; });
    const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old", fetch: (() => response) as typeof fetch });
    const loaded = vi.fn();
    client.on("conversation:loaded", loaded);
    const pending = client.getConversation(conversationId);
    client.updateConfig({ userJwt: token });
    release(jsonResponse("history-final.json"));
    if (token === null) {
      await expect(pending).rejects.toMatchObject({ code: "request_detached" });
      expect(loaded).not.toHaveBeenCalled();
    } else {
      await expect(pending).resolves.toMatchObject({ id: conversationId });
      expect(loaded).toHaveBeenCalledOnce();
    }
    client.destroy();
  });

  it.each(["token", undefined])("resets on explicit null with prior token %s", async (token) => {
    const fetcher = vi.fn(async () => jsonResponse("history-final.json"));
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: token,
      fetch: fetcher as typeof fetch,
    });
    const updates = vi.fn();
    client.on("conversation:update", updates);
    client.updateConfig({ userJwt: null });
    expect(updates).toHaveBeenCalledWith({
      conversationId: null,
      interaction: null,
    });
    client.setActiveConversation(conversationId);
    await client.conversation(conversationId).load();
    const init = fetcher.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(
      (init?.headers as Record<string, string>)?.Authorization,
    ).toBeUndefined();
    client.destroy();
  });
  it("hands unfinished initial EOF to follow without completing or resending", async () => {
    let resolveFollow!: (response: Response) => void;
    const follow = new Promise<Response>((resolve) => {
      resolveFollow = resolve;
    });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/api/sdk/v1/messages"))
        return textResponse(fixture("initial-send.sse"));
      if (path.endsWith(`/messages/${messageId}/events`)) return follow;
      throw new Error(path);
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
    });
    const done = vi.fn();
    client.on("message:complete", done);
    const initial = await client.sendMessage("Prepare a report");
    expect(initial.status).toBe("IN_PROGRESS");
    expect(done).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    resolveFollow(textResponse(fixture("follow-to-final.sse")));
    await settle();
    expect(done).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it("ignores delayed activation after a view switch", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async () => pending);
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
    });
    const update = vi.fn();
    client.on("message:update", update);
    const activation = activate(client, conversationId);
    client.setActiveConversation(null);
    release(jsonResponse("history-running.json"));
    await expect(activation).resolves.toMatchObject({ id: conversationId });
    expect(update).not.toHaveBeenCalled();
    client.destroy();
  });

  it("allows an explicit retry of the exact approval decision after a network failure", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${String(url)}:${init?.body ?? ""}`);
      if (calls.length === 1) throw new TypeError("offline");
      return new Response(null, { status: 204 });
    });
    const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
    await expect(client.submitApprovalDecision("approval-A", "approve")).rejects.toThrow();
    expect(calls).toHaveLength(1);
    await client.submitApprovalDecision("approval-A", "approve");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
    expect(calls[0]).toContain("/approvals/approval-A/decision");
    client.destroy();
  });

  it("completes a pending approval decision after the conversation changes", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(async () => new Promise<Response>((done) => { resolve = done; }));
    const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher });
    client.setActiveConversation(conversationId);
    const decision = client.submitApprovalDecision("approval-A", "approve");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    client.setActiveConversation(null);
    resolve(new Response(null, { status: 204 }));
    await expect(decision).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it("refreshes the conversation and rejects a conflicting approval decision", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test", fetch: async () => new Response(null, { status: 409 }) });
    client.setActiveConversation(conversationId);
    const refresh = vi.spyOn(client.conversation(conversationId), "_refreshBackground").mockImplementation(() => {});
    await expect(client.submitApprovalDecision("approval-A", "reject")).rejects.toMatchObject({ statusCode: 409 });
    expect(refresh).toHaveBeenCalledOnce();
    client.destroy();
  });

  it("clears retained conversation state and ignores a late load failure after logout", async () => {
    let rejectLoad!: (error: Error) => void;
    const delayed = new Promise<Response>((_resolve, reject) => { rejectLoad = reject; });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: (async (url: string | URL | Request) => {
        if (String(url).includes("/conversations/other")) return delayed;
        if (String(url).includes("/conversations/")) return jsonResponse("history-running.json");
        return new Promise<Response>(() => {});
      }) as typeof fetch,
    });
    const retained = client.conversation(conversationId);
    await retained.load();
    expect(retained.getSnapshot().title).not.toBe("");
    const pendingConversation = client.conversation("other");
    const pending = pendingConversation.load().catch(() => {});
    expect(pendingConversation.getSnapshot().isLoading).toBe(true);
    client.updateConfig({ userJwt: null });
    rejectLoad(new Error("late failure"));
    await pending;
    expect(retained.getSnapshot()).toMatchObject({ title: "", error: null, isLoading: false, messages: [] });
    expect(pendingConversation.getSnapshot()).toMatchObject({ title: "", error: null, isLoading: false, messages: [] });
    client.destroy();
  });

  it("uses serialized status polling when follow has no readable body", async () => {
    vi.useFakeTimers();
    try {
      let release!: (response: Response) => void;
      const pendingStatus = new Promise<Response>((resolve) => {
        release = resolve;
      });
      const readWhole = vi.fn();
      const fetcher = vi.fn(async (url: string | URL | Request) => {
        const path = String(url);
        if (path.includes("/conversations/"))
          return jsonResponse("history-running.json");
        if (path.endsWith("/events"))
          return {
            ok: true,
            status: 200,
            body: null,
            text: readWhole,
          } as unknown as Response;
        if (path.endsWith("/status")) return pendingStatus;
        throw new Error(path);
      });
      const client = new AgoClient({
        baseUrl: "https://example.test",
        fetch: fetcher as typeof fetch,
      });
      await activate(client, conversationId);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(10000);
      expect(
        fetcher.mock.calls.filter(([url]) => String(url).endsWith("/status")),
      ).toHaveLength(1);
      expect(readWhole).not.toHaveBeenCalled();
      release(jsonResponse("status-approval-authorized.json"));
      await vi.advanceTimersByTimeAsync(0);
      client.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps WebMCP event listeners across a conversation detach", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const handler = vi.fn(() => ({ ok: true }));
    client.registerFunction({
      name: "lookup",
      description: "Lookup",
      parameters: { type: "object", properties: {} },
      handler,
    });
    const later = vi.fn();
    client.on("function:invoke", () => void client.setActiveConversation(null));
    client.on("function:invoke", later);
    await client.runExternalFunction("lookup", {});
    expect(later).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it("polls approval wait and returns to SSE after execution resumes", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async (url: string | URL | Request) => {
        const path = String(url);
        if (path.includes("/conversations/"))
          return jsonResponse("history-approval-authorized.json");
        if (path.endsWith("/status"))
          return jsonResponse("status-approval-approved.json");
        if (path.endsWith("/events"))
          return textResponse(fixture("follow-to-final.sse"));
        throw new Error(path);
      });
      const client = new AgoClient({
        baseUrl: "https://example.test",
        fetch: fetcher as typeof fetch,
      });
      const complete = vi.fn();
      client.on("message:complete", complete);
      await activate(client, conversationId);
      expect(
        fetcher.mock.calls.some(([url]) => String(url).endsWith("/events")),
      ).toBe(false);
      await vi.advanceTimersByTimeAsync(2000);
      expect(
        fetcher.mock.calls.some(([url]) => String(url).endsWith("/status")),
      ).toBe(true);
      expect(
        fetcher.mock.calls.some(([url]) => String(url).endsWith("/events")),
      ).toBe(true);
      expect(complete).toHaveBeenCalledTimes(1);
      client.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for signed final attachments before emitting completion", async () => {
    vi.useFakeTimers();
    try {
      let count = 0;
      const final = JSON.parse(fixture("status-final.json"));
      const missing = structuredClone(final);
      missing.attachments[0].file_url = null;
      const fetcher = vi.fn(async (url: string | URL | Request) => {
        const path = String(url);
        if (path.includes("/conversations/"))
          return jsonResponse("history-running.json");
        if (path.endsWith("/events"))
          return { ok: true, status: 200, body: null } as Response;
        if (path.endsWith("/status"))
          return new Response(JSON.stringify(++count === 1 ? missing : final), {
            status: 200,
          });
        throw new Error(path);
      });
      const client = new AgoClient({
        baseUrl: "https://example.test",
        fetch: fetcher as typeof fetch,
      });
      const complete = vi.fn();
      client.on("message:complete", complete);
      await activate(client, conversationId);
      await vi.advanceTimersByTimeAsync(2000);
      expect(complete).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2000);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(complete.mock.calls[0][0].attachments[0].url).toBe(
        "/fixture-files/background-report.csv",
      );
      client.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not submit a delayed browser-function result after detaching", async () => {
    let finish!: (value: unknown) => void;
    const result = new Promise((resolve) => {
      finish = resolve;
    });
    const pause = [
      'data: {"message_id":"m1","thread":{"id":"c1"}}\n\n',
      'data: {"tool_call_data":true,"type":"client_function","status":"waiting_input","id":"bag1","function_name":"lookup","arguments":{},"thread":{"id":"c1"}}\n\n',
      'data: {"message_id":"m1","thread":{"id":"c1"},"status":"WAITING_CLIENT","waiting_tool_call_ids":["bag1"]}\n\n',
    ].join("");
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/api/sdk/v1/messages"))
        return textResponse(pause);
      throw new Error(String(url));
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
    });
    client.registerFunction({
      name: "lookup",
      description: "Lookup",
      parameters: { type: "object", properties: {} },
      handler: () => result,
    });
    expect((await client.sendMessage("test")).status).toBe("WAITING_CLIENT");
    await client.setActiveConversation(null);
    finish({ ok: true });
    await settle();
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes("/tool-calls/")),
    ).toBe(false);
    client.destroy();
  });
  it("returns the conversation and keeps repeated activation idempotent", async () => {
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/conversations/"))
        return jsonResponse("history-running.json");
      return never;
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
    });
    const loaded = vi.fn();
    client.on("conversation:loaded", loaded);
    const first = await activate(client, conversationId);
    const second = await activate(client, conversationId);
    expect(first?.id).toBe(conversationId);
    expect(second?.id).toBe(conversationId);
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).includes("/conversations/"),
      ),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith("/events")),
    ).toHaveLength(1);
    expect(loaded).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it("hydrates and follows after a failed activation is retried", async () => {
    let histories = 0;
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/conversations/")) {
        if (++histories === 1) throw new TypeError("offline");
        return jsonResponse("history-running.json");
      }
      return never;
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
    });
    const loaded = vi.fn();
    client.on("conversation:loaded", loaded);
    await expect(
      activate(client, conversationId),
    ).rejects.toBeDefined();
    const conversation = await activate(client, conversationId);
    expect(conversation?.messages.at(-1)?.status).toBe("IN_PROGRESS");
    expect(histories).toBe(2);
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith("/events")),
    ).toHaveLength(1);
    client.destroy();
  });

  it("does not replay completion when reopening a previously observed terminal response", async () => {
    let historyCalls = 0;
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/conversations/"))
        return jsonResponse(
          ++historyCalls === 1 ? "history-running.json" : "history-final.json",
        );
      return never;
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
    });
    const complete = vi.fn();
    client.on("message:complete", complete);
    await activate(client, conversationId);
    await client.setActiveConversation(null);
    await activate(client, conversationId);
    expect(complete).not.toHaveBeenCalled();
    client.destroy();
  });

  it("does not refresh transport for an unchanged JWT", async () => {
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/conversations/")
        ? jsonResponse("history-running.json")
        : never,
    );
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "same",
      fetch: fetcher as typeof fetch,
    });
    await activate(client, conversationId);
    client.updateConfig({ userJwt: "same" });
    await settle();
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).includes("/conversations/"),
      ),
    ).toHaveLength(1);
    client.destroy();
  });

  it("cancels the active follow reader on detach without posting Stop", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start() {}, cancel });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/conversations/"))
        return jsonResponse("history-running.json");
      if (String(url).endsWith("/events"))
        return new Response(stream, { status: 200 });
      throw new Error(String(url));
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
    });
    await activate(client, conversationId);
    await Promise.resolve();
    await client.setActiveConversation(null);
    await settle();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(
      fetcher.mock.calls.some(([url]) => String(url).endsWith("/stop")),
    ).toBe(false);
    client.destroy();
  });

  it("preserves binding cleanup ownership for its own send and invalidates on imperative activation", async () => {
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes("/conversations/"))
        return jsonResponse("history-running.json");
      if (path.endsWith("/api/sdk/v1/messages"))
        return textResponse(fixture("initial-send.sse"));
      return never;
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
    });
    const binding = client._bindConversation();
    binding.select(conversationId);
    expect(binding.isCurrent()).toBe(true);
    await client.sendMessage("A new conversation");
    expect(binding.isCurrent()).toBe(true);
    await activate(client, conversationId);
    expect(binding.isCurrent()).toBe(false);
    client.destroy();
  });

  it("replaces binding ownership and revokes it on session reset or destroy", async () => {
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/conversations/")
        ? jsonResponse("history-running.json")
        : never,
    );
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
    });
    const first = client._bindConversation();
    first.select(conversationId);
    const second = client._bindConversation();
    second.select(conversationId);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    client.updateConfig({ userJwt: null });
    expect(second.isCurrent()).toBe(false);
    const third = client._bindConversation();
    third.select(conversationId);
    expect(third.isCurrent()).toBe(true);
    client.destroy();
    expect(third.isCurrent()).toBe(false);
  });

  it("retains binding ownership across its own asynchronous fork retarget", async () => {
    const forkId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes("/conversations/"))
        return jsonResponse("history-running.json");
      if (path.endsWith("/api/sdk/v1/messages"))
        return textResponse(
          fixture("initial-send.sse").replaceAll(conversationId, forkId),
        );
      return never;
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
    });
    const binding = client._bindConversation();
    binding.select(conversationId);
    const sent = await client.sendMessage("Fork", { conversationId });
    expect(sent.conversationId).toBe(forkId);
    expect(binding.isCurrent()).toBe(true);
    await client.setActiveConversation(forkId);
    expect(binding.isCurrent()).toBe(false);
    client.destroy();
  });

  it("keeps an ordinary initial request alive on navigation and stops it on destroy", async () => {
    const pending = new Promise<string>(() => {});
    const fetcher = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          body: null,
          text: () => pending,
        }) as Response,
    );
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
    });
    const send = client.sendMessage("test");
    await Promise.resolve();
    await client.setActiveConversation(null);
    client.destroy();
    await expect(send).resolves.toMatchObject({ status: "CANCELED" });
  });

  it.each(["message:update", "message:complete"] as const)(
    "stops old %s delivery to later listeners after logout without consuming once or waitFor",
    async (event) => {
      const never = new Promise<Response>(() => {});
      const fetcher = vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes("/conversations/"))
          return jsonResponse("history-running.json");
        if (String(url).endsWith("/events"))
          return event === "message:complete"
            ? textResponse(fixture("follow-to-final.sse"))
            : never;
        return never;
      });
      const client = new AgoClient({
        baseUrl: "https://example.test",
        userJwt: "old",
        fetch: fetcher as typeof fetch,
      });
      const logout = () => client.updateConfig({ userJwt: null });
      const later = vi.fn();
      const once = vi.fn();
      client.on(event, logout);
      client.on(event, later);
      client.once(event, once);
      const next = client.waitFor(event);
      if (event === "message:update")
        await expect(
          activate(client, conversationId),
        ).rejects.toMatchObject({ code: "request_detached" });
      else {
        await activate(client, conversationId);
        await settle();
      }
      expect(later).not.toHaveBeenCalled();
      expect(once).not.toHaveBeenCalled();
      client.off(event, logout);
      client.updateConfig({ userJwt: "new" });
      await activate(client, conversationId);
      await next;
      expect(later).toHaveBeenCalled();
      expect(once).toHaveBeenCalledTimes(1);
      client.destroy();
    },
  );

  it("keeps a one-off history read independent of view detachment", async () => {
    let release!: (response: Response) => void;
    const read = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: (async () => read) as typeof fetch,
    });
    const loaded = vi.fn();
    client.on("conversation:loaded", loaded);
    const pending = client.getConversation(conversationId);
    await client.setActiveConversation(null);
    release(jsonResponse("history-final.json"));
    expect((await pending).id).toBe(conversationId);
    expect(loaded).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it("does not restore an interaction after a connection listener logs out", async () => {
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: (async () => jsonResponse("history-running.json")) as typeof fetch,
    });
    const interactions = vi.fn();
    const cleanup = vi.fn();
    client.on("conversation:update", interactions);
    client.on("conversation:update", cleanup);
    client.on("connection:status", ({ connected }) => {
      if (connected) client.updateConfig({ userJwt: null });
    });
    await expect(activate(client, conversationId)).rejects.toMatchObject({ code: "request_detached" });
    expect(interactions.mock.calls).toEqual([
      [{ conversationId: null, interaction: null }],
    ]);
    expect(cleanup.mock.calls).toEqual(interactions.mock.calls);
    client.destroy();
  });

  it("stops delivering old state if a snapshot listener detaches synchronously", async () => {
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/conversations/")
        ? jsonResponse("history-running.json")
        : never,
    );
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
    });
    const interaction = vi.fn();
    const completed = vi.fn();
    client.on("conversation:update", interaction);
    client.on("message:complete", completed);
    client.on("message:update", () => {
      void client.setActiveConversation(null);
    });
    await activate(client, conversationId);
    expect(completed).not.toHaveBeenCalled();
    const count = interaction.mock.calls.length;
    await settle();
    expect(interaction).toHaveBeenCalledTimes(count);
    client.destroy();
  });
  it("resets authority for an SSE authentication error without a fabricated HTTP status or retry", async () => {
    vi.useFakeTimers();
    try {
      const authFrame =
        'event: error\ndata: {"error":{"type":"authentication_error","code":"invalid_api_key","message":"Authentication required.","param":null,"doc_url":"https://example.test/errors"}}\n\n';
      const fetcher = vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes("/conversations/"))
          return jsonResponse("history-running.json");
        if (String(url).endsWith("/events")) return textResponse(authFrame);
        throw new Error(String(url));
      });
      const client = new AgoClient({
        baseUrl: "https://example.test",
        fetch: fetcher as typeof fetch,
      });
      const updates = vi.fn();
      const messages = vi.fn();
      client.on("conversation:update", updates);
      client.on("message:update", messages);
      await activate(client, conversationId);
      await vi.advanceTimersByTimeAsync(0);
      expect(updates).toHaveBeenLastCalledWith({
        conversationId: null,
        interaction: null,
      });
      const priorMessages = messages.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10000);
      expect(messages).toHaveBeenCalledTimes(priorMessages);
      expect(
        fetcher.mock.calls.filter(([url]) => String(url).endsWith("/events")),
      ).toHaveLength(1);
      expect(
        fetcher.mock.calls.some(([url]) => String(url).endsWith("/status")),
      ).toBe(false);
      client.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets on a fatal initial SSE authority error without inventing a status code", async () => {
    const authFrame =
      'event: error\ndata: {"error":{"type":"permission_error","code":"insufficient_scope","message":"No access.","param":null,"doc_url":"https://example.test/errors"}}\n\n';
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: (async () => textResponse(authFrame)) as typeof fetch,
    });
    const updates = vi.fn();
    client.on("conversation:update", updates);
    await expect(client.sendMessage("test")).rejects.toMatchObject({
      code: "insufficient_scope",
      statusCode: undefined,
    });
    expect(updates).toHaveBeenCalledWith({
      conversationId: null,
      interaction: null,
    });
    client.destroy();
  });
  it("never emits a stopped partial after an authentication reset", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/stop")
        ? new Response("{}", { status: 200 })
        : new Response(stream, { status: 200 }),
    );
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
    });
    const chunks = vi.fn();
    const complete = vi.fn();
    client.on("message:chunk", chunks);
    client.on("message:complete", complete);
    const send = client.sendMessage("test");
    await Promise.resolve();
    await Promise.resolve();
    controller.enqueue(
      new TextEncoder().encode(
        'data: {"message_id":"m1","thread":{"id":"c1"},"content":"private"}\n\n',
      ),
    );
    await settle();
    expect(chunks).toHaveBeenCalled();
    const stopped = client.stop();
    client.updateConfig({ userJwt: null });
    await expect(send).rejects.toMatchObject({ code: "request_detached" });
    await stopped;
    expect(complete).not.toHaveBeenCalled();
    client.destroy();
  });

  it("does not execute a gated chat approval after a send retargets to another conversation", async () => {
    const pause = [
      'data: {"message_id":"m1","thread":{"id":"c1"}}\n\n',
      'data: {"tool_call_data":true,"type":"client_function","status":"waiting_input","id":"bag1","function_name":"lookup","arguments":{},"thread":{"id":"c1"}}\n\n',
      'data: {"message_id":"m1","thread":{"id":"c1"},"status":"WAITING_CLIENT","waiting_tool_call_ids":["bag1"]}\n\n',
    ].join("");
    let count = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/api/sdk/v1/messages"))
        return textResponse(
          ++count === 1
            ? pause
            : 'data: {"message_id":"m2","thread":{"id":"c2"},"status":"DONE"}\n\n',
        );
      throw new Error(String(url));
    });
    const handler = vi.fn(() => ({ ok: true }));
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
      approvalPolicy: () => true,
    });
    client.registerFunction({
      name: "lookup",
      description: "Lookup",
      parameters: { type: "object", properties: {} },
      handler,
    });
    await client.sendMessage("A", { conversationId: "c1" });
    await settle();
    expect(client.getPendingApprovals()).toHaveLength(1);
    await client.sendMessage("B", { conversationId: "c2" });
    await client.approveFunction("bag1");
    expect(handler).not.toHaveBeenCalled();
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes("/tool-calls/")),
    ).toBe(false);
    client.destroy();
  });

  it.each([false, true])(
    "does not submit a restored function result after its listener detaches (deferred: %s)",
    async (deferred) => {
      const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
      const client = new AgoClient({
        baseUrl: "https://example.test",
        fetch: fetcher as typeof fetch,
      });
      client.registerFunction({
        name: "lookup",
        description: "Lookup",
        parameters: { type: "object", properties: {} },
        handler: () => ({ ok: true }),
      });
      client.on("function:result", () => {
        if (deferred)
          queueMicrotask(() => void client.setActiveConversation(null));
        else void client.setActiveConversation(null);
      });
      const conversation = {
        id: "c1",
        title: "",
        lastMessageDate: new Date(),
        messages: [
          {
            id: "m1",
            conversationId: "c1",
            role: "assistant" as const,
            status: "WAITING_CLIENT" as const,
            content: "",
            createdAt: new Date(),
            toolCalls: [
              {
                id: "bag1",
                type: "client_function" as const,
                status: "waiting_input",
                toolName: "",
                functionName: "lookup",
                arguments: {},
              },
            ],
          },
        ],
      };
      await expect(
        client.resumePendingClientFunctions(conversation),
      ).rejects.toMatchObject({ code: "request_detached" });
      expect(fetcher).not.toHaveBeenCalled();
      client.destroy();
    },
  );

  it("does not mutate an already-delivered snapshot when detaching a follow stream", async () => {
    const follow = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(fixture("follow-approval-authorized.sse")),
        );
      },
    });
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/conversations/")
        ? jsonResponse("history-running.json")
        : new Response(follow, { status: 200 }),
    );
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
    });
    const snapshots: Array<{ status: string }> = [];
    client.on("message:update", (message) => snapshots.push(message));
    await activate(client, conversationId);
    await settle();
    const waiting = snapshots.find(
      (message) => message.status === "WAITING_APPROVAL",
    );
    expect(waiting).toBeDefined();
    await client.setActiveConversation(null);
    await settle();
    expect(waiting?.status).toBe("WAITING_APPROVAL");
    client.destroy();
  });

  it("hydrates before fast follow completion and returns the earlier baseline", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/conversations/")
        ? jsonResponse("history-running.json")
        : textResponse(fixture("follow-to-final.sse")),
    );
    const client = new AgoClient({
      baseUrl: "https://example.test",
      fetch: fetcher as typeof fetch,
    });
    const events: string[] = [];
    client.on("conversation:loaded", () => events.push("loaded"));
    client.on("message:update", (message) => {
      if (message.status === "DONE" && message.role === "assistant")
        events.push("final");
    });
    client.on("message:complete", () => events.push("complete"));
    const initial = await activate(client, conversationId);
    await settle();
    expect(
      initial?.messages?.find((message) => message.id === messageId)?.status,
    ).toBe("IN_PROGRESS");
    expect(events).toEqual(["loaded", "final", "complete"]);
    client.destroy();
  });

  it("uses one status read when an initial terminal snapshot lacks its file URL", async () => {
    vi.useFakeTimers();
    try {
      const final = JSON.parse(fixture("status-final.json"));
      const missing = structuredClone(final);
      missing.attachments[0].file_url = null;
      const interaction = missing.interaction;
      const viewer_id = missing.viewer_id;
      const frame = `event: message\ndata: ${JSON.stringify({ viewer_id, interaction, message: missing })}\n\n`;
      let release!: (response: Response) => void;
      const delayed = new Promise<Response>((resolve) => {
        release = resolve;
      });
      const fetcher = vi.fn(async (url: string | URL | Request) =>
        String(url).endsWith("/api/sdk/v1/messages")
          ? textResponse(frame)
          : delayed,
      );
      const client = new AgoClient({
        baseUrl: "https://example.test",
        fetch: fetcher as typeof fetch,
      });
      const complete = vi.fn();
      client.on("message:complete", complete);
      await client.sendMessage("test");
      await vi.advanceTimersByTimeAsync(12000);
      expect(
        fetcher.mock.calls.filter(([url]) => String(url).endsWith("/status")),
      ).toHaveLength(1);
      expect(complete).not.toHaveBeenCalled();
      release(new Response(JSON.stringify(final), { status: 200 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(complete).toHaveBeenCalledTimes(1);
      client.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

it("retains visible staff replies through public history reads without replaying completion", async () => {
  const raw = JSON.parse(fixture("history-final.json"));
  raw.messages.push({
    ...raw.messages[0],
    id: "staff-message",
    role: "Staff",
    status: "DONE",
    hidden: false,
    content: "A staff member will help you.",
  });
  const client = new AgoClient({
    baseUrl: "https://example.test",
    fetch: (async () => new Response(JSON.stringify(raw), { headers: { "Content-Type": "application/json" } })) as typeof fetch,
  });
  const complete = vi.fn();
  client.on("message:complete", complete);
  const conversation = await client.getConversation(conversationId);
  const messages = await client.getMessages(conversationId);
  const active = await activate(client, conversationId);
  for (const list of [conversation.messages, messages, active?.messages]) {
    expect(list?.map((message) => message.role)).toEqual(["user", "assistant", "Staff"]);
    expect(list?.[2]).toMatchObject({ id: "staff-message", status: "DONE", hidden: false, content: "A staff member will help you." });
  }
  await settle();
  expect(complete).not.toHaveBeenCalled();
  client.destroy();
});

it("retains hidden system history in the public conversation getters and activation", async () => {
  const raw = JSON.parse(fixture("history-final.json"));
  const user = raw.messages[0];
  const assistant = raw.messages[1];
  raw.messages = [user, assistant, { ...assistant, id: "system-message", role: "system", status: "TODO", hidden: true, content: "client function continuation", attachments: [], approval: null }, { ...assistant, id: "after-system" }];
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: (async () => new Response(JSON.stringify(raw), { headers: { "Content-Type": "application/json" } })) as typeof fetch });
  const conversation = await client.getConversation(conversationId);
  const messages = await client.getMessages(conversationId);
  const active = await activate(client, conversationId);
  for (const list of [conversation.messages, messages, active?.messages]) {
    expect(list?.map((m) => m.role)).toEqual(["user", "assistant", "system", "assistant"]);
    expect(list?.[2]).toMatchObject({ hidden: true, status: "TODO", content: "client function continuation", attachments: [], followUpReplies: [], approval: null });
  }
  client.destroy();
});

it("resets an active observation when its SSE reports not_found", async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/events")
      ? textResponse('event: error\ndata: {"error":{"type":"invalid_request_error","code":"not_found","message":"Not found."}}\n\n')
      : jsonResponse("history-running.json"));
    const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
    const updates = vi.fn(); const complete = vi.fn();
    client.on("conversation:update", updates); client.on("message:complete", complete);
    await activate(client, conversationId);
    await vi.advanceTimersByTimeAsync(0);
    expect(updates).toHaveBeenLastCalledWith({ conversationId: null, interaction: null });
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/events"))).toHaveLength(1);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/status") || String(url).endsWith("/stop"))).toBe(false);
    expect(complete).not.toHaveBeenCalled();
    client.destroy();
  } finally { vi.useRealTimers(); }
});

it("keeps the active view on unrelated getter and approval not-found errors", async () => {
  const missing = () => new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "not_found", message: "Not found." } }), { status: 404, headers: { "Content-Type": "application/json" } });
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith(`/conversations/${conversationId}`) ? jsonResponse("history-final.json") : missing());
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  const updates = vi.fn(); client.on("conversation:update", updates);
  await activate(client, conversationId);
  updates.mockClear();
  await expect(client.getConversation("another-conversation")).rejects.toMatchObject({ statusCode: 404 });
  await expect(client.submitApprovalDecision("missing-approval", "approve")).rejects.toMatchObject({ statusCode: 404 });
  expect(updates).not.toHaveBeenCalledWith({ conversationId: null, interaction: null });
  expect((await activate(client, conversationId))?.id).toBe(conversationId);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith(`/conversations/${conversationId}`))).toHaveLength(1);
  client.destroy();
});

it("resets when the currently activated history request returns HTTP 404", async () => {
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: (async () => new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "not_found", message: "Not found." } }), { status: 404, headers: { "Content-Type": "application/json" } })) as typeof fetch });
  const updates = vi.fn(); client.on("conversation:update", updates);
  await expect(activate(client, conversationId)).rejects.toMatchObject({ statusCode: 404 });
  expect(updates).toHaveBeenLastCalledWith({ conversationId: null, interaction: null });
  client.destroy();
});

it("keeps system roles invalid in live snapshots", async () => {
  const raw = JSON.parse(fixture("history-running.json"));
  const invalid = { viewer_id: raw.viewer_id, interaction: raw.interaction, message: { ...raw.messages.at(-1), role: "system", hidden: true } };
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/events") ? textResponse(`event: message\ndata: ${JSON.stringify(invalid)}\n\n`) : jsonResponse("history-running.json"));
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  const updates = vi.fn(); const complete = vi.fn();
  client.on("message:update", updates); client.on("message:complete", complete);
  await activate(client, conversationId); await settle();
  expect(updates.mock.calls.every(([message]) => message.role !== "system")).toBe(true);
  expect(complete).not.toHaveBeenCalled();
  client.destroy();
});

it.each([
  { role: "", hidden: false, created_at: "2026-11-10T10:00:01Z" },
  { hidden: true, created_at: null },
])("validates history roles and snapshot fields: %j", async (fields) => {
  const raw = JSON.parse(fixture("history-final.json"));
  raw.messages[1] = { ...raw.messages[1], role: "system", ...fields };
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: (async () => new Response(JSON.stringify(raw), { headers: { "Content-Type": "application/json" } })) as typeof fetch });
  await expect(client.getConversation(conversationId)).rejects.toMatchObject({ code: "stream_error" });
  client.destroy();
});

it.each([401, 403, 404])("resets when same-ID history after a send returns HTTP %i", async (status) => {
  const final = JSON.parse(fixture("status-final.json"));
  const frame = `event: message\ndata: ${JSON.stringify({ viewer_id: final.viewer_id, interaction: final.interaction, message: final })}\n\n`;
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/api/sdk/v1/messages") ? textResponse(frame) : new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "not_found", message: "Not found." } }), { status, headers: { "Content-Type": "application/json" } }));
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  const updates = vi.fn(); client.on("conversation:update", updates);
  await client.sendMessage("test"); updates.mockClear();
  await expect(activate(client, conversationId)).rejects.toMatchObject({ statusCode: status });
  expect(updates).toHaveBeenLastCalledWith({ conversationId: null, interaction: null });
  client.destroy();
});

it("does not reset a newer view when same-ID history fails late", async () => {
  const final = JSON.parse(fixture("status-final.json"));
  const frame = `event: message\ndata: ${JSON.stringify({ viewer_id: final.viewer_id, interaction: final.interaction, message: final })}\n\n`;
  let release!: (response: Response) => void;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => { started = resolve; });
  const delayed = new Promise<Response>((resolve) => { release = resolve; });
  const nextId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith("/api/sdk/v1/messages")) return textResponse(frame);
    if (String(url).endsWith(`/conversations/${conversationId}`)) { started(); return delayed; }
    if (String(url).endsWith(`/conversations/${nextId}`)) return new Response(fixture("history-final.json").replaceAll(conversationId, nextId), { headers: { "Content-Type": "application/json" } });
    throw new Error(String(url));
  });
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  const updates = vi.fn(); client.on("conversation:update", updates);
  await client.sendMessage("test");
  const old = activate(client, conversationId);
  await requested; await activate(client, nextId); updates.mockClear();
  release(new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "not_found", message: "Not found." } }), { status: 404, headers: { "Content-Type": "application/json" } }));
  await expect(old).rejects.toMatchObject({ code: "not_found" });
  expect(updates).not.toHaveBeenCalledWith({ conversationId: null, interaction: null });
  expect((await activate(client, nextId))?.id).toBe(nextId);
  client.destroy();
});

it("does not restart a live follow when same-ID history verifies the user", async () => {
  let release!: (response: Response) => void;
  const follow = new Promise<Response>((resolve) => { release = resolve; });
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith("/api/sdk/v1/messages")) return textResponse(fixture("initial-send.sse"));
    if (String(url).endsWith("/events")) return follow;
    if (String(url).endsWith(`/conversations/${conversationId}`)) return jsonResponse("history-running.json");
    throw new Error(String(url));
  });
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  const complete = vi.fn(); client.on("message:complete", complete);
  await client.sendMessage("test");
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/events"))).toHaveLength(1);
  const history = await activate(client, conversationId);
  expect(history?.id).toBe(conversationId);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/events"))).toHaveLength(1);
  release(textResponse(fixture("follow-to-final.sse")));
  await settle();
  expect(complete).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/events"))).toHaveLength(1);
  client.destroy();
});

it("starts one follow after the initial stream ends", async () => {
  const history = JSON.parse(fixture("history-running.json"));
  const initialMessage = history.messages.find((message: { id: string }) => message.id === messageId);
  const frame = `event: message\ndata: ${JSON.stringify({ viewer_id: history.viewer_id, interaction: history.interaction, message: initialMessage })}\n\n`;
  let initialController!: ReadableStreamDefaultController<Uint8Array>;
  let followController!: ReadableStreamDefaultController<Uint8Array>;
  const initial = new ReadableStream<Uint8Array>({ start(controller) { initialController = controller; controller.enqueue(new TextEncoder().encode(frame)); } });
  const follow = new ReadableStream<Uint8Array>({ start(controller) { followController = controller; } });
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith("/api/sdk/v1/messages")) return new Response(initial, { headers: { "Content-Type": "text/event-stream" } });
    if (String(url).endsWith(`/conversations/${conversationId}`)) return jsonResponse("history-running.json");
    if (String(url).endsWith("/events")) return new Response(follow, { headers: { "Content-Type": "text/event-stream" } });
    throw new Error(String(url));
  });
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  const updates = vi.fn(); const completed = vi.fn();
  client.on("message:update", updates); client.on("message:complete", completed);
  const initialUpdate = client.waitFor("message:update", { timeout: 2000 });
  const send = client.sendMessage("test");
  await initialUpdate; await activate(client, conversationId);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/events"))).toHaveLength(0);
  const finishFollow = async () => {
    followController.enqueue(new TextEncoder().encode(fixture("follow-to-final.sse")));
    followController.close();
    await settle();
  };
  initialController.close(); await send;
  await finishFollow();
  await settle();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/events"))).toHaveLength(1);
  expect(completed).toHaveBeenCalledTimes(1);
  expect(updates.mock.calls.at(-1)?.[0]).toMatchObject({ id: messageId, status: "DONE", content: "The report is complete. Download the published result." });
  client.destroy();
});

it("keeps a hidden binding selected, suppresses late approval refresh, and resumes fresh", async () => {
  let finishApproval!: (response: Response) => void;
  let historyReads = 0;
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    const path = String(url);
    if (path.includes("/decision")) return new Promise<Response>((resolve) => { finishApproval = resolve; });
    if (path.includes("/conversations/")) {
      historyReads++;
      return jsonResponse(historyReads === 1 ? "history-approval-authorized.json" : "history-final.json");
    }
    throw new Error(`Unexpected hidden observation: ${options?.method ?? "GET"} ${path}`);
  });
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  try {
    const conversation = client.conversation(conversationId);
    const owner = client._bindConversation();
    owner.select(conversationId);
    await conversation.load();
    expect(client.getActiveConversation()).toBe(conversationId);
    const approval = client.submitApprovalDecision("approval-1", "approve");
    await vi.waitFor(() => expect(finishApproval).toBeDefined());
    owner.setBackgroundObservation(false);
    expect(client.getActiveConversation()).toBe(conversationId);
    finishApproval(new Response(null, { status: 204 }));
    await approval;
    expect(fetcher.mock.calls.filter(([url]) => /\/(events|status)$/.test(String(url)))).toHaveLength(0);
    owner.setBackgroundObservation(true);
    await conversation.load();
    expect(historyReads).toBe(2);
    expect(conversation.getSnapshot().interaction?.canSendMessage).toBe(true);
    const nextOwner = client._bindConversation();
    nextOwner.select("another-conversation");
    owner.select(conversationId);
    expect(client.getActiveConversation()).toBe("another-conversation");
  } finally { client.destroy(); }
});

it("does not begin observation when an initially hidden history finishes later", async () => {
  let finishHistory!: (response: Response) => void;
  const fetcher = vi.fn(async () => new Promise<Response>((resolve) => { finishHistory = resolve; }));
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  try {
    const conversation = client.conversation(conversationId);
    const owner = client._bindConversation();
    owner.setBackgroundObservation(false);
    owner.select(conversationId);
    const loading = conversation.load();
    await vi.waitFor(() => expect(finishHistory).toBeDefined());
    finishHistory(jsonResponse("history-running.json"));
    await loading;
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.getActiveConversation()).toBe(conversationId);
  } finally { client.destroy(); }
});

it("keeps observation suspended when a hidden ordinary send is forked by the server", async () => {
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    if (options?.method === "POST" && String(url).endsWith("/messages")) return textResponse(fixture("initial-send.sse"));
    throw new Error(`Unexpected hidden fork observation: ${url}`);
  });
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  try {
    const conversation = client.conversation("original-conversation");
    const owner = client._bindConversation();
    owner.select(conversation.id);
    owner.setBackgroundObservation(false);
    await conversation.sendMessage("Start the report");
    await settle();
    expect(client.getActiveConversation()).toBe(conversationId);
    expect(client.conversation(conversationId).getSnapshot().interaction?.canSendMessage).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { client.destroy(); }
});
