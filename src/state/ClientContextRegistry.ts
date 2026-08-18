import { logger } from "../utils/logger";

/**
 * A single piece of context the client wants the LLM to know about.
 */
export interface ContextEntry {
  /** Human-readable label (e.g. "Order detail", "Current user") */
  name?: string;
  /** Short description of what this context represents */
  description?: string;
  /** Arbitrary structured data the AI should know about */
  data?: Record<string, unknown>;
  /**
   * Marks the entry as constant for the whole conversation. The backend then
   * pins it right after the system prompt, where LLM providers cache it across
   * turns, instead of re-processing it next to every new user message.
   *
   * Only set this when the entry's content is byte-identical on every message
   * of a conversation (a schema, a capability list, static instructions). A
   * stable entry that changes between messages invalidates the provider's
   * cache for the entire conversation history, which costs more than leaving
   * the flag off. Default: `false` (re-sent near the newest user message).
   * Backends that don't know the flag ignore it.
   */
  stable?: boolean;
}

/**
 * Serialised client context sent with each message.
 */
export interface ContextSnapshot {
  /** All active context entries keyed by their registration key */
  entries: Record<string, ContextEntry>;
}

/**
 * A function that returns a fresh context entry on demand.
 * Evaluated every time a message is sent — use it to pull data from stores,
 * refs, or any source that isn't captured by React state.
 */
export type DynamicContextProvider = () => ContextEntry | null | undefined;

/**
 * Registry that collects client-side context from across the component tree.
 *
 * Components register/unregister context slices via unique keys.
 * When a message is sent the registry produces a single snapshot.
 */
export class ClientContextRegistry {
  private entries: Map<string, ContextEntry> = new Map();
  /**
   * One LIFO stack per key; the last provider is the active one. Keys like
   * `current-page` and `page-state:<fn>` are shared by every consumer that
   * registers them, so a flat map lets one unmounting hook delete a provider
   * another hook is still relying on. See {@link FunctionRegistry} for the
   * same reasoning on functions.
   */
  private dynamicProviders: Map<string, DynamicContextProvider[]> = new Map();

  /**
   * Register or update a static context entry.
   */
  set(key: string, entry: ContextEntry): void {
    this.entries.set(key, entry);
    logger.log(`ClientContext set: ${key}`);
  }

  /**
   * Remove a static context entry (typically on component unmount).
   */
  remove(key: string): boolean {
    const deleted = this.entries.delete(key);
    if (deleted) {
      logger.log(`ClientContext removed: ${key}`);
    }
    return deleted;
  }

  /**
   * Register a dynamic context provider. The function is called every time
   * a message is sent, so it always returns the freshest data.
   *
   * Use this for context that lives outside React state — global stores,
   * refs, or computed values that shouldn't trigger re-renders.
   */
  addDynamicProvider(key: string, provider: DynamicContextProvider): () => void {
    const stack = this.dynamicProviders.get(key);
    if (stack) {
      stack.push(provider);
    } else {
      this.dynamicProviders.set(key, [provider]);
    }
    logger.log(`DynamicContext provider added: ${key}`);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const current = this.dynamicProviders.get(key);
      if (!current) return;
      const index = current.lastIndexOf(provider);
      if (index === -1) return;
      current.splice(index, 1);
      if (current.length === 0) this.dynamicProviders.delete(key);
      logger.log(`DynamicContext provider removed: ${key}`);
    };
  }

  /**
   * Remove the ACTIVE dynamic context provider for a key, restoring the one it
   * overwrote (if any). Prefer the disposer returned by
   * {@link addDynamicProvider} when you own a specific registration.
   */
  removeDynamicProvider(key: string): boolean {
    const stack = this.dynamicProviders.get(key);
    if (!stack || stack.length === 0) return false;
    stack.pop();
    if (stack.length === 0) {
      this.dynamicProviders.delete(key);
    }
    logger.log(`DynamicContext provider removed: ${key}`);
    return true;
  }

  /**
   * Build a snapshot of the current client context.
   * Evaluates every registered dynamic provider. Returns `null` when there is
   * nothing to report.
   */
  getSnapshot(): ContextSnapshot | null {
    if (this.entries.size === 0 && this.dynamicProviders.size === 0) {
      return null;
    }

    const entries: Record<string, ContextEntry> = {};
    for (const [key, entry] of this.entries) {
      entries[key] = entry;
    }

    for (const [key, stack] of this.dynamicProviders) {
      if (stack.length === 0) continue;
      const provider = stack[stack.length - 1];
      try {
        const entry = provider();
        if (entry) {
          entries[key] = entry;
        }
      } catch (err) {
        logger.error(`DynamicContext provider "${key}" threw:`, err);
      }
    }

    if (Object.keys(entries).length === 0) {
      return null;
    }

    return { entries };
  }

  /**
   * Remove all entries and dynamic providers.
   */
  clear(): void {
    this.entries.clear();
    this.dynamicProviders.clear();
    logger.log("ClientContext cleared");
  }
}
