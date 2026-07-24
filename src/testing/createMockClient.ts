import type { AgoClient } from "../client/AgoClient";
import type {
  AgoClientEvents,
  AgoEventName,
  AgoMessage,
  Conversation,
} from "../client/types";
import type { ClientFunctionSchema } from "../functions/types";
import { createMockVoice } from "./mockVoice";
import type {
  MockVoiceController,
  MockVoiceConversationHandle,
  MockVoiceConversationOptions,
  MockVoiceOptions,
} from "./mockVoice";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFn = (...args: any[]) => any;

export interface MockAgoClientOptions {
  overrides?: Partial<Record<string, MockFn>>;
  /**
   * Options for the mock voice controller behind `mock.voice` (availability,
   * consent). The mock voice works with no mic, WebSocket, or backend.
   */
  voice?: MockVoiceOptions;
}

export interface MockAgoClient extends AgoClient {
  /**
   * A scriptable mock of `client.voice`. Drive it through the public surface
   * (`start`, `acceptConsent`, ...), arm a full conversation with
   * {@link mockVoiceConversation}, or push state/events directly via
   * `__setVoiceState` / `__emitVoiceEvent`. Calls are recorded in `__calls`
   * as `voice.<method>`.
   */
  voice: MockVoiceController;
  /**
   * Simulate a server-pushed event.
   * ```ts
   * mock.__emitEvent("message:complete", { id: "1", content: "hi", ... });
   * ```
   */
  __emitEvent<K extends AgoEventName>(event: K, data: AgoClientEvents[K]): void;

  /**
   * All recorded method calls: `[methodName, ...args][]`
   */
  __calls: Array<{ method: string; args: unknown[] }>;

  /**
   * Get calls for a specific method.
   */
  __callsFor(method: string): Array<{ method: string; args: unknown[] }>;
}

/**
 * Create a mock AgoClient for testing. Works with any framework.
 *
 * ```ts
 * import { createMockClient } from "@useago/sdk/testing";
 *
 * const mock = createMockClient();
 * mock.__emitEvent("message:complete", someMessage);
 * expect(mock.__callsFor("sendMessage")).toHaveLength(1);
 * ```
 */
export function createMockClient(
  options: MockAgoClientOptions = {}
): MockAgoClient {
  const { overrides = {} } = options;

  const noopMessage: AgoMessage = {
    id: "mock-msg-1",
    conversationId: "mock-conv-1",
    content: "Mock response",
    role: "assistant",
    status: "DONE",
    createdAt: new Date(),
  };

  const noopConversation: Conversation = {
    id: "mock-conv-1",
    title: "Mock Conversation",
    lastMessageDate: new Date(),
  };

  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const defaults: Record<string, MockFn> = {
    sendMessage: async () => noopMessage,
    continueMessage: async () => noopMessage,
    resumePendingClientFunctions: async () => null,
    registerResumeGate: () => () => undefined,
    getConversations: async () => [noopConversation],
    getConversation: async () => noopConversation,
    getMessages: async () => [noopMessage],
    submitToolCallForm: async () => ({ status: "completed" }),
    confirmToolCall: async () => undefined,
    rejectToolCall: async () => undefined,
    submitFeedback: async () => undefined,
    registerFunction: () => undefined,
    unregisterFunction: () => true,
    getRegisteredFunctions: () => [] as ClientFunctionSchema[],
    executeClientFunction: async () => undefined,
    getContextSnapshot: () => null,
    notifyContextChanged: () => undefined,
    setContext: () => undefined,
    removeContext: () => true,
    addDynamicContext: () => undefined,
    removeDynamicContext: () => true,
    registerNavigationFunction: () => undefined,
    unregisterNavigationFunction: () => undefined,
    getConfiguredAgent: () => undefined,
    // Minimal transport stub: a proactive engine attached to the mock sees an
    // empty config (→ kill-switch stays off) and swallows POSTs.
    getHttp: () => ({
      get: async () => ({}),
      post: async () => ({}),
    }),
    // Forward nudge events into the mock's listener map so __emitEvent-style
    // flows and a real controller both reach `client.on("nudge:*")` handlers.
    emitProactiveEvent: (event: string, data: unknown) => {
      const handlers = listeners.get(event);
      if (handlers) [...handlers].forEach((h) => h(data));
    },
    on: (event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off: (event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    },
    once: (event: string, handler: (...args: unknown[]) => void) => {
      const wrapper = (...args: unknown[]) => {
        listeners.get(event)?.delete(wrapper);
        handler(...args);
      };
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(wrapper);
    },
    waitFor: (event: string, options?: { timeout?: number }) => {
      return new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const handler = (data: unknown) => {
          if (timer) clearTimeout(timer);
          listeners.get(event)?.delete(handler);
          resolve(data);
        };
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(handler);
        if (options?.timeout) {
          timer = setTimeout(() => {
            listeners.get(event)?.delete(handler);
            reject(new Error(`waitFor("${event}") timed out after ${options.timeout}ms`));
          }, options.timeout);
        }
      });
    },
    updateConfig: () => undefined,
    destroy: () => {
      listeners.clear();
    },
  };

  const merged = { ...defaults, ...overrides } as Record<string, MockFn>;

  // Wrap all methods to record calls
  const mock: Record<string, unknown> = {};

  for (const [key, fn] of Object.entries(merged)) {
    mock[key] = (...args: unknown[]) => {
      calls.push({ method: key, args });
      return (fn as MockFn)(...args);
    };
  }

  // Plain value properties (not wrapped)
  mock.proactive = null;

  // Mock voice controller: records its calls as `voice.<method>` and is torn
  // down with the client.
  const voiceController = createMockVoice(options.voice, (method, args) =>
    calls.push({ method: `voice.${method}`, args })
  );
  mock.voice = voiceController;
  // Mirror the real client: voice events are forwarded onto the client
  // emitter, so `client.on("voice:*")` works against the mock too.
  const voiceEvents = [
    "voice:status",
    "voice:transcript",
    "voice:turn-final",
    "voice:persisted",
    "voice:thread-ready",
    "voice:level",
    "voice:error",
    "voice:ended",
  ] as const;
  for (const event of voiceEvents) {
    voiceController.on(event, (data) => {
      const handlers = listeners.get(event);
      if (handlers) [...handlers].forEach((h) => h(data));
    });
  }
  const baseDestroy = mock.destroy as MockFn;
  mock.destroy = (...args: unknown[]) => {
    voiceController.destroy();
    return baseDestroy(...args);
  };

  // Test helpers (not recorded)
  mock.__calls = calls;
  mock.__callsFor = (method: string) => calls.filter((c) => c.method === method);
  mock.__emitEvent = (event: string, data: unknown) => {
    // Copy the set to avoid mutation during iteration (once handlers remove themselves)
    const handlers = listeners.get(event);
    if (handlers) {
      [...handlers].forEach((h) => h(data));
    }
  };

  return mock as unknown as MockAgoClient;
}

/**
 * Arm a full scripted voice conversation on a mock client, so the voice hook
 * and the three voice components animate end-to-end with no microphone,
 * WebSocket, or backend (jsdom, Storybook, or a plain dev page).
 *
 * The script plays when the session starts: press the rendered
 * `<AgoVoiceButton>` (consent included), or call `handle.play()` to start
 * programmatically. It walks the whole lifecycle: consent, permission,
 * connecting, live, per-turn captions with level pulses and persisted acks,
 * then ended. Timer-driven and deterministic (fake timers step it).
 *
 * ```ts
 * const mock = createMockClient();
 * const handle = mockVoiceConversation(mock, {
 *   turns: [{ user: "Where is my order?", assistant: "It ships today." }],
 * });
 * await handle.play();
 * await handle.finished;
 * ```
 */
export function mockVoiceConversation(
  mock: MockAgoClient,
  options: MockVoiceConversationOptions
): MockVoiceConversationHandle {
  return mock.voice.__arm(options);
}

export type {
  MockVoiceController,
  MockVoiceConversationHandle,
  MockVoiceConversationOptions,
  MockVoiceOptions,
};
