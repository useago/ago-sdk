import { describe, it, expect, vi, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { createAgoProactive } from "../src/proactive/createAgoProactive";
import type {
  ProactiveNudgeInstance,
  ProactiveOptions,
  ProactiveTrigger,
} from "../src/proactive/types";
import type { StorageLike } from "../src/state/createStore";

// ---------------------------------------------------------------------------
// Harness: URL-routing fetch stub (same pattern as AgoClient.pauseResume.test)
// serving the config, evaluate, events, and messages endpoints.
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

const DONE_STREAM = [
  'data: {"message_id":"m1","thread":{"id":"c1"},"content":"ok","status":"DONE"}\n\n',
];

type FetchCall = { url: string; body: Record<string, unknown> | undefined };

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

interface SetupOptions {
  triggers: ProactiveTrigger[];
  proactiveOptions?: Partial<ProactiveOptions>;
  /** The /config response. Default: proactive enabled. */
  config?: unknown | (() => Response);
  /** The /evaluate response (object) or a Response factory (for 429s). */
  evaluate?: unknown | (() => Response);
  clientConfig?: Partial<ConstructorParameters<typeof AgoClient>[0]>;
}

function setup(options: SetupOptions) {
  const calls: FetchCall[] = [];
  const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({
      url: u,
      body: init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined,
    });
    if (u.includes("/api/sdk/v1/config")) {
      const config = options.config ?? { proactive: { enabled: true } };
      return typeof config === "function" ? (config as () => Response)() : jsonResponse(config);
    }
    if (u.includes("/api/sdk/v1/proactive/evaluate")) {
      const evaluate = options.evaluate ?? { intervene: false, message: null, action: null, nudge_id: "s1" };
      return typeof evaluate === "function"
        ? (evaluate as () => Response)()
        : jsonResponse(evaluate);
    }
    if (u.includes("/api/sdk/v1/proactive/events")) {
      return jsonResponse({ status: "ok" });
    }
    if (u.includes("/api/sdk/v1/messages")) {
      return sseResponse(DONE_STREAM);
    }
    throw new Error(`Unmatched fetch: ${u}`);
  });
  vi.stubGlobal("fetch", fetchFn);

  const client = new AgoClient({
    baseUrl: "https://example.test",
    agent: "support",
    ...options.clientConfig,
  });
  const controller = createAgoProactive(client, {
    triggers: options.triggers,
    storage: memoryStorage(),
    ...options.proactiveOptions,
  });

  const readyNudges: ProactiveNudgeInstance[] = [];
  client.on("nudge:ready", (nudge) => readyNudges.push(nudge));

  const callsTo = (fragment: string) => calls.filter((c) => c.url.includes(fragment));

  return { client, controller, calls, callsTo, readyNudges };
}

const staticTrigger = (
  overrides: Partial<ProactiveTrigger> = {}
): ProactiveTrigger => ({
  id: "t-static",
  when: {},
  cooldownMs: 300_000,
  intervene: { type: "static", message: "Stuck? I can help." },
  ...overrides,
});

let activeClient: AgoClient | null = null;

afterEach(() => {
  activeClient?.destroy();
  activeClient = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ProactiveEngine", () => {
  it("emits nudge:ready for a matching static trigger once the kill-switch confirms", async () => {
    vi.useFakeTimers();
    const { client, readyNudges, callsTo } = setup({
      triggers: [staticTrigger({ goal: "help the user" })],
    });
    activeClient = client;

    await vi.advanceTimersByTimeAsync(1_000);

    expect(readyNudges).toHaveLength(1);
    const nudge = readyNudges[0];
    expect(nudge.source).toBe("static");
    expect(nudge.message).toBe("Stuck? I can help.");
    expect(nudge.triggerId).toBe("t-static");
    expect(nudge.goal).toBe("help the user");
    expect(nudge.id).toBeTruthy();
    expect(client.proactive?.getActiveNudge()?.id).toBe(nudge.id);
    // Static path never calls the evaluate endpoint.
    expect(callsTo("/proactive/evaluate")).toHaveLength(0);
  });

  it("stays disabled when the config omits proactive.enabled (kill-switch default off)", async () => {
    vi.useFakeTimers();
    const { client, readyNudges } = setup({
      triggers: [staticTrigger()],
      config: {},
    });
    activeClient = client;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(readyNudges).toHaveLength(0);
  });

  it("stays disabled when the config fetch fails", async () => {
    vi.useFakeTimers();
    const { client, readyNudges } = setup({
      triggers: [staticTrigger()],
      config: () => jsonResponse({ error: "boom" }, 500),
    });
    activeClient = client;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(readyNudges).toHaveLength(0);
  });

  it("enabledOverride: true enables without fetching the config (demo escape hatch)", async () => {
    vi.useFakeTimers();
    const { client, readyNudges, callsTo } = setup({
      triggers: [staticTrigger()],
      proactiveOptions: { enabledOverride: true },
      // Would disable if it were consulted:
      config: {},
    });
    activeClient = client;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(readyNudges).toHaveLength(1);
    expect(callsTo("/api/sdk/v1/config")).toHaveLength(0);
  });

  it("reviveAfterDestroy() re-attaches the controller (React StrictMode double-mount)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "ok" }))
    );

    // Constructor path, like AgoProvider/useAgo builds it.
    const client = new AgoClient({
      baseUrl: "https://example.test",
      agent: "support",
      proactive: {
        triggers: [staticTrigger()],
        enabledOverride: true,
        storage: memoryStorage(),
      },
    });
    activeClient = client;
    expect(client.proactive).not.toBeNull();

    // StrictMode simulated unmount: useAgo's cleanup destroys the memoized
    // client…
    client.destroy();
    expect(client.proactive).toBeNull();

    // …then the remounted effect revives the SAME instance.
    client.reviveAfterDestroy();
    expect(client.proactive).not.toBeNull();

    const readyNudges: ProactiveNudgeInstance[] = [];
    client.on("nudge:ready", (nudge) => readyNudges.push(nudge));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(readyNudges).toHaveLength(1);

    // Idempotent: reviving a live client must not replace the controller.
    const controller = client.proactive;
    client.reviveAfterDestroy();
    expect(client.proactive).toBe(controller);
  });

  it("enabledOverride: false disables even when the server says enabled", async () => {
    vi.useFakeTimers();
    const { client, readyNudges, callsTo } = setup({
      triggers: [staticTrigger()],
      proactiveOptions: { enabledOverride: false },
      config: { proactive: { enabled: true } },
    });
    activeClient = client;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(readyNudges).toHaveLength(0);
    expect(callsTo("/api/sdk/v1/config")).toHaveLength(0);
  });

  it("does not fire while the trigger conditions are unmet", async () => {
    vi.useFakeTimers();
    const { client, readyNudges } = setup({
      triggers: [staticTrigger({ when: { idleMs: 30_000 } })],
    });
    activeClient = client;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(readyNudges).toHaveLength(0);

    // Idle crosses the threshold → next tick fires.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(readyNudges).toHaveLength(1);
  });

  it("calls /evaluate with the contract body and surfaces an intervening response", async () => {
    vi.useFakeTimers();
    const { client, readyNudges, callsTo } = setup({
      triggers: [
        {
          id: "kyc-doc-stuck",
          when: {},
          intervene: "agent",
          goal: "Help the user upload their KYC documents",
        },
      ],
      evaluate: {
        intervene: true,
        message: "Il manque un justificatif — je peux vous guider.",
        action: {
          label: "Pré-remplir pour moi",
          function_name: "prefillForm",
          arguments: { step: "documents" },
        },
        nudge_id: "server-uuid-1",
      },
    });
    activeClient = client;
    client.registerFunction("prefillForm", async () => ({ ok: true }), {
      description: "Prefill",
      parameters: { type: "object", properties: {} },
    });

    await vi.advanceTimersByTimeAsync(1_000);

    const evaluateCalls = callsTo("/proactive/evaluate");
    expect(evaluateCalls).toHaveLength(1);
    const body = evaluateCalls[0].body!;
    // Backend contract: POST /api/sdk/v1/proactive/evaluate
    expect(body.trigger_id).toBe("kyc-doc-stuck");
    expect(body.goal).toBe("Help the user upload their KYC documents");
    expect(body.agent).toBe("support");
    expect(typeof body.client_nudge_id).toBe("string");
    expect(body.signals).toMatchObject({ route: expect.any(String) });
    expect(body.client_context).toHaveProperty("entries");
    expect(body.client_functions).toEqual([
      expect.objectContaining({ name: "prefillForm" }),
    ]);

    expect(readyNudges).toHaveLength(1);
    const nudge = readyNudges[0];
    expect(nudge.source).toBe("agent");
    expect(nudge.id).toBe(body.client_nudge_id);
    expect(nudge.serverNudgeId).toBe("server-uuid-1");
    expect(nudge.action).toEqual({
      label: "Pré-remplir pour moi",
      functionName: "prefillForm",
      arguments: { step: "documents" },
    });
  });

  it("treats intervene:false as silence and cooldown prevents re-evaluating every tick", async () => {
    vi.useFakeTimers();
    const { client, readyNudges, callsTo } = setup({
      triggers: [{ id: "t-agent", when: {}, cooldownMs: 60_000, intervene: "agent" }],
      evaluate: { intervene: false, message: null, action: null, nudge_id: "s2" },
    });
    activeClient = client;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(readyNudges).toHaveLength(0);
    // The firing attempt started the cooldown: one call, not one per tick.
    expect(callsTo("/proactive/evaluate")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(callsTo("/proactive/evaluate")).toHaveLength(2);
  });

  it("treats a 429 (server cap) as silence", async () => {
    vi.useFakeTimers();
    const { client, readyNudges, callsTo } = setup({
      triggers: [{ id: "t-agent", when: {}, intervene: "agent" }],
      evaluate: () => jsonResponse({ error: "rate limited" }, 429),
    });
    activeClient = client;

    await vi.advanceTimersByTimeAsync(2_000);
    expect(callsTo("/proactive/evaluate").length).toBeGreaterThanOrEqual(1);
    expect(readyNudges).toHaveLength(0);
  });

  it("holds a single-nudge slot and applies dismissal memory", async () => {
    vi.useFakeTimers();
    const { client, controller, readyNudges } = setup({
      triggers: [
        staticTrigger({ id: "t-one" }),
        staticTrigger({ id: "t-two", intervene: { type: "static", message: "Second" } }),
      ],
    });
    activeClient = client;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(readyNudges).toHaveLength(1);
    expect(readyNudges[0].triggerId).toBe("t-one");

    // Slot occupied: nothing else fires while the nudge is up.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readyNudges).toHaveLength(1);

    // Dismissal frees the slot but suppresses t-one; t-two fires next.
    controller.dismiss(readyNudges[0]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(readyNudges).toHaveLength(2);
    expect(readyNudges[1].triggerId).toBe("t-two");
  });

  it("suppresses nudges while the UI declares the user engaged", async () => {
    vi.useFakeTimers();
    const { client, controller, readyNudges } = setup({
      triggers: [staticTrigger()],
    });
    activeClient = client;

    controller.setEngaged(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readyNudges).toHaveLength(0);

    controller.setEngaged(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(readyNudges).toHaveLength(1);
  });

  it("respects the user opt-out", async () => {
    vi.useFakeTimers();
    const { client, controller, readyNudges } = setup({
      triggers: [staticTrigger()],
    });
    activeClient = client;

    controller.optOut();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readyNudges).toHaveLength(0);
    expect(controller.isOptedOut()).toBe(true);

    controller.optIn();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(readyNudges).toHaveLength(1);
  });

  it("caps shown nudges per session", async () => {
    vi.useFakeTimers();
    const { client, controller, readyNudges } = setup({
      triggers: [
        staticTrigger({ id: "t-one" }),
        staticTrigger({ id: "t-two", intervene: { type: "static", message: "Second" } }),
      ],
      proactiveOptions: { frequencyCap: { perSession: 1 } },
    });
    activeClient = client;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(readyNudges).toHaveLength(1);
    controller.shown(readyNudges[0]);
    controller.dismiss(readyNudges[0]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(readyNudges).toHaveLength(1); // session cap reached
  });

  it("accept() runs the action through the FunctionRegistry and pre-seeds the chat", async () => {
    vi.useFakeTimers();
    const handler = vi.fn(async () => ({ done: true }));
    const { client, controller, readyNudges, callsTo } = setup({
      triggers: [
        staticTrigger({
          goal: "Help finish the checkout",
          intervene: {
            type: "static",
            message: "Want a hand?",
            action: { label: "Do it", functionName: "prefillForm", arguments: { a: 1 } },
          },
        }),
      ],
    });
    activeClient = client;
    client.registerFunction("prefillForm", handler, {
      description: "Prefill",
      parameters: { type: "object", properties: {} },
    });

    const accepted: unknown[] = [];
    client.on("nudge:accepted", (data) => accepted.push(data));

    // Open a conversation first: hidden kickoffs target an EXISTING thread
    // (the backend rejects a hidden message that would open one).
    await client.sendMessage("bonjour");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(readyNudges).toHaveLength(1);

    await controller.accept(readyNudges[0]);
    await vi.advanceTimersByTimeAsync(0);

    expect(handler).toHaveBeenCalledWith({ a: 1 });
    expect(accepted).toEqual([{ nudge: readyNudges[0] }]);
    expect(controller.getActiveNudge()).toBeNull();

    // Hidden kickoff message (the auto-continuation `hidden: true` pattern),
    // targeted at the conversation the client just used.
    const messageCalls = callsTo("/api/sdk/v1/messages");
    expect(messageCalls).toHaveLength(2);
    expect(messageCalls[1].body?.hidden).toBe(true);
    expect(messageCalls[1].body?.conversation_id).toBe("c1");
    expect(String(messageCalls[1].body?.content)).toContain("Want a hand?");
  });

  it("accept() with no open conversation sends the trigger's visible kickoff line", async () => {
    vi.useFakeTimers();
    const { client, controller, readyNudges, callsTo } = setup({
      triggers: [
        staticTrigger({
          goal: "Help finish the checkout",
          kickoff: "Oui, aidez-moi à finaliser !",
        }),
      ],
    });
    activeClient = client;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(readyNudges).toHaveLength(1);

    await controller.accept(readyNudges[0]);
    await vi.advanceTimersByTimeAsync(0);

    const messageCalls = callsTo("/api/sdk/v1/messages");
    expect(messageCalls).toHaveLength(1);
    expect(messageCalls[0].body?.hidden).toBeUndefined();
    expect(messageCalls[0].body?.conversation_id).toBeUndefined();
    expect(messageCalls[0].body?.content).toBe("Oui, aidez-moi à finaliser !");
  });

  it("accept() with no open conversation and no kickoff skips the chat pre-seed", async () => {
    vi.useFakeTimers();
    const { client, controller, readyNudges, callsTo } = setup({
      triggers: [staticTrigger({ goal: "Help finish the checkout" })],
    });
    activeClient = client;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(readyNudges).toHaveLength(1);

    await controller.accept(readyNudges[0]);
    await vi.advanceTimersByTimeAsync(0);

    expect(callsTo("/api/sdk/v1/messages")).toHaveLength(0);
  });

  it("tracks shown/dismissed (static nudges included) in one batched events call", async () => {
    vi.useFakeTimers();
    const { client, controller, readyNudges, callsTo } = setup({
      triggers: [staticTrigger()],
    });
    activeClient = client;

    await vi.advanceTimersByTimeAsync(1_000);
    controller.shown(readyNudges[0]);
    controller.shown(readyNudges[0]); // idempotent
    controller.dismiss(readyNudges[0]);

    await vi.advanceTimersByTimeAsync(5_000);
    const eventCalls = callsTo("/proactive/events");
    expect(eventCalls).toHaveLength(1);
    const events = eventCalls[0].body?.events as Array<Record<string, unknown>>;
    expect(events.map((e) => e.type)).toEqual(["shown", "dismissed"]);
    expect(events[0]).toMatchObject({
      client_nudge_id: readyNudges[0].id,
      trigger_id: "t-static",
      source: "static",
      agent: "support",
    });
    expect(typeof events[0].occurred_at).toBe("string");
  });

  it("registers the friction snapshot as client_context on every message", async () => {
    vi.useFakeTimers();
    const { client, callsTo } = setup({ triggers: [staticTrigger({ when: { idleMs: 999_999 } })] });
    activeClient = client;
    await vi.advanceTimersByTimeAsync(1_000);

    const sendPromise = client.sendMessage("hello");
    await vi.advanceTimersByTimeAsync(0);
    await sendPromise;

    const messageCall = callsTo("/api/sdk/v1/messages")[0];
    const context = messageCall.body?.client_context as {
      entries: Record<string, { data?: Record<string, unknown> }>;
    };
    expect(context.entries).toHaveProperty("friction_signals");
    const data = context.entries.friction_signals.data!;
    expect(data).toMatchObject({
      route: expect.any(String),
      idleMs: expect.any(Number),
      dwellMs: expect.any(Number),
      rageClicks: expect.any(Number),
    });
    // Page state rides in its own page-state:* entries, not here.
    expect(data).not.toHaveProperty("pageState");
  });

  it("is wired through AgoConfig.proactive and torn down by client.destroy()", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        calls.push(String(url));
        return jsonResponse({ proactive: { enabled: true } });
      })
    );

    const client = new AgoClient({
      baseUrl: "https://example.test",
      proactive: { triggers: [staticTrigger()], storage: memoryStorage() },
    });
    expect(client.proactive).not.toBeNull();

    const ready: unknown[] = [];
    client.on("nudge:ready", (n) => ready.push(n));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ready).toHaveLength(1);

    client.destroy();
    expect(client.proactive).toBeNull();
  });
});
