import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityInput } from "../src/activity/ActivityLedger";
import { AgoApiError } from "../src/client/errors";
import type { CapturedError } from "../src/errors/ErrorWatcher";
import { FunctionRegistry } from "../src/functions/FunctionRegistry";
import {
  GRANT_STORAGE_KEY,
  RemoteAssistController,
  type RemoteAssistDeps,
} from "../src/remoteAssist/RemoteAssistController";
import type { RemoteAssistCommand, RemoteAssistOptions } from "../src/remoteAssist/types";

// ---------------------------------------------------------------------------
// Harness: the controller against an in-memory server. `server.session` is
// what GET /remote-assist answers; `server.queue` is what the next claim hands
// out. Every request is recorded.
// ---------------------------------------------------------------------------

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

const flush = async (times = 20) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

function setup(
  options: {
    config?: boolean | RemoteAssistOptions;
    storage?: Storage;
    approval?: boolean;
    serverEnabled?: boolean;
    errors?: CapturedError[];
  } = {},
) {
  const registry = new FunctionRegistry();
  const storage = options.storage ?? memoryStorage();
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const events: Array<{ event: string; data: unknown }> = [];
  const activity: ActivityInput[] = [];
  const server = {
    session: null as null | { id: string; status: string; agent_name?: string | null; expires_at?: string | null },
    queue: [] as RemoteAssistCommand[][],
    failEnd: false,
  };
  const http: RemoteAssistDeps["http"] = {
    get: vi.fn(async (path: string) => {
      requests.push({ method: "GET", path });
      return { session: server.session } as never;
    }),
    post: vi.fn(async (path: string, body?: unknown) => {
      requests.push({ method: "POST", path, body });
      if (path.endsWith("/accept")) {
        if (server.session?.status !== "requested") {
          throw new AgoApiError("not pending", "remote_assist_not_pending", 409, "conflict");
        }
        server.session = { ...server.session, status: "active" };
        return { session: server.session } as never;
      }
      if (path.endsWith("/end")) {
        if (server.failEnd) throw new TypeError("Failed to fetch");
        server.session = null;
        return { session: null } as never;
      }
      if (path.endsWith("/claim")) return { commands: server.queue.shift() ?? [] } as never;
      return {} as never;
    }),
    put: vi.fn(async (path: string, body?: unknown) => {
      requests.push({ method: "PUT", path, body });
      return {} as never;
    }),
    postFormData: vi.fn(async (path: string, body: FormData) => {
      requests.push({ method: "POST", path, body });
      return new Response("{}");
    }),
  };
  const capture = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
  const contextListeners = new Set<() => void>();
  const contextChanged = () => contextListeners.forEach((listener) => listener());
  const deps: RemoteAssistDeps = {
    http,
    emit: (event, data) => events.push({ event, data }),
    serverEnabled: async () => options.serverEnabled ?? true,
    getActiveConversation: () => "conv-1",
    watchConversation: vi.fn(),
    getFunction: (name) => registry.get(name),
    getFunctions: () => registry.getAll(),
    execute: (name, args) => registry.execute(name, args),
    requiresApproval: (invocation) =>
      options.approval === true || registry.get(invocation.functionName)?.requiresApproval === true,
    recordActivity: (entry) => activity.push(entry),
    getPageState: () => ({ status: "pending" }),
    getErrors: () => options.errors ?? null,
    onFunctionsChanged: (listener) => registry.onChange(listener),
    onContextChanged: (listener) => {
      contextListeners.add(listener);
      return () => contextListeners.delete(listener);
    },
    capture,
    storage: () => storage,
  };
  const controller = new RemoteAssistController(deps, options.config ?? { ui: false, screenshot: true });
  const results = () =>
    requests
      .filter((r) => r.path.endsWith("/result"))
      .map((r) => ({ id: r.path.split("/").at(-2), ...(r.body as object) }));
  return { controller, registry, storage, requests, events, activity, server, http, capture, results, contextChanged };
}

function fnCommand(id: string, seq: number, name: string, args: Record<string, unknown> = {}): RemoteAssistCommand {
  return { id, seq, kind: "function", function: name, arguments: args };
}

/** Bring a fresh controller to an accepted session `s1` on conv-1. */
async function acceptSession(t: ReturnType<typeof setup>) {
  t.server.session = { id: "s1", status: "requested", agent_name: "Jane" };
  await t.controller.refresh("conv-1");
  expect(t.controller.getState()).toBe("requested");
  await t.controller.accept();
  await flush();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RemoteAssistController", () => {
  it("never claims or runs commands for a session it did not consent to (other tab)", async () => {
    const t = setup();
    const handler = vi.fn();
    t.registry.register({ name: "go", description: "d", parameters: { type: "object", properties: {} }, handler });
    t.server.session = { id: "s1", status: "active", agent_name: "Jane" };
    t.server.queue.push([fnCommand("c1", 1, "go")]);

    await t.controller.refresh("conv-1");
    await flush();

    expect(t.controller.getState()).toBe("idle");
    expect(t.requests.some((r) => r.path.endsWith("/claim"))).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs claimed commands in seq order once accepted, and records them as support activity", async () => {
    const t = setup();
    const order: string[] = [];
    t.registry.register({ name: "a", description: "a", parameters: { type: "object", properties: {} }, handler: () => void order.push("a") });
    t.registry.register({ name: "b", description: "b", parameters: { type: "object", properties: {} }, handler: () => ({ ok: order.push("b") }) });
    t.server.queue.push([fnCommand("c2", 2, "b"), fnCommand("c1", 1, "a", { x: 1 })]);

    await acceptSession(t);

    expect(order).toEqual(["a", "b"]);
    expect(t.results()).toEqual([
      { id: "c1", status: "done", result: null, error: null },
      { id: "c2", status: "done", result: { ok: 2 }, error: null },
    ]);
    expect(t.activity[0]).toMatchObject({ actor: "support", name: "support.a", data: { arguments: { x: 1 } } });
    expect(t.activity[0].summary).toContain("Jane");
    expect(JSON.parse(t.storage.getItem(GRANT_STORAGE_KEY)!)).toEqual({ sessionId: "s1", conversationId: "conv-1" });
  });

  it("never executes the same command id twice", async () => {
    const t = setup();
    const handler = vi.fn();
    t.registry.register({ name: "go", description: "d", parameters: { type: "object", properties: {} }, handler });
    t.server.queue.push([fnCommand("c1", 1, "go")], [fnCommand("c1", 1, "go")]);
    await acceptSession(t);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps remote: false functions out of the manifest and refuses them", async () => {
    const t = setup();
    const secret = vi.fn();
    t.registry.register({ name: "pay", description: "pay", parameters: { type: "object", properties: {} }, handler: secret, remote: false });
    t.registry.register({ name: "nav", description: "nav", parameters: { type: "object", properties: {} }, handler: () => "ok" });
    t.server.queue.push([fnCommand("c1", 1, "pay"), fnCommand("c2", 2, "missing")]);

    await acceptSession(t);

    const accept = t.requests.find((r) => r.path.endsWith("/accept"))!.body as { functions: Array<{ name: string }> };
    expect(accept.functions.map((f) => f.name)).toEqual(["nav"]);
    expect(secret).not.toHaveBeenCalled();
    expect(t.results()).toEqual([
      expect.objectContaining({ id: "c1", status: "rejected", error: expect.stringContaining("pay") }),
      expect.objectContaining({ id: "c2", status: "rejected", error: expect.stringContaining("missing") }),
    ]);
  });

  it("reports a throwing handler as failed with its message", async () => {
    const t = setup();
    t.registry.register({
      name: "boom",
      description: "d",
      parameters: { type: "object", properties: {} },
      handler: () => {
        throw new Error("cart is locked");
      },
    });
    t.server.queue.push([fnCommand("c1", 1, "boom")]);
    await acceptSession(t);
    expect(t.results()).toEqual([
      expect.objectContaining({ id: "c1", status: "failed", error: expect.stringContaining("cart is locked") }),
    ]);
  });

  it("holds a gated function for the visitor's approval: awaiting_approval first, then done", async () => {
    const t = setup();
    const handler = vi.fn(() => "applied");
    t.registry.register({ name: "refund", description: "d", parameters: { type: "object", properties: {} }, handler, requiresApproval: true });
    t.server.queue.push([fnCommand("c1", 1, "refund", { amount: 5 })]);

    await acceptSession(t);
    expect(handler).not.toHaveBeenCalled();
    expect(t.results()).toEqual([{ id: "c1", status: "awaiting_approval", result: null, error: null }]);
    expect(t.controller.getSnapshot().pendingApproval).toMatchObject({ commandId: "c1", functionName: "refund", agentName: "Jane" });
    expect(t.events.some((e) => e.event === "remoteAssist:approval")).toBe(true);

    t.controller.approve("c1");
    await flush();
    expect(handler).toHaveBeenCalledWith({ amount: 5 });
    expect(t.results().at(-1)).toEqual({ id: "c1", status: "done", result: "applied", error: null });
  });

  it("reports a declined approval as rejected without running the function", async () => {
    const t = setup({ approval: true });
    const handler = vi.fn();
    t.registry.register({ name: "go", description: "d", parameters: { type: "object", properties: {} }, handler });
    t.server.queue.push([fnCommand("c1", 1, "go")]);
    await acceptSession(t);
    t.controller.reject("c1");
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(t.results().at(-1)).toEqual(expect.objectContaining({ id: "c1", status: "rejected" }));
  });

  it("stop is local first: queued commands are dropped even when the network fails", async () => {
    const t = setup();
    let finishFirst!: () => void;
    const first = vi.fn(() => new Promise<void>((resolve) => (finishFirst = resolve)));
    const second = vi.fn();
    t.registry.register({ name: "first", description: "d", parameters: { type: "object", properties: {} }, handler: first });
    t.registry.register({ name: "second", description: "d", parameters: { type: "object", properties: {} }, handler: second });
    t.server.queue.push([fnCommand("c1", 1, "first"), fnCommand("c2", 2, "second")]);
    await acceptSession(t);
    expect(first).toHaveBeenCalled();

    t.server.failEnd = true;
    t.controller.stop();
    // Synchronously idle: no await between the click and the state flip.
    expect(t.controller.getState()).toBe("idle");
    expect(t.storage.getItem(GRANT_STORAGE_KEY)).toBeNull();
    expect(t.events.at(-1)).toEqual({ event: "remoteAssist:ended", data: { sessionId: "s1", reason: "stopped" } });

    finishFirst();
    await flush();
    expect(second).not.toHaveBeenCalled();
    // The in-flight command's result is not posted after the stop either.
    expect(t.results().filter((r) => r.id === "c1")).toEqual([]);
    expect(t.requests.some((r) => r.path.endsWith("/s1/end"))).toBe(true);
  });

  it("stop during an approval cancels it without running or reporting", async () => {
    const t = setup({ approval: true });
    const handler = vi.fn();
    t.registry.register({ name: "go", description: "d", parameters: { type: "object", properties: {} }, handler });
    t.server.queue.push([fnCommand("c1", 1, "go")]);
    await acceptSession(t);
    const posted = t.results().length;
    t.controller.stop();
    t.controller.approve("c1");
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(t.results()).toHaveLength(posted);
  });

  it("declining ends the request and does not prompt again for the same session", async () => {
    const t = setup();
    t.server.session = { id: "s1", status: "requested", agent_name: null };
    await t.controller.refresh("conv-1");
    t.server.failEnd = true;
    t.controller.decline();
    expect(t.controller.getState()).toBe("idle");
    // The server has not caught up yet: still "requested".
    t.server.session = { id: "s1", status: "requested", agent_name: null };
    await t.controller.refresh("conv-1");
    expect(t.controller.getState()).toBe("idle");
    expect(t.events.filter((e) => e.event === "remoteAssist:requested")).toHaveLength(1);
  });

  it("resumes after a reload only in the tab that consented", async () => {
    const storage = memoryStorage();
    storage.setItem(GRANT_STORAGE_KEY, JSON.stringify({ sessionId: "s1", conversationId: "conv-1" }));
    const consenting = setup({ storage });
    const run = vi.fn();
    consenting.registry.register({ name: "go", description: "d", parameters: { type: "object", properties: {} }, handler: run });
    consenting.server.session = { id: "s1", status: "active", agent_name: "Jane" };
    consenting.server.queue.push([fnCommand("c1", 1, "go")]);
    consenting.controller.start();
    await flush();
    expect(consenting.controller.getState()).toBe("active");
    expect(run).toHaveBeenCalledTimes(1);

    const otherTab = setup();
    const otherRun = vi.fn();
    otherTab.registry.register({ name: "go", description: "d", parameters: { type: "object", properties: {} }, handler: otherRun });
    otherTab.server.session = { id: "s1", status: "active", agent_name: "Jane" };
    otherTab.server.queue.push([fnCommand("c1", 1, "go")]);
    otherTab.controller.start();
    await otherTab.controller.refresh("conv-1");
    await flush();
    expect(otherTab.controller.getState()).toBe("idle");
    expect(otherRun).not.toHaveBeenCalled();
  });

  it("drops a stored grant the server no longer knows", async () => {
    const storage = memoryStorage();
    storage.setItem(GRANT_STORAGE_KEY, JSON.stringify({ sessionId: "s-old", conversationId: "conv-1" }));
    const t = setup({ storage });
    t.server.session = null;
    t.controller.start();
    await flush();
    expect(storage.getItem(GRANT_STORAGE_KEY)).toBeNull();
    // A later session on the same conversation is not auto-granted.
    t.server.session = { id: "s-old", status: "active" };
    await t.controller.refresh("conv-1");
    expect(t.controller.getState()).toBe("idle");
  });

  it("rejects screenshots unless the host allowed them", async () => {
    const t = setup({ config: { ui: false } });
    t.server.queue.push([{ id: "c1", seq: 1, kind: "screenshot", function: null, arguments: {} }]);
    await acceptSession(t);
    expect(t.capture).not.toHaveBeenCalled();
    expect(t.results()).toEqual([expect.objectContaining({ id: "c1", status: "rejected" })]);
  });

  it("uploads an allowed screenshot as multipart, and reports a capture failure as failed", async () => {
    const t = setup();
    t.server.queue.push([
      { id: "c1", seq: 1, kind: "screenshot", function: null, arguments: {} },
      { id: "c2", seq: 2, kind: "screenshot", function: null, arguments: {} },
    ]);
    t.capture
      .mockResolvedValueOnce(new Blob(["png"], { type: "image/png" }))
      .mockRejectedValueOnce(new Error("renderer unavailable"));
    await acceptSession(t);
    const upload = t.requests.find((r) => r.path.endsWith("/commands/c1/screenshot"));
    expect((upload?.body as FormData).get("file")).toBeInstanceOf(Blob);
    expect(t.results()).toEqual([
      expect.objectContaining({ id: "c2", status: "failed", error: "renderer unavailable" }),
    ]);
  });

  it("ends the session when the handoff leaves the human agent", async () => {
    const t = setup();
    await acceptSession(t);
    t.controller.onHandoffChange("conv-1", { state: "waiting", agentName: null, requestedAt: null });
    expect(t.controller.getState()).toBe("idle");
    expect(t.events.at(-1)).toEqual({ event: "remoteAssist:ended", data: { sessionId: "s1", reason: "handoff_ended" } });
  });

  it("sends the page context on accept: manifest, page and capped state", async () => {
    const t = setup();
    t.registry.register({ name: "nav", description: "nav", parameters: { type: "object", properties: {} }, handler: () => 1 });
    await acceptSession(t);
    const accept = t.requests.find((r) => r.path.endsWith("/accept"))!.body as Record<string, unknown>;
    expect(accept).toMatchObject({
      screenshot: true,
      state: { status: "pending" },
      page: { url: expect.any(String), title: expect.any(String) },
    });
  });

  it("sends the recent page errors only when the host enabled the error watcher", async () => {
    const off = setup();
    await acceptSession(off);
    expect((off.requests.find((r) => r.path.endsWith("/accept"))!.body as { errors: unknown }).errors).toBeNull();

    const on = setup({
      errors: [
        {
          type: "unhandledrejection",
          message: "PDF export failed",
          source: "https://app.example.com/app.js",
          line: 42,
          stack: "x".repeat(5_000),
          route: "/invoices",
          firstAt: Date.UTC(2026, 0, 1, 10, 0, 0),
          lastAt: Date.UTC(2026, 0, 1, 10, 0, 5),
          count: 2,
        },
      ],
    });
    await acceptSession(on);
    const { errors } = on.requests.find((r) => r.path.endsWith("/accept"))!.body as { errors: Array<Record<string, unknown>> };
    expect(errors).toEqual([
      {
        type: "unhandledrejection",
        message: "PDF export failed",
        source: "https://app.example.com/app.js",
        line: 42,
        col: null,
        stack: "x".repeat(4_000),
        route: "/invoices",
        first_at: "2026-01-01T10:00:00.000Z",
        last_at: "2026-01-01T10:00:05.000Z",
        count: 2,
      },
    ]);
  });

  it("tells the agent about a new error, not about a known one firing again", async () => {
    vi.useFakeTimers();
    const pageError: CapturedError = { type: "console", message: "poll failed", route: "/", firstAt: 1_000, lastAt: 1_000, count: 1 };
    const errors = [pageError];
    const t = setup({ errors });
    await acceptSession(t);
    const updates = () => t.requests.filter((r) => r.path.endsWith("/context")).length;
    const change = async () => {
      t.contextChanged();
      await vi.advanceTimersByTimeAsync(600);
    };

    await change();
    expect(updates()).toBe(1);

    errors[0] = { ...pageError, lastAt: 31_000, count: 2 };
    await change();
    expect(updates()).toBe(1);

    errors.push({ ...pageError, message: "save failed", firstAt: 40_000, lastAt: 40_000 });
    await change();
    expect(updates()).toBe(2);
  });

  it("needs both opt-ins: the host config and the workspace setting", async () => {
    expect(await setup({ config: false }).controller.liveQuery()).toBe("");
    expect(await setup({ config: true, serverEnabled: false }).controller.liveQuery()).toBe("");
    expect(await setup({ config: true }).controller.liveQuery()).toBe("?remote_assist=1");

    const off = setup({ serverEnabled: false });
    off.server.session = { id: "s1", status: "requested" };
    await off.controller.refresh("conv-1");
    expect(off.controller.getState()).toBe("idle");
    expect(off.requests).toEqual([]);
  });

  it("is available from a browser entry point", async () => {
    const { AgoClient } = await import("../src/index");
    const client = new AgoClient({ baseUrl: "https://api.test", remoteAssist: true });
    expect(client.remoteAssist.isEnabled()).toBe(true);
    client.destroy();
  });
});
