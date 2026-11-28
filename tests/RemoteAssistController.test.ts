import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityInput } from "../src/activity/ActivityLedger";
import { AgoApiError } from "../src/client/errors";
import type { CapturedError } from "../src/errors/ErrorWatcher";
import { FunctionRegistry } from "../src/functions/FunctionRegistry";
import type { NavRoute } from "../src/functions/navigation";
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
    canRecord?: boolean;
    routes?: NavRoute[];
    answerCall?: RemoteAssistDeps["answerCall"];
  } = {},
) {
  const registry = new FunctionRegistry();
  const storage = options.storage ?? memoryStorage();
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const events: Array<{ event: string; data: unknown }> = [];
  const activity: ActivityInput[] = [];
  const server = {
    session: null as null | {
      id: string;
      status: string;
      agent_name?: string | null;
      expires_at?: string | null;
      call?: { id: string; status: string } | null;
    },
    queue: [] as RemoteAssistCommand[][],
    failEnd: false,
    /** Status the next `/live` posts fail with. */
    liveStatus: null as null | number,
    /** While set, `/live` posts wait for it. */
    liveGate: null as null | Promise<void>,
  };
  const recorder = {
    mask: null as readonly string[] | null,
    emit: (_event: unknown): void => undefined,
    stopped: 0,
    snapshots: 0,
    nodes: new Map<number, Node>(),
  };
  const record = vi.fn(async (emit: (event: unknown) => void, mask: readonly string[]) => {
    recorder.mask = mask;
    recorder.emit = emit;
    emit({ type: 4, timestamp: 1 });
    emit({ type: 2, timestamp: 1 });
    return {
      stop: () => void recorder.stopped++,
      getNode: (id: number) => recorder.nodes.get(id) ?? null,
      takeFullSnapshot: () => {
        recorder.snapshots++;
        emit({ type: 2, timestamp: 2 });
      },
    };
  });
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
      if (path.endsWith("/call/join")) {
        return {
          call: { id: server.session?.call?.id, offer: "v=0 offer" },
          ice_servers: [{ urls: ["turn:turn.example.com:3478"], username: "u", credential: "c" }],
          ice_transport_policy: "relay",
        } as never;
      }
      if (path.endsWith("/call/answer")) {
        if (server.session?.call) server.session = { ...server.session, call: { ...server.session.call, status: "connected" } };
        return {} as never;
      }
      if (path.endsWith("/call/end")) {
        if (server.session) server.session = { ...server.session, call: null };
        return {} as never;
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
      if (path.endsWith("/live")) {
        await server.liveGate;
        if (server.liveStatus) throw new AgoApiError("refused", "refused", server.liveStatus, "conflict");
      }
      return new Response("{}");
    }),
  };
  const capture = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
  const voice = {
    connection: { setMuted: vi.fn(), close: vi.fn() },
    onConnectionState: (_state: RTCPeerConnectionState): void => undefined,
    answerCall: vi.fn(async (callOptions: Parameters<NonNullable<RemoteAssistDeps["answerCall"]>>[0]) => {
      voice.onConnectionState = callOptions.onConnectionState;
      return { answer: "v=0 answer", connection: voice.connection };
    }),
  };
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
    canRecord: () => options.canRecord ?? true,
    record,
    getRoutes: () => options.routes ?? null,
    canCall: () => true,
    answerCall: options.answerCall ?? voice.answerCall,
  };
  const controller = new RemoteAssistController(deps, options.config ?? { ui: false, screenshot: true });
  const results = () =>
    requests
      .filter((r) => r.path.endsWith("/result"))
      .map((r) => ({ id: r.path.split("/").at(-2), ...(r.body as object) }));
  const liveBatches = () => requests.filter((r) => r.path.endsWith("/s1/live"));
  return {
    controller, registry, storage, requests, events, activity, server, http, capture, results, contextChanged,
    recorder, record, liveBatches, voice,
  };
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

describe("RemoteAssistController live view", () => {
  const LIVE = { ui: false, liveView: { mask: [".iban"] } } as const;
  const noop = { type: "object" as const, properties: {} };

  const readBlob = (blob: Blob) =>
    new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blob);
    });

  async function decode(request: { body?: unknown }): Promise<unknown[]> {
    const bytes = await readBlob((request.body as FormData).get("file") as Blob);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /** Fake timers, and no gzip so batches are encoded without real async I/O. */
  function plainTimers() {
    vi.stubGlobal("CompressionStream", undefined);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  function clickCommand(id: string, node: number, expectPreview: unknown): RemoteAssistCommand {
    const fn = (expectPreview as { function?: string })?.function ?? null;
    return { id, seq: 1, kind: "click", function: fn, arguments: { node, expect: expectPreview } };
  }

  it("records only with live view on, once the visitor accepted, and says so in the context", async () => {
    const t = setup({ config: LIVE });
    t.server.session = { id: "s1", status: "requested", agent_name: "Jane" };
    await t.controller.refresh("conv-1");
    expect(t.controller.getSnapshot().session?.liveView).toBe(true);
    expect(t.record).not.toHaveBeenCalled();
    await t.controller.accept();
    await flush();
    expect(t.record).toHaveBeenCalledTimes(1);
    expect(t.recorder.mask).toEqual([".iban"]);
    expect((t.requests.find((r) => r.path.endsWith("/accept"))!.body as { live_view: boolean }).live_view).toBe(true);

    for (const off of [setup({ config: { ui: false } }), setup({ config: LIVE, canRecord: false })]) {
      await acceptSession(off);
      expect(off.record).not.toHaveBeenCalled();
      expect((off.requests.find((r) => r.path.endsWith("/accept"))!.body as { live_view: boolean }).live_view).toBe(false);
      expect(off.controller.getSnapshot().session?.liveView).toBe(false);
    }
  });

  it("sends events in batches every 250 ms, never two requests in flight", async () => {
    plainTimers();
    const t = setup({ config: LIVE });
    let release!: () => void;
    t.server.liveGate = new Promise((resolve) => (release = resolve));
    await acceptSession(t);
    expect(t.liveBatches()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(250);
    expect(t.liveBatches()).toHaveLength(1);
    t.recorder.emit({ type: 3, timestamp: 5 });
    t.recorder.emit({ type: 3, timestamp: 6 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.liveBatches()).toHaveLength(1);

    t.server.liveGate = null;
    release();
    await vi.advanceTimersByTimeAsync(250);
    expect(t.liveBatches()).toHaveLength(2);
    vi.useRealTimers();
    expect(await decode(t.liveBatches()[0])).toEqual([{ type: 4, timestamp: 1 }, { type: 2, timestamp: 1 }]);
    expect(await decode(t.liveBatches()[1])).toEqual([{ type: 3, timestamp: 5 }, { type: 3, timestamp: 6 }]);
  });

  it("gzips the batch when the browser can", async () => {
    const t = setup({ config: LIVE });
    await acceptSession(t);
    await vi.waitFor(() => expect(t.liveBatches()).toHaveLength(1));
    const bytes = await readBlob((t.liveBatches()[0].body as FormData).get("file") as Blob);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    expect(await decode(t.liveBatches()[0])).toHaveLength(2);
  });

  it("takes a full snapshot every 60 s so a late viewer can rebuild the page", async () => {
    plainTimers();
    const t = setup({ config: LIVE });
    await acceptSession(t);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(t.recorder.snapshots).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.recorder.snapshots).toBe(1);
  });

  it("stops recording on every end path and sends nothing recorded afterwards", async () => {
    plainTimers();
    const ends: Array<(t: ReturnType<typeof setup>) => void> = [
      (t) => t.controller.stop(),
      (t) => t.controller.destroy(),
      (t) => t.controller.onActiveConversationChange("conv-2"),
      (t) => t.controller.configure({ ui: false }),
    ];
    for (const end of ends) {
      const t = setup({ config: LIVE });
      await acceptSession(t);
      await vi.advanceTimersByTimeAsync(250);
      const sent = t.liveBatches().length;
      end(t);
      expect(t.recorder.stopped).toBe(1);
      t.recorder.emit({ type: 3, timestamp: 9 });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(t.liveBatches()).toHaveLength(sent);
    }
  });

  it("turning live view off mid-session tells the agent", async () => {
    const t = setup({ config: LIVE });
    await acceptSession(t);
    t.controller.configure({ ui: false });
    await flush();
    expect(t.controller.getState()).toBe("active");
    expect(t.recorder.stopped).toBe(1);
    expect(t.requests.filter((r) => r.path.endsWith("/context")).at(-1)?.body).toMatchObject({ live_view: false });
  });

  it("a 409 stops the recording and re-reads the session", async () => {
    plainTimers();
    const t = setup({ config: LIVE });
    t.server.liveStatus = 409;
    await acceptSession(t);
    const reads = t.requests.filter((r) => r.method === "GET").length;
    await vi.advanceTimersByTimeAsync(250);
    expect(t.recorder.stopped).toBe(1);
    expect(t.requests.filter((r) => r.method === "GET").length).toBeGreaterThan(reads);
    t.recorder.emit({ type: 3, timestamp: 9 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.liveBatches()).toHaveLength(1);
  });

  it("a 413 stops the live view for the session and tells the agent; a 503 is retried", async () => {
    plainTimers();
    const t = setup({ config: LIVE });
    t.server.liveStatus = 503;
    await acceptSession(t);
    await vi.advanceTimersByTimeAsync(250);
    expect(t.recorder.stopped).toBe(0);
    t.server.liveStatus = 413;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.liveBatches()).toHaveLength(2);
    expect(t.recorder.stopped).toBe(1);
    expect(t.requests.filter((r) => r.path.endsWith("/context")).at(-1)?.body).toMatchObject({ live_view: false });
  });

  it("runs the function a clicked element is declared for, typed by its schema", async () => {
    const t = setup({ config: LIVE });
    const handler = vi.fn(() => ({ shown: 12 }));
    t.registry.register({
      name: "setPageState",
      description: "d",
      parameters: { type: "object", properties: { page: { type: "integer" } } },
      handler,
    });
    document.body.innerHTML = `<button data-ago-state="page" data-ago-value="3"><span>3</span></button>`;
    t.recorder.nodes.set(7, document.querySelector("span")!);
    t.server.queue.push([clickCommand("c1", 7, { function: "setPageState", arguments: { page: "3" } })]);

    await acceptSession(t);

    expect(handler).toHaveBeenCalledWith({ page: 3 });
    expect(t.results()).toEqual([
      {
        id: "c1",
        status: "done",
        result: { function: "setPageState", arguments: { page: 3 }, result: { shown: 12 } },
        error: null,
      },
    ]);
    expect(t.activity[0]).toMatchObject({ actor: "support", name: "support.setPageState", data: { arguments: { page: 3 } } });
  });

  it("maps a clicked link to navigateToPage through the registered routes", async () => {
    const t = setup({ config: LIVE, routes: [{ name: "order", path: "/orders/:id", description: "d" }] });
    const navigate = vi.fn();
    t.registry.register({ name: "navigateToPage", description: "d", parameters: noop, handler: navigate });
    document.body.innerHTML = `<a href="/orders/42">Order 42</a>`;
    t.recorder.nodes.set(3, document.querySelector("a")!);
    t.server.queue.push([clickCommand("c1", 3, { function: "navigateToPage", href: "/orders/42" })]);
    await acceptSession(t);
    expect(navigate).toHaveBeenCalledWith({ page: "order", id: "42" });
  });

  it("runs nothing when the page changed, the element is gone, or live view is off", async () => {
    const t = setup({ config: LIVE });
    const handler = vi.fn();
    t.registry.register({ name: "archive", description: "d", parameters: noop, handler });
    document.body.innerHTML = `<button data-ago-action="archive" data-ago-args='{"id":2}'>Archive</button>`;
    t.recorder.nodes.set(1, document.querySelector("button")!);
    t.recorder.nodes.set(2, document.createElement("button"));
    t.server.queue.push([
      clickCommand("c1", 1, { function: "archive", arguments: { id: 1 } }),
      clickCommand("c2", 2, { function: "archive", arguments: {} }),
      clickCommand("c3", 99, { function: "archive", arguments: {} }),
    ]);
    await acceptSession(t);

    const off = setup({ config: { ui: false } });
    off.registry.register({ name: "archive", description: "d", parameters: noop, handler });
    off.server.queue.push([clickCommand("c4", 1, { function: "archive", arguments: { id: 2 } })]);
    await acceptSession(off);

    expect(handler).not.toHaveBeenCalled();
    expect([...t.results(), ...off.results()]).toEqual([
      expect.objectContaining({ id: "c1", status: "rejected", error: "The page changed before the click arrived: nothing was run." }),
      expect.objectContaining({ id: "c2", status: "rejected", error: "The element is no longer on the page." }),
      expect.objectContaining({ id: "c3", status: "rejected", error: "The element is no longer on the page." }),
      expect.objectContaining({ id: "c4", status: "rejected" }),
    ]);
  });

  it("holds a click on a gated function for the visitor's approval, and refuses remote: false", async () => {
    const t = setup({ config: LIVE });
    const refund = vi.fn(() => "ok");
    const secret = vi.fn();
    t.registry.register({ name: "refund", description: "d", parameters: noop, handler: refund, requiresApproval: true });
    t.registry.register({ name: "secret", description: "d", parameters: noop, handler: secret, remote: false });
    document.body.innerHTML = `<button data-ago-action="refund">Refund</button><button data-ago-action="secret">S</button>`;
    const [refundButton, secretButton] = Array.from(document.querySelectorAll("button"));
    t.recorder.nodes.set(1, refundButton);
    t.recorder.nodes.set(2, secretButton);
    t.server.queue.push([
      clickCommand("c0", 2, { function: "secret", arguments: {} }),
      { ...clickCommand("c1", 1, { function: "refund", arguments: {} }), seq: 2 },
    ]);
    await acceptSession(t);

    expect(secret).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
    expect(t.controller.getSnapshot().pendingApproval).toMatchObject({ commandId: "c1", functionName: "refund" });
    t.controller.approve("c1");
    await flush();
    expect(refund).toHaveBeenCalledTimes(1);
    expect(t.results()).toEqual([
      expect.objectContaining({ id: "c0", status: "rejected", error: expect.stringContaining("secret") }),
      expect.objectContaining({ id: "c1", status: "awaiting_approval" }),
      expect.objectContaining({ id: "c1", status: "done", result: { function: "refund", arguments: {}, result: "ok" } }),
    ]);
  });
});

describe("remote-assistance consent prompt", () => {
  it("lists the live view only when the page allows it", async () => {
    const { createRemoteAssistUi } = await import("../src/remoteAssist/ui");
    const { uiCatalog } = await import("../src/i18n");
    const labels = uiCatalog("en").remoteAssist;
    const noop = () => undefined;
    const ui = createRemoteAssistUi({
      accept: noop, decline: noop, stop: noop, approve: noop, reject: noop,
      acceptCall: noop, declineCall: noop, hangUpCall: noop, setCallMuted: noop,
    }, labels);
    const prompt = (liveView: boolean) => {
      ui.render({
        state: "requested",
        session: {
          id: `s-${liveView}`, conversationId: "c", status: "requested", agentName: null,
          requestedAt: null, expiresAt: null, screenshot: false, liveView, voice: false,
        },
        pendingApproval: null,
        accepting: false,
        call: null,
      });
      return document.getElementById("ago-remote-assist")!.textContent;
    };
    try {
      expect(prompt(true)).toContain(labels.canWatchLive);
      expect(prompt(false)).not.toContain(labels.canWatchLive);
    } finally {
      ui.destroy();
    }
  });
});

describe("RemoteAssistController voice call", () => {
  const VOICE = { ui: false, voice: true } as const;
  const callRequests = (t: ReturnType<typeof setup>) =>
    t.requests.filter((r) => r.path.includes("/call/")).map((r) => [r.path.split("/").at(-1), r.body]);
  const callEvents = (t: ReturnType<typeof setup>) =>
    t.events.filter((e) => e.event === "remoteAssist:call").map((e) => e.data);

  async function ring(t: ReturnType<typeof setup>) {
    await acceptSession(t);
    t.server.session = { ...t.server.session!, call: { id: "call-1", status: "ringing" } };
    await t.controller.refresh("conv-1");
  }

  it("rings only on a page that opted in to voice, and tells the agent it can call", async () => {
    const opted = setup({ config: VOICE });
    const other = setup({ config: { ui: false } });

    await ring(opted);
    await ring(other);

    expect((opted.requests.find((r) => r.path.endsWith("/accept"))!.body as { voice: boolean }).voice).toBe(true);
    expect((other.requests.find((r) => r.path.endsWith("/accept"))!.body as { voice: boolean }).voice).toBe(false);
    expect(opted.controller.getSnapshot().call).toEqual({ id: "call-1", sessionId: "s1", status: "ringing", muted: false });
    expect(callEvents(opted)).toEqual([{ sessionId: "s1", callId: "call-1", status: "ringing" }]);
    expect(other.controller.getSnapshot().call).toBeNull();
  });

  it("answers the agent's offer through the relay it was given, then mutes on demand", async () => {
    const t = setup({ config: VOICE });
    await ring(t);

    await t.controller.acceptCall();
    t.voice.onConnectionState("connected");
    t.controller.setCallMuted(true);

    expect(t.voice.answerCall).toHaveBeenCalledWith(expect.objectContaining({
      offer: "v=0 offer",
      iceServers: [{ urls: ["turn:turn.example.com:3478"], username: "u", credential: "c" }],
      iceTransportPolicy: "relay",
    }));
    expect(callRequests(t)).toEqual([
      ["join", { call_id: "call-1" }],
      ["answer", { call_id: "call-1", answer: "v=0 answer" }],
    ]);
    expect(t.controller.getSnapshot().call).toMatchObject({ status: "connected", muted: true });
    expect(t.voice.connection.setMuted).toHaveBeenCalledWith(true);
  });

  it("a refused microphone declines the call; any other failure tells the agent it failed", async () => {
    const denied = setup({
      config: VOICE,
      answerCall: async () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
    });
    const broken = setup({ config: VOICE, answerCall: async () => Promise.reject(new Error("no ICE")) });
    await ring(denied);
    await ring(broken);

    await denied.controller.acceptCall();
    await broken.controller.acceptCall();

    expect(callRequests(denied).at(-1)).toEqual(["end", { call_id: "call-1", failed: false }]);
    expect(callRequests(broken).at(-1)).toEqual(["end", { call_id: "call-1", failed: true }]);
    expect(callEvents(denied).at(-1)).toMatchObject({ status: "ended", reason: "microphone_denied" });
    expect(denied.controller.getSnapshot().call).toBeNull();
  });

  it("hangs up locally when the agent does, and when the session ends, without telling the server again", async () => {
    const t = setup({ config: VOICE });
    await ring(t);
    await t.controller.acceptCall();

    t.server.session = { ...t.server.session!, call: null };
    await t.controller.refresh("conv-1");

    expect(t.voice.connection.close).toHaveBeenCalledTimes(1);
    expect(callEvents(t).at(-1)).toMatchObject({ status: "ended", reason: "ended" });
    expect(callRequests(t).map(([name]) => name)).toEqual(["join", "answer"]);
  });

  it("does not ring again for a declined call", async () => {
    const t = setup({ config: VOICE });
    await ring(t);

    t.controller.declineCall();
    t.server.session = { ...t.server.session!, call: { id: "call-1", status: "ringing" } };
    await t.controller.refresh("conv-1");

    expect(t.controller.getSnapshot().call).toBeNull();
    expect(callRequests(t)).toEqual([["end", { call_id: "call-1", failed: false }]]);
  });

  it("reports a call answered before a reload as failed instead of leaving the agent talking to nobody", async () => {
    const storage = memoryStorage();
    storage.setItem(GRANT_STORAGE_KEY, JSON.stringify({ sessionId: "s1", conversationId: "conv-1" }));
    const t = setup({ config: VOICE, storage });
    t.server.session = { id: "s1", status: "active", call: { id: "call-1", status: "connected" } };

    t.controller.start();
    await flush();

    expect(callRequests(t)).toEqual([["end", { call_id: "call-1", failed: true }]]);
    expect(t.controller.getSnapshot().call).toBeNull();
  });
});

describe("remote-assistance call UI", () => {
  it("shows an incoming call card, then mute and hang up in the banner", async () => {
    const { createRemoteAssistUi } = await import("../src/remoteAssist/ui");
    const { uiCatalog } = await import("../src/i18n");
    const labels = uiCatalog("en").remoteAssist;
    const actions = {
      accept: vi.fn(), decline: vi.fn(), stop: vi.fn(), approve: vi.fn(), reject: vi.fn(),
      acceptCall: vi.fn(), declineCall: vi.fn(), hangUpCall: vi.fn(), setCallMuted: vi.fn(),
    };
    const ui = createRemoteAssistUi(actions, labels);
    const session = {
      id: "s1", conversationId: "c", status: "active" as const, agentName: "Jane",
      requestedAt: null, expiresAt: null, screenshot: false, liveView: false, voice: true,
    };
    const render = (call: { status: "ringing" | "connected"; muted: boolean }) =>
      ui.render({ state: "active", session, pendingApproval: null, accepting: false, call: { id: "call-1", sessionId: "s1", ...call } });
    const click = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>("#ago-remote-assist button")].find((b) => b.textContent === name)!.click();
    try {
      render({ status: "ringing", muted: false });
      expect(document.getElementById("ago-remote-assist")!.textContent).toContain("Jane is calling you");
      click(labels.answer);

      render({ status: "connected", muted: false });
      click(labels.mute);
      click(labels.hangUp);

      expect(document.getElementById("ago-remote-assist")!.textContent).toContain("On a call with Jane");
      expect([actions.acceptCall.mock.calls.length, actions.setCallMuted.mock.calls, actions.hangUpCall.mock.calls.length])
        .toEqual([1, [[true]], 1]);
    } finally {
      ui.destroy();
    }
  });
});

