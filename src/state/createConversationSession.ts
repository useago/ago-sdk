import { createStore, type StorageLike } from "./createStore";

/**
 * Storage key for the visitor's anonymous id. Shared with the HTTP client
 * (`X-User-Anon-Id`) so the same persisted id identifies the visitor everywhere.
 */
const DEFAULT_WIDGET_ID_KEY = "ago_widget_id";

/** Storage key for the cached last active thread (id + its last message time). */
const DEFAULT_THREAD_KEY = "ago_last_thread";

/** Default idle lifetime of a thread before it stops being resumed: 2 hours. */
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

/** Generate a random widget id, preferring `crypto.randomUUID` when available. */
function generateWidgetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (older/embedded runtimes).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Persisted shape: the active thread id plus the time of its last message. */
interface ThreadEnvelope {
  value: string | null;
  /** Epoch ms of the thread's last message; `null` when unknown. */
  lastMessageAt: number | null;
}

export interface ConversationSessionOptions {
  /**
   * Storage backend. Defaults to `localStorage`, degrading to an in-memory store
   * when storage is unavailable (SSR / disabled). Pass `sessionStorage` for a
   * tab-scoped session, or any `{ getItem, setItem }` for a custom backend.
   */
  storage?: StorageLike;
  /**
   * Storage key for the widget id. Default `"ago_widget_id"` — the same key the
   * HTTP client reads, so the visitor's id is shared across the SDK.
   */
  key?: string;
  /**
   * Explicit widget id to adopt (and persist) instead of reading or generating
   * one — e.g. when the host app already has a stable visitor identifier.
   */
  widgetId?: string;
  /** Storage key for the cached last active thread. Default `"ago_last_thread"`. */
  threadKey?: string;
  /**
   * Maximum idle age of a thread to still resume it, in milliseconds, compared
   * against the recorded time of its last message. Checked entirely on the front
   * (no backend call): a thread idle longer than this — or one with no recorded
   * last-message time — is not resumed (`getLastActiveThread` returns `null`).
   * Default 2h. Pass `Infinity` to never expire.
   */
  ttlMs?: number;
}

export interface ConversationSession {
  /**
   * The stable widget id identifying this visitor. Generated once and persisted
   * forever, so a returning visitor keeps the same id (and therefore the same
   * server-side conversation history) across reloads.
   */
  readonly widgetId: string;
  /**
   * The last active thread id, decided **entirely on the front** so a reload costs
   * no backend round-trip. Returns `null` when there is no cached thread, when its
   * last message time is unknown, or when it has been idle longer than `ttlMs`.
   */
  getLastActiveThread(): string | null;
  /**
   * Record (and refresh) the active thread together with the time of its last
   * message — call it once per turn. The `lastMessageAt` drives the sliding TTL;
   * omit it and the thread won't be resumed (no time → not displayed).
   */
  setActiveThread(conversationId: string, lastMessageAt?: Date | number): void;
  /** Forget the cached thread — e.g. on "new chat". */
  clear(): void;
  /** The resolved storage key holding the widget id — handy for debugging. */
  readonly key: string;
}

/**
 * Identify a returning visitor with a single, stable widget id — the same model as
 * the frontend's `getOrGenerateWidgetId` — and resume their last active thread.
 *
 * There is no per-agent conversation id: the widget id is the identity, and the last
 * active thread (its id + the time of its last message) is cached locally so resuming
 * is a pure front-side decision — **no backend call** just to know whether the thread
 * is still fresh. A thread idle longer than `ttlMs` (default 2h, sliding — refreshed
 * by `setActiveThread`), or one with no recorded last-message time, is not resumed.
 *
 * ```ts
 * const session = createConversationSession();
 *
 * // resume on load (front-only — no request):
 * const conversationId = session.getLastActiveThread() ?? undefined;
 *
 * // record the thread once a turn completes:
 * session.setActiveThread(reply.conversationId, reply.createdAt);
 *
 * session.clear(); // forget it — e.g. a "new chat" button
 * ```
 *
 * Persistence is opt-in by storage backend: it defaults to `localStorage`, but pass
 * `sessionStorage` for a tab-scoped session or omit storage in environments without it.
 */
export function createConversationSession(
  options: ConversationSessionOptions = {}
): ConversationSession {
  const key = options.key ?? DEFAULT_WIDGET_ID_KEY;
  const threadKey = options.threadKey ?? DEFAULT_THREAD_KEY;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  // Resolve a storage backend lazily; absence (SSR, disabled storage) degrades to
  // a generated, in-memory-only session rather than throwing.
  const storage: StorageLike | undefined =
    options.storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);

  // Get-or-generate the widget id: an explicit id wins, then a previously persisted
  // one, then a fresh UUID. Whatever we settle on is written back so it sticks.
  let widgetId = options.widgetId ?? "";
  if (!widgetId && storage) {
    try {
      widgetId = storage.getItem(key) ?? "";
    } catch {
      /* ignore */
    }
  }
  if (!widgetId) {
    widgetId = generateWidgetId();
  }
  if (storage) {
    try {
      storage.setItem(key, widgetId);
    } catch {
      /* ignore */
    }
  }

  // The cached last active thread — createStore restores it on construct and persists
  // it on every set(); the TTL is layered on top, checked in front.
  const store = createStore<ThreadEnvelope>(
    { value: null, lastMessageAt: null },
    { key: threadKey, storage }
  );

  // Expire on load: a restored thread that is stale (idle past ttlMs, or missing its
  // last-message time) is dropped so the stale id doesn't linger on disk.
  const restored = store.get();
  if (restored.value !== null && isStale(restored.lastMessageAt)) {
    store.set({ value: null, lastMessageAt: null });
  }

  function isStale(lastMessageAt: number | null): boolean {
    // No recorded time → can't prove it's fresh → treat as stale (don't display).
    if (lastMessageAt === null) return true;
    if (!Number.isFinite(ttlMs)) return false;
    return Date.now() - lastMessageAt > ttlMs;
  }

  return {
    widgetId,
    key,
    getLastActiveThread() {
      const { value, lastMessageAt } = store.get();
      if (value === null || isStale(lastMessageAt)) return null;
      return value;
    },
    setActiveThread(conversationId, lastMessageAt) {
      const at =
        lastMessageAt == null
          ? null
          : lastMessageAt instanceof Date
            ? lastMessageAt.getTime()
            : lastMessageAt;
      store.set({ value: conversationId, lastMessageAt: at });
    },
    clear() {
      store.set({ value: null, lastMessageAt: null });
    },
  };
}
