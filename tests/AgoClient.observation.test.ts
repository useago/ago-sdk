import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import {
  beginBindingActivation,
  isBindingOwner,
  withBindingOwnership,
} from "../src/client/bindingOwnership";

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

describe("conversation observation", () => {
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
    await client.setActiveConversation(conversationId);
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
    await client.setActiveConversation(conversationId);
    await settle();
    expect(done).not.toHaveBeenCalled();
    client.destroy();
  });

  it("drops the JWT on explicit null and emits the auth reset", async () => {
    const fetcher = vi.fn(async () => jsonResponse("history-final.json"));
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "token",
      fetch: fetcher as typeof fetch,
    });
    const updates = vi.fn();
    client.on("conversation:update", updates);
    client.updateConfig({ userJwt: null });
    expect(updates).toHaveBeenCalledWith({
      conversationId: null,
      interaction: null,
    });
    await client.setActiveConversation(conversationId);
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
    const activation = client.setActiveConversation(conversationId);
    await client.setActiveConversation(null);
    release(jsonResponse("history-running.json"));
    await expect(activation).rejects.toMatchObject({
      code: "request_detached",
    });
    expect(update).not.toHaveBeenCalled();
    client.destroy();
  });

  it("retains the exact approval reference when a transient decision fails", async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const fetcher = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          calls.push(`${String(url)}:${init?.body ?? ""}`);
          if (String(url).includes("/approvals/")) {
            if (
              calls.filter((call) => call.includes("/approvals/")).length === 1
            )
              throw new TypeError("offline");
            return new Response(null, { status: 204 });
          }
          return jsonResponse("history-final.json");
        },
      );
      const client = new AgoClient({
        baseUrl: "https://example.test",
        fetch: fetcher as typeof fetch,
      });
      const decision = client.submitApprovalDecision("approval-A", "approve");
      await vi.advanceTimersByTimeAsync(2000);
      await decision;
      const requests = calls.filter((call) => call.includes("/approvals/"));
      expect(requests).toHaveLength(2);
      expect(requests[0]).toBe(requests[1]);
      expect(requests[0]).toContain("/approvals/approval-A/decision");
      client.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("delivers an observed terminal response after same-viewer credential refresh", async () => {
    let historyCalls = 0;
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/conversations/"))
        return jsonResponse(
          ++historyCalls === 1 ? "history-running.json" : "history-final.json",
        );
      if (String(url).endsWith("/events")) return never;
      throw new Error(String(url));
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
    });
    const complete = vi.fn();
    client.on("message:complete", complete);
    await client.setActiveConversation(conversationId);
    client.updateConfig({ userJwt: "new" });
    await settle();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].id).toBe(messageId);
    client.destroy();
  });

  it("resets SDK state only when the server reports a different viewer", async () => {
    let historyCalls = 0;
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/conversations/")) {
        const history = JSON.parse(fixture("history-running.json"));
        if (++historyCalls > 1) history.viewer_id = "another-viewer";
        return new Response(JSON.stringify(history), { status: 200 });
      }
      if (String(url).endsWith("/events")) return never;
      throw new Error(String(url));
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
    });
    const updates = vi.fn();
    client.on("conversation:update", updates);
    await client.setActiveConversation(conversationId);
    client.updateConfig({ userJwt: "new" });
    await settle();
    expect(updates).toHaveBeenCalledWith({
      conversationId: null,
      interaction: null,
    });
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
      await client.setActiveConversation(conversationId);
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

  it("lets new transport verify a same viewer before an old WebMCP approval executes", async () => {
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes("/conversations/"))
        return jsonResponse("history-running.json");
      if (path.endsWith("/api/sdk/v1/messages"))
        return textResponse(fixture("initial-send.sse"));
      if (path.endsWith("/events")) return never;
      return new Response("{}", { status: 200 });
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
      approvalPolicy: () => true,
    });
    const handler = vi.fn(() => ({ ok: true }));
    client.registerFunction({
      name: "lookup",
      description: "Lookup",
      parameters: { type: "object", properties: {} },
      handler,
    });
    await client.setActiveConversation(conversationId);
    await client.setActiveConversation(null);
    const external = client.runExternalFunction("lookup", {});
    await settle();
    const pending = client.getPendingApprovals()[0];
    client.updateConfig({ userJwt: "new" });
    await client.approveFunction(pending.invocationId);
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    await client.sendMessage("Start another conversation");
    await external;
    expect(handler).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it.each(["list", "detail", "messages", "webmcp"] as const)(
    "verifies detached credentials before %s without reopening history",
    async (operation) => {
      let releaseVerification!: (response: Response) => void;
      const verification = new Promise<Response>((resolve) => {
        releaseVerification = resolve;
      });
      let oldHistoryReads = 0;
      const never = new Promise<Response>(() => {});
      const fetcher = vi.fn(async (url: string | URL | Request) => {
        const path = String(url);
        if (path.endsWith(`/conversations/${conversationId}`))
          return ++oldHistoryReads === 1
            ? jsonResponse("history-running.json")
            : verification;
        if (path.endsWith("/conversations/other"))
          return jsonResponse("history-final.json");
        if (path.endsWith("/conversations"))
          return new Response(
            JSON.stringify({ data: [], total: 0, has_more: false }),
            { status: 200 },
          );
        if (path.endsWith("/events")) return never;
        return new Response("{}", { status: 200 });
      });
      const client = new AgoClient({
        baseUrl: "https://example.test",
        userJwt: "old",
        fetch: fetcher as typeof fetch,
      });
      const handler = vi.fn(() => ({ ok: true }));
      client.registerFunction({
        name: "lookup",
        description: "Lookup",
        parameters: { type: "object", properties: {} },
        handler,
      });
      await client.setActiveConversation(conversationId);
      await client.setActiveConversation(null);
      const updates = vi.fn();
      const interactions = vi.fn();
      client.on("message:update", updates);
      client.on("conversation:update", interactions);
      const previousEvents = fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith("/events"),
      ).length;
      client.updateConfig({ userJwt: "new" });
      const pending =
        operation === "list"
          ? client.getConversations()
          : operation === "detail"
            ? client.getConversation("other")
            : operation === "messages"
              ? client.getMessages("other")
              : client.runExternalFunction("lookup", {});
      let done = false;
      void pending.then(() => {
        done = true;
      });
      await settle();
      expect(done).toBe(false);
      expect(handler).not.toHaveBeenCalled();
      releaseVerification(jsonResponse("history-running.json"));
      await pending;
      expect(done).toBe(true);
      expect(oldHistoryReads).toBe(2);
      expect(
        fetcher.mock.calls.filter(([url]) => String(url).endsWith("/events")),
      ).toHaveLength(previousEvents);
      expect(updates).not.toHaveBeenCalled();
      expect(interactions).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledTimes(operation === "webmcp" ? 1 : 0);
      client.destroy();
    },
  );

  it.each(["missing", "different", "denied", "destroy"] as const)(
    "fails closed during detached verification on %s",
    async (outcome) => {
      let releaseVerification!: (response: Response) => void;
      const verification = new Promise<Response>((resolve) => {
        releaseVerification = resolve;
      });
      let histories = 0;
      const never = new Promise<Response>(() => {});
      const fetcher = vi.fn(async (url: string | URL | Request) => {
        const path = String(url);
        if (path.endsWith(`/conversations/${conversationId}`))
          return ++histories === 1
            ? jsonResponse("history-running.json")
            : verification;
        if (path.endsWith("/conversations"))
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        return never;
      });
      const client = new AgoClient({
        baseUrl: "https://example.test",
        userJwt: "old",
        fetch: fetcher as typeof fetch,
      });
      await client.setActiveConversation(conversationId);
      await client.setActiveConversation(null);
      const resets = vi.fn();
      client.on("conversation:update", resets);
      client.updateConfig({ userJwt: "new" });
      const pending = client.getConversations();
      const rejected = expect(pending).rejects.toMatchObject({
        code: "request_detached",
      });
      if (outcome === "destroy") client.destroy();
      else {
        if (outcome === "denied")
          releaseVerification(new Response("{}", { status: 403 }));
        else {
          const raw = JSON.parse(fixture("history-running.json"));
          if (outcome === "missing") delete raw.viewer_id;
          else raw.viewer_id = "another-viewer";
          releaseVerification(
            new Response(JSON.stringify(raw), { status: 200 }),
          );
        }
      }
      await rejected;
      if (outcome !== "destroy") {
        expect(resets).toHaveBeenCalledWith({
          conversationId: null,
          interaction: null,
        });
        client.destroy();
      }
    },
  );

  it("settles detached verification network failure without resetting authority and retries only on a new operation", async () => {
    let fail!: (error: Error) => void;
    let recover!: (response: Response) => void;
    const failed = new Promise<Response>((_, reject) => {
      fail = reject;
    });
    const retry = new Promise<Response>((resolve) => {
      recover = resolve;
    });
    let histories = 0;
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith(`/conversations/${conversationId}`))
        return ++histories === 1
          ? jsonResponse("history-running.json")
          : histories === 2
            ? failed
            : retry;
      if (path.endsWith("/conversations"))
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return never;
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
    });
    await client.setActiveConversation(conversationId);
    await client.setActiveConversation(null);
    const interactions = vi.fn();
    const connections = vi.fn();
    client.on("conversation:update", interactions);
    client.on("connection:status", connections);
    client.updateConfig({ userJwt: "new" });
    const first = client.getConversations();
    const rejected = expect(first).rejects.toBeDefined();
    fail(new TypeError("offline"));
    await rejected;
    await settle();
    expect(histories).toBe(2);
    expect(interactions).not.toHaveBeenCalled();
    expect(connections).toHaveBeenCalledWith(
      expect.objectContaining({ connected: false }),
    );
    const second = client.getConversations();
    expect(histories).toBe(3);
    recover(jsonResponse("history-running.json"));
    await expect(second).resolves.toMatchObject({ data: [] });
    expect(interactions).not.toHaveBeenCalled();
    client.destroy();
  });

  it.each(["network", "5xx"] as const)(
    "settles an active %s verification failure and retries on a new operation",
    async (failureKind) => {
      let fail!: (error: Error) => void;
      let respondFailure!: (response: Response) => void;
      let recover!: (response: Response) => void;
      let releaseFollow!: (response: Response) => void;
      const failure = new Promise<Response>((resolve, reject) => {
        respondFailure = resolve;
        fail = reject;
      });
      const retry = new Promise<Response>((resolve) => {
        recover = resolve;
      });
      const follow = new Promise<Response>((resolve) => {
        releaseFollow = resolve;
      });
      let histories = 0;
      const fetcher = vi.fn(async (url: string | URL | Request) => {
        const path = String(url);
        if (path.endsWith(`/conversations/${conversationId}`))
          return ++histories === 1
            ? jsonResponse("history-running.json")
            : histories === 2
              ? failure
              : retry;
        if (path.endsWith("/conversations"))
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        return follow;
      });
      const client = new AgoClient({
        baseUrl: "https://example.test",
        userJwt: "old",
        fetch: fetcher as typeof fetch,
      });
      await client.setActiveConversation(conversationId);
      const interactions = vi.fn();
      const updates = vi.fn();
      const completions = vi.fn();
      const connections = vi.fn();
      client.on("conversation:update", interactions);
      client.on("message:update", updates);
      client.on("message:complete", completions);
      client.on("connection:status", connections);
      client.updateConfig({ userJwt: "new" });
      const first = client.getConversations();
      const rejected = expect(first).rejects.toBeDefined();
      if (failureKind === "network") fail(new TypeError("offline"));
      else respondFailure(new Response("{}", { status: 503 }));
      await rejected;
      releaseFollow(textResponse(fixture("follow-to-final.sse")));
      await settle();
      expect(histories).toBe(2);
      expect(updates).not.toHaveBeenCalled();
      expect(completions).not.toHaveBeenCalled();
      expect(interactions).not.toHaveBeenCalled();
      expect(connections).toHaveBeenCalledWith(
        expect.objectContaining({ connected: false }),
      );
      const second = client.getConversations();
      expect(histories).toBe(3);
      recover(jsonResponse("history-final.json"));
      await expect(second).resolves.toMatchObject({ data: [] });
      await settle();
      expect(completions).toHaveBeenCalledTimes(1);
      expect(completions.mock.calls[0][0].status).toBe("DONE");
      client.destroy();
    },
  );

  it("does not submit a pending function result after active verification fails", async () => {
    let fail!: (error: Error) => void;
    let finish!: (value: { ok: boolean }) => void;
    const failure = new Promise<Response>((_, reject) => {
      fail = reject;
    });
    const result = new Promise<{ ok: boolean }>((resolve) => {
      finish = resolve;
    });
    let histories = 0;
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith(`/conversations/${conversationId}`))
        return ++histories === 1
          ? jsonResponse("history-running.json")
          : failure;
      return never;
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
    });
    client.registerFunction({
      name: "lookup",
      description: "Lookup",
      parameters: { type: "object", properties: {} },
      handler: () => result,
    });
    await client.setActiveConversation(conversationId);
    const conversation = {
      id: conversationId,
      title: "",
      lastMessageDate: new Date(),
      messages: [
        {
          id: "m1",
          conversationId,
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
    const pending = client.resumePendingClientFunctions(conversation);
    const rejected = expect(pending).rejects.toBeDefined();
    await settle();
    client.updateConfig({ userJwt: "new" });
    fail(new TypeError("offline"));
    await settle();
    finish({ ok: true });
    await rejected;
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes("/tool-calls/")),
    ).toBe(false);
    client.destroy();
  });

  it("continues a pending identity check when the active view detaches", async () => {
    let releaseOld!: (response: Response) => void;
    let releaseDetached!: (response: Response) => void;
    const old = new Promise<Response>((resolve) => {
      releaseOld = resolve;
    });
    const detached = new Promise<Response>((resolve) => {
      releaseDetached = resolve;
    });
    let histories = 0;
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith(`/conversations/${conversationId}`))
        return ++histories === 1
          ? jsonResponse("history-running.json")
          : histories === 2
            ? old
            : detached;
      if (path.endsWith("/conversations"))
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return never;
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
    });
    await client.setActiveConversation(conversationId);
    client.updateConfig({ userJwt: "new" });
    await client.setActiveConversation(null);
    expect(histories).toBe(3);
    const pending = client.getConversations();
    let done = false;
    void pending.then(() => {
      done = true;
    });
    releaseOld(jsonResponse("history-running.json"));
    await settle();
    expect(done).toBe(false);
    releaseDetached(jsonResponse("history-running.json"));
    await pending;
    expect(done).toBe(true);
    client.destroy();
  });

  it("does not let an obsolete detached verifier authorize newer credentials", async () => {
    let oldRelease!: (response: Response) => void;
    let newRelease!: (response: Response) => void;
    const oldCheck = new Promise<Response>((resolve) => {
      oldRelease = resolve;
    });
    const newCheck = new Promise<Response>((resolve) => {
      newRelease = resolve;
    });
    let histories = 0;
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith(`/conversations/${conversationId}`))
        return ++histories === 1
          ? jsonResponse("history-running.json")
          : histories === 2
            ? oldCheck
            : newCheck;
      if (path.endsWith("/conversations"))
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return never;
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
    });
    await client.setActiveConversation(conversationId);
    await client.setActiveConversation(null);
    client.updateConfig({ userJwt: "new-1" });
    const pending = client.getConversations();
    let done = false;
    void pending.then(() => {
      done = true;
    });
    client.updateConfig({ userJwt: "new-2" });
    oldRelease(jsonResponse("history-running.json"));
    await settle();
    expect(done).toBe(false);
    newRelease(jsonResponse("history-running.json"));
    await pending;
    expect(done).toBe(true);
    client.destroy();
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

  it("rejects pending WebMCP verification on destroy without an auth-reset event", async () => {
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
      approvalPolicy: () => true,
    });
    const handler = vi.fn();
    client.registerFunction({
      name: "lookup",
      description: "Lookup",
      parameters: { type: "object", properties: {} },
      handler,
    });
    await client.setActiveConversation(conversationId);
    await client.setActiveConversation(null);
    const external = client.runExternalFunction("lookup", {});
    const rejected = expect(external).rejects.toMatchObject({
      code: "request_detached",
    });
    const pending = client.getPendingApprovals()[0];
    client.updateConfig({ userJwt: "new" });
    await client.approveFunction(pending.invocationId);
    const interaction = vi.fn();
    client.on("conversation:update", interaction);
    client.destroy();
    await rejected;
    expect(handler).not.toHaveBeenCalled();
    expect(interaction).not.toHaveBeenCalled();
  });

  it("preserves a new-authority send while cancelling old WebMCP on verified viewer change", async () => {
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes("/conversations/"))
        return jsonResponse("history-running.json");
      if (path.endsWith("/api/sdk/v1/messages"))
        return textResponse(
          fixture("initial-send.sse").replaceAll(
            "viewer-staff-1",
            "new-viewer",
          ),
        );
      if (path.endsWith("/events")) return never;
      return new Response("{}", { status: 200 });
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
      approvalPolicy: () => true,
    });
    const handler = vi.fn(() => ({ ok: true }));
    client.registerFunction({
      name: "lookup",
      description: "Lookup",
      parameters: { type: "object", properties: {} },
      handler,
    });
    await client.setActiveConversation(conversationId);
    await client.setActiveConversation(null);
    const external = client.runExternalFunction("lookup", {});
    const oldResult = expect(external).rejects.toMatchObject({
      code: "request_detached",
    });
    await settle();
    const pending = client.getPendingApprovals()[0];
    client.updateConfig({ userJwt: "new" });
    await client.approveFunction(pending.invocationId);
    const resets = vi.fn();
    client.on("conversation:update", resets);
    const sent = await client.sendMessage("Start as a new viewer");
    await oldResult;
    expect(sent.status).toBe("IN_PROGRESS");
    expect(resets).toHaveBeenCalledWith({
      conversationId: null,
      interaction: null,
    });
    expect(handler).not.toHaveBeenCalled();
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
      await client.setActiveConversation(conversationId);
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
      await client.setActiveConversation(conversationId);
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
    const first = await client.setActiveConversation(conversationId);
    const second = await client.setActiveConversation(conversationId);
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
      client.setActiveConversation(conversationId),
    ).rejects.toBeDefined();
    const conversation = await client.setActiveConversation(conversationId);
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
    await client.setActiveConversation(conversationId);
    await client.setActiveConversation(null);
    await client.setActiveConversation(conversationId);
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
    await client.setActiveConversation(conversationId);
    client.updateConfig({ userJwt: "same" });
    await settle();
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).includes("/conversations/"),
      ),
    ).toHaveLength(1);
    client.destroy();
  });

  it("clears bound state if refreshed history omits viewer identity", async () => {
    let calls = 0;
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/conversations/")) {
        const history = JSON.parse(fixture("history-running.json"));
        if (++calls > 1) delete history.viewer_id;
        return new Response(JSON.stringify(history), { status: 200 });
      }
      return never;
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
    });
    const updates = vi.fn();
    client.on("conversation:update", updates);
    await client.setActiveConversation(conversationId);
    client.updateConfig({ userJwt: "new" });
    await settle();
    expect(updates).toHaveBeenCalledWith({
      conversationId: null,
      interaction: null,
    });
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
    await client.setActiveConversation(conversationId);
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
    const binding = beginBindingActivation(client, () =>
      client.setActiveConversation(conversationId),
    );
    await binding.result;
    expect(isBindingOwner(client, binding.token)).toBe(true);
    await withBindingOwnership(client, binding.token, () =>
      client.sendMessage("A new conversation"),
    );
    expect(isBindingOwner(client, binding.token)).toBe(true);
    await client.setActiveConversation(conversationId);
    expect(isBindingOwner(client, binding.token)).toBe(false);
    client.destroy();
  });

  it("replaces binding ownership and revokes it on identity reset or destroy", async () => {
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
    const first = beginBindingActivation(client, () =>
      client.setActiveConversation(conversationId),
    );
    await first.result;
    const second = beginBindingActivation(client, () =>
      client.setActiveConversation(conversationId),
    );
    await second.result;
    expect(isBindingOwner(client, first.token)).toBe(false);
    expect(isBindingOwner(client, second.token)).toBe(true);
    client.updateConfig({ userJwt: null });
    expect(isBindingOwner(client, second.token)).toBe(false);
    const third = beginBindingActivation(client, () =>
      client.setActiveConversation(conversationId),
    );
    await third.result;
    expect(isBindingOwner(client, third.token)).toBe(true);
    client.destroy();
    expect(isBindingOwner(client, third.token)).toBe(false);
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
    const binding = beginBindingActivation(client, () =>
      client.setActiveConversation(conversationId),
    );
    await binding.result;
    const sent = await withBindingOwnership(client, binding.token, () =>
      client.sendMessage("Fork", { conversationId }),
    );
    expect(sent.conversationId).toBe(forkId);
    expect(isBindingOwner(client, binding.token)).toBe(true);
    await client.setActiveConversation(forkId);
    expect(isBindingOwner(client, binding.token)).toBe(false);
    client.destroy();
  });

  it("rejects a detached initial request even when buffered body reading does not settle", async () => {
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
    await expect(send).rejects.toMatchObject({ code: "request_detached" });
    client.destroy();
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
          client.setActiveConversation(conversationId),
        ).rejects.toMatchObject({ code: "request_detached" });
      else {
        await client.setActiveConversation(conversationId);
        await settle();
      }
      expect(later).not.toHaveBeenCalled();
      expect(once).not.toHaveBeenCalled();
      client.off(event, logout);
      client.updateConfig({ userJwt: "new" });
      await client.setActiveConversation(conversationId);
      await next;
      expect(later).toHaveBeenCalled();
      expect(once).toHaveBeenCalledTimes(1);
      client.destroy();
    },
  );

  it.each([
    "message:update",
    "conversation:update",
    "connection:status",
  ] as const)(
    "does not resume superseded %s after same-viewer refresh",
    async (event) => {
      let releaseFollow!: (response: Response) => void;
      let failFollow!: (error: Error) => void;
      let releaseRefresh!: (response: Response) => void;
      const follow = new Promise<Response>((resolve, reject) => {
        releaseFollow = resolve;
        failFollow = reject;
      });
      const refresh = new Promise<Response>((resolve) => {
        releaseRefresh = resolve;
      });
      let histories = 0;
      const fetcher = vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes("/conversations/"))
          return ++histories === 1
            ? jsonResponse("history-running.json")
            : refresh;
        return follow;
      });
      const client = new AgoClient({
        baseUrl: "https://example.test",
        userJwt: "old",
        fetch: fetcher as typeof fetch,
      });
      await client.setActiveConversation(conversationId);
      let triggered = false;
      const later = vi.fn();
      client.on(event, () => {
        if (!triggered) {
          triggered = true;
          client.updateConfig({ userJwt: "new" });
        }
      });
      client.on(event, later);
      if (event === "connection:status") failFollow(new TypeError("offline"));
      else
        releaseFollow(textResponse(fixture("follow-approval-authorized.sse")));
      await settle();
      expect(triggered).toBe(true);
      expect(later).not.toHaveBeenCalled();
      releaseRefresh(jsonResponse("history-final.json"));
      await settle();
      expect(later).toHaveBeenCalled();
      const values = later.mock.calls.map(([value]) => value);
      if (event === "message:update") {
        const updates = values.filter((value) => value.id === messageId);
        expect(updates.at(-1)?.status).toBe("DONE");
        expect(updates.every((value) => value.status === "DONE")).toBe(true);
      } else if (event === "conversation:update") {
        expect(values.at(-1).interaction.canSendMessage).toBe(true);
        expect(values.every((value) => value.interaction.canSendMessage)).toBe(
          true,
        );
      } else {
        expect(values.at(-1).connected).toBe(true);
        expect(values.every((value) => value.connected)).toBe(true);
      }
      client.destroy();
    },
  );

  it("resumes completion recipients with the refreshed authorized message", async () => {
    let releaseFollow!: (response: Response) => void;
    let releaseRefresh!: (response: Response) => void;
    const follow = new Promise<Response>((resolve) => {
      releaseFollow = resolve;
    });
    const refresh = new Promise<Response>((resolve) => {
      releaseRefresh = resolve;
    });
    let histories = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/conversations/")
        ? ++histories === 1
          ? jsonResponse("history-running.json")
          : refresh
        : follow,
    );
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
    });
    await client.setActiveConversation(conversationId);
    const first = vi.fn(() => client.updateConfig({ userJwt: "new" }));
    const later = vi.fn();
    const once = vi.fn();
    client.on("message:complete", first);
    client.on("message:complete", later);
    client.once("message:complete", once);
    const next = client.waitFor("message:complete");
    releaseFollow(textResponse(fixture("follow-to-final.sse")));
    await settle();
    expect(first).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
    const raw = JSON.parse(fixture("history-final.json"));
    const message = raw.messages.find(
      (entry: { id: string }) => entry.id === messageId,
    );
    message.content = "redacted refreshed report";
    releaseRefresh(new Response(JSON.stringify(raw), { status: 200 }));
    expect((await next).content).toBe("redacted refreshed report");
    expect(later).toHaveBeenCalledTimes(1);
    expect(later.mock.calls[0][0].content).toBe("redacted refreshed report");
    expect(once).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it.each(["logout", "different-viewer", "destroy"] as const)(
    "drops suspended completion listeners on %s",
    async (change) => {
      let releaseFollow!: (response: Response) => void;
      let releaseRefresh!: (response: Response) => void;
      const follow = new Promise<Response>((resolve) => {
        releaseFollow = resolve;
      });
      const refresh = new Promise<Response>((resolve) => {
        releaseRefresh = resolve;
      });
      let histories = 0;
      const fetcher = vi.fn(async (url: string | URL | Request) =>
        String(url).includes("/conversations/")
          ? ++histories === 1
            ? jsonResponse("history-running.json")
            : refresh
          : follow,
      );
      const client = new AgoClient({
        baseUrl: "https://example.test",
        userJwt: "old",
        fetch: fetcher as typeof fetch,
      });
      await client.setActiveConversation(conversationId);
      const later = vi.fn();
      client.on("message:complete", () =>
        client.updateConfig({ userJwt: "new" }),
      );
      client.on("message:complete", later);
      releaseFollow(textResponse(fixture("follow-to-final.sse")));
      await settle();
      expect(later).not.toHaveBeenCalled();
      if (change === "logout") client.updateConfig({ userJwt: null });
      else if (change === "destroy") client.destroy();
      else {
        const raw = JSON.parse(fixture("history-running.json"));
        raw.viewer_id = "viewer-other";
        releaseRefresh(new Response(JSON.stringify(raw), { status: 200 }));
      }
      await settle();
      expect(later).not.toHaveBeenCalled();
      if (change !== "destroy") client.destroy();
    },
  );

  it.each(["logout", "different-viewer", "same-viewer"] as const)(
    "fences a delayed one-off history read across %s",
    async (change) => {
      let releaseRead!: (response: Response) => void;
      let releaseRefresh!: (response: Response) => void;
      const read = new Promise<Response>((resolve) => {
        releaseRead = resolve;
      });
      const refresh = new Promise<Response>((resolve) => {
        releaseRefresh = resolve;
      });
      let histories = 0;
      const never = new Promise<Response>(() => {});
      const fetcher = vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes("/conversations/")) {
          histories++;
          if (histories === 1) return jsonResponse("history-running.json");
          return histories === 2 ? read : refresh;
        }
        return never;
      });
      const client = new AgoClient({
        baseUrl: "https://example.test",
        userJwt: "old",
        fetch: fetcher as typeof fetch,
      });
      await client.setActiveConversation(conversationId);
      const loaded = vi.fn();
      client.on("conversation:loaded", loaded);
      const pending = client.getConversation("other");
      const outcome = pending.then(
        () => "delivered",
        (error) => error.code,
      );
      client.updateConfig({ userJwt: change === "logout" ? null : "new" });
      releaseRead(jsonResponse("history-final.json"));
      await settle();
      expect(loaded).not.toHaveBeenCalled();
      if (change !== "logout") {
        const raw = JSON.parse(fixture("history-running.json"));
        if (change === "different-viewer") raw.viewer_id = "viewer-other";
        releaseRefresh(new Response(JSON.stringify(raw), { status: 200 }));
      }
      expect(await outcome).toBe(
        change === "same-viewer" ? "delivered" : "request_detached",
      );
      expect(loaded).toHaveBeenCalledTimes(change === "same-viewer" ? 1 : 0);
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
    await expect(
      client.setActiveConversation(conversationId),
    ).rejects.toMatchObject({ code: "request_detached" });
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
    await expect(
      client.setActiveConversation(conversationId),
    ).rejects.toMatchObject({ code: "request_detached" });
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
      await client.setActiveConversation(conversationId);
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
          queueMicrotask(() =>
            queueMicrotask(() => void client.setActiveConversation(null)),
          );
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

  it("waits for same-viewer verification before submitting a deferred function result", async () => {
    let release!: (response: Response) => void;
    const refresh = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let histories = 0;
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/conversations/")) {
        if (++histories === 1) return jsonResponse("history-running.json");
        return refresh;
      }
      if (String(url).includes("/tool-calls/"))
        return new Response(JSON.stringify({ resume: { ready: false } }), {
          status: 200,
        });
      return never;
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
    });
    await client.setActiveConversation(conversationId);
    client.registerFunction({
      name: "lookup",
      description: "Lookup",
      parameters: { type: "object", properties: {} },
      handler: () => ({ ok: true }),
    });
    client.on("function:result", () =>
      queueMicrotask(() =>
        queueMicrotask(() => client.updateConfig({ userJwt: "new" })),
      ),
    );
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
    const resumed = client.resumePendingClientFunctions(conversation);
    await settle();
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes("/tool-calls/")),
    ).toBe(false);
    release(jsonResponse("history-running.json"));
    await resumed;
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).includes("/tool-calls/"),
      ),
    ).toHaveLength(1);
    client.destroy();
  });

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
    await client.setActiveConversation(conversationId);
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
    const initial = await client.setActiveConversation(conversationId);
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

  it("fails closed on a verified-viewer refresh when the new send is legacy-only", async () => {
    let historyCount = 0;
    const never = new Promise<Response>(() => {});
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes("/conversations/"))
        return ++historyCount === 1
          ? jsonResponse("history-running.json")
          : never;
      if (path.endsWith("/api/sdk/v1/messages"))
        return textResponse(
          'data: {"message_id":"m2","thread":{"id":"c2"},"status":"DONE","content":"private"}\n\n',
        );
      return never;
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
    });
    const complete = vi.fn();
    const chunks = vi.fn();
    client.on("message:complete", complete);
    client.on("message:chunk", chunks);
    await client.setActiveConversation(conversationId);
    client.updateConfig({ userJwt: "new" });
    await expect(client.sendMessage("new")).rejects.toMatchObject({
      code: "request_detached",
    });
    expect(complete).not.toHaveBeenCalled();
    expect(chunks).not.toHaveBeenCalled();
    client.destroy();
  });

  it("allows a fresh legacy send after credential change while cancelling old legacy function results", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
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
            : 'data: {"message_id":"m2","thread":{"id":"c2"},"status":"DONE","content":"fresh"}\n\n',
        );
      throw new Error(String(url));
    });
    const client = new AgoClient({
      baseUrl: "https://example.test",
      userJwt: "old",
      fetch: fetcher as typeof fetch,
    });
    client.registerFunction({
      name: "lookup",
      description: "Lookup",
      parameters: { type: "object", properties: {} },
      handler: () => pending,
    });
    await client.sendMessage("old");
    client.updateConfig({ userJwt: "new" });
    finish({ ok: true });
    await settle();
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes("/tool-calls/")),
    ).toBe(false);
    expect((await client.sendMessage("fresh")).content).toBe("fresh");
    client.destroy();
  });
});

it("retains hidden system history in the public conversation getters and activation", async () => {
  const raw = JSON.parse(fixture("history-final.json"));
  const user = raw.messages[0];
  const assistant = raw.messages[1];
  raw.messages = [user, assistant, { ...assistant, id: "system-message", role: "system", status: "TODO", hidden: true, content: "client function continuation", attachments: [], approval: null }, { ...assistant, id: "after-system" }];
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: (async () => new Response(JSON.stringify(raw), { headers: { "Content-Type": "application/json" } })) as typeof fetch });
  const conversation = await client.getConversation(conversationId);
  const messages = await client.getMessages(conversationId);
  const active = await client.setActiveConversation(conversationId);
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
    await client.setActiveConversation(conversationId);
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
  await client.setActiveConversation(conversationId);
  updates.mockClear();
  await expect(client.getConversation("another-conversation")).rejects.toMatchObject({ statusCode: 404 });
  await expect(client.submitApprovalDecision("missing-approval", "approve")).rejects.toMatchObject({ statusCode: 404 });
  expect(updates).not.toHaveBeenCalledWith({ conversationId: null, interaction: null });
  expect((await client.setActiveConversation(conversationId))?.id).toBe(conversationId);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith(`/conversations/${conversationId}`))).toHaveLength(1);
  client.destroy();
});

it("resets when the currently activated history request returns HTTP 404", async () => {
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: (async () => new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "not_found", message: "Not found." } }), { status: 404, headers: { "Content-Type": "application/json" } })) as typeof fetch });
  const updates = vi.fn(); client.on("conversation:update", updates);
  await expect(client.setActiveConversation(conversationId)).rejects.toMatchObject({ statusCode: 404 });
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
  await client.setActiveConversation(conversationId); await settle();
  expect(updates.mock.calls.every(([message]) => message.role !== "system")).toBe(true);
  expect(complete).not.toHaveBeenCalled();
  client.destroy();
});

it.each([
  { hidden: false, created_at: "2026-11-10T10:00:01Z" },
  { hidden: true, created_at: null },
])("validates hidden system history without weakening snapshot fields: %j", async (fields) => {
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
  await expect(client.setActiveConversation(conversationId)).rejects.toMatchObject({ statusCode: status });
  expect(updates).toHaveBeenLastCalledWith({ conversationId: null, interaction: null });
  client.destroy();
});

it("rejects same-ID history for a different verified viewer after a send", async () => {
  const final = JSON.parse(fixture("status-final.json"));
  const frame = `event: message\ndata: ${JSON.stringify({ viewer_id: final.viewer_id, interaction: final.interaction, message: final })}\n\n`;
  const history = JSON.parse(fixture("history-final.json")); history.viewer_id = "another-viewer";
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/api/sdk/v1/messages") ? textResponse(frame) : new Response(JSON.stringify(history), { headers: { "Content-Type": "application/json" } }));
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  const updates = vi.fn(); client.on("conversation:update", updates);
  await client.sendMessage("test"); updates.mockClear();
  await expect(client.setActiveConversation(conversationId)).rejects.toMatchObject({ code: "request_detached" });
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
  const old = client.setActiveConversation(conversationId);
  await requested; await client.setActiveConversation(nextId); updates.mockClear();
  release(new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "not_found", message: "Not found." } }), { status: 404, headers: { "Content-Type": "application/json" } }));
  await expect(old).rejects.toMatchObject({ code: "request_detached" });
  expect(updates).not.toHaveBeenCalledWith({ conversationId: null, interaction: null });
  expect((await client.setActiveConversation(nextId))?.id).toBe(nextId);
  client.destroy();
});

it("does not restart a live follow when same-ID history verifies the viewer", async () => {
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
  const history = await client.setActiveConversation(conversationId);
  expect(history?.id).toBe(conversationId);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/events"))).toHaveLength(1);
  release(textResponse(fixture("follow-to-final.sse")));
  await settle();
  expect(complete).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/events"))).toHaveLength(1);
  client.destroy();
});

it.each(["after", "before"] as const)("joins one follow when it completes %s initial EOF", async (completionOrder) => {
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
  await initialUpdate; await client.setActiveConversation(conversationId);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/events"))).toHaveLength(1);
  const finishFollow = async () => {
    followController.enqueue(new TextEncoder().encode(fixture("follow-to-final.sse")));
    followController.close();
    await settle();
  };
  if (completionOrder === "before") await finishFollow();
  initialController.close(); await send;
  if (completionOrder === "after") await finishFollow();
  await settle();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/events"))).toHaveLength(1);
  expect(completed).toHaveBeenCalledTimes(1);
  expect(updates.mock.calls.at(-1)?.[0]).toMatchObject({ id: messageId, status: "DONE", content: "The report is complete. Download the published result." });
  client.destroy();
});
