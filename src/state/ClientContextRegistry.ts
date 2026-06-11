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
  private dynamicProviders: Map<string, DynamicContextProvider> = new Map();

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
  addDynamicProvider(key: string, provider: DynamicContextProvider): void {
    this.dynamicProviders.set(key, provider);
    logger.log(`DynamicContext provider added: ${key}`);
  }

  /**
   * Remove a dynamic context provider.
   */
  removeDynamicProvider(key: string): boolean {
    const deleted = this.dynamicProviders.delete(key);
    if (deleted) {
      logger.log(`DynamicContext provider removed: ${key}`);
    }
    return deleted;
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

    for (const [key, provider] of this.dynamicProviders) {
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
