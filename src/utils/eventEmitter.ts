type ScopeCheck = () => boolean | Promise<boolean>;
const emissionScopes = new WeakMap<object, { isCurrent: ScopeCheck; latest?: () => unknown }>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function emitScoped<Events extends Record<string, any>, K extends keyof Events>(
  emitter: EventEmitter<Events>, event: K, data: Events[K], isCurrent: ScopeCheck, latest?: () => Events[K],
): void {
  emissionScopes.set(emitter, { isCurrent, latest });
  try { emitter.emit(event, data); } finally { emissionScopes.delete(emitter); }
}

type EventHandler<T = unknown> = (data: T) => void;

/**
 * Simple typed event emitter
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class EventEmitter<Events extends Record<string, any> = Record<string, unknown>> {
  private handlers: Map<keyof Events, Set<EventHandler<unknown>>> = new Map();

  on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);
  }

  off<K extends keyof Events>(
    event: K,
    handler: EventHandler<Events[K]>
  ): void {
    const eventHandlers = this.handlers.get(event);
    if (eventHandlers) {
      eventHandlers.delete(handler as EventHandler<unknown>);
    }
  }

  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    const scope = emissionScopes.get(this);
    const isCurrent = scope?.isCurrent;
    emissionScopes.delete(this);
    const eventHandlers = this.handlers.get(event);
    if (!eventHandlers) return;
    if (!isCurrent) {
      eventHandlers.forEach((handler) => {
        try { handler(data); } catch (error) {
          console.error(`Error in event handler for ${String(event)}:`, error);
        }
      });
      return;
    }
    const recipients = [...eventHandlers];
    let index = 0;
    const deliver = (): void => {
      while (index < recipients.length) {
        const allowed = isCurrent();
        if (allowed instanceof Promise) {
          void allowed.then((valid) => { if (valid) deliver(); }, () => {});
          return;
        }
        if (!allowed) return;
        const handler = recipients[index++];
        if (this.handlers.get(event) !== eventHandlers || !eventHandlers.has(handler)) continue;
        try { handler(scope?.latest ? scope.latest() : data); } catch (error) {
          console.error(`Error in event handler for ${String(event)}:`, error);
        }
      }
    };
    deliver();
  }

  /**
   * Subscribe to an event and auto-unsubscribe after the first call.
   */
  once<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
    const wrapper = ((data: Events[K]) => {
      this.off(event, wrapper as EventHandler<Events[K]>);
      handler(data);
    }) as EventHandler<Events[K]>;
    this.on(event, wrapper);
  }

  /**
   * Returns a Promise that resolves the next time `event` fires.
   * Rejects if `timeout` (ms) is reached first.
   */
  waitFor<K extends keyof Events>(
    event: K,
    options?: { timeout?: number }
  ): Promise<Events[K]> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const handler = ((data: Events[K]) => {
        if (timer) clearTimeout(timer);
        resolve(data);
      }) as EventHandler<Events[K]>;

      this.once(event, handler);

      if (options?.timeout) {
        timer = setTimeout(() => {
          this.off(event, handler);
          reject(new Error(`waitFor("${String(event)}") timed out after ${options.timeout}ms`));
        }, options.timeout);
      }
    });
  }

  removeAllListeners(event?: keyof Events): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}
