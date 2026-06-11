import type { AgoClient } from "../client/AgoClient";
import type {
  AgoClientEvents,
  AgoEventName,
  AgoMessage,
  Conversation,
} from "../client/types";
import type { ClientFunctionSchema } from "../functions/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFn = (...args: any[]) => any;

export interface MockAgoClientOptions {
  overrides?: Partial<Record<string, MockFn>>;
}

export interface MockAgoClient extends AgoClient {
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
    getConversations: async () => [noopConversation],
    getConversation: async () => noopConversation,
    getMessages: async () => [noopMessage],
    submitToolCallForm: async () => undefined,
    confirmToolCall: async () => undefined,
    rejectToolCall: async () => undefined,
    submitFeedback: async () => undefined,
    registerFunction: () => undefined,
    unregisterFunction: () => true,
    getRegisteredFunctions: () => [] as ClientFunctionSchema[],
    getContextSnapshot: () => null,
    notifyContextChanged: () => undefined,
    registerNavigationFunction: () => undefined,
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
