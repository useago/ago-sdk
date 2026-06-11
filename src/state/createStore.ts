/**
 * A minimal observable store: one value, synchronous subscriptions, and
 * optional persistence via {@link PersistOptions} (localStorage by default).
 *
 * ```ts
 * const store = createStore({ count: 0 });
 * store.subscribe((state) => save(state));
 * store.set({ count: 1 }); // listeners fire synchronously
 *
 * const cart = createStore({ items: [] }, { key: "cart" }); // persisted
 * ```
 */
export interface Store<T> {
  /** Current state. */
  get(): T;
  /** Replace the state and notify subscribers synchronously. */
  set(next: T): void;
  /** Register a listener; returns a function that removes it. */
  subscribe(listener: (state: T) => void): () => void;
}

/** The slice of the Web Storage API that {@link createStore} relies on. */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export interface PersistOptions {
  /** Key under which the state is JSON-serialized. */
  key: string;
  /** Storage backend; defaults to `globalThis.localStorage`. */
  storage?: StorageLike;
}

export function createStore<T>(initial: T, persist?: PersistOptions): Store<T> {
  // Resolve a storage backend lazily; absence (SSR, disabled storage) degrades
  // to a pure in-memory store rather than throwing.
  const storage: StorageLike | undefined = persist
    ? (persist.storage ??
      (typeof localStorage !== "undefined" ? localStorage : undefined))
    : undefined;

  let state = initial;

  // Restore a previous snapshot; disabled storage or malformed JSON keeps the
  // initial value.
  if (persist && storage) {
    try {
      const raw = storage.getItem(persist.key);
      if (raw != null) {
        state = JSON.parse(raw) as T;
      }
    } catch {
      /* ignore */
    }
  }

  const subscribers = new Set<(state: T) => void>();
  const notify = () => subscribers.forEach((fn) => fn(state));

  function persistState() {
    if (persist && storage) {
      try {
        storage.setItem(persist.key, JSON.stringify(state));
      } catch {
        /* ignore */
      }
    }
  }

  return {
    get: () => state,
    set: (next: T) => {
      state = next;
      persistState();
      notify();
    },
    subscribe: (fn: (state: T) => void) => {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}
