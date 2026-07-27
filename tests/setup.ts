/**
 * Deterministic Web Storage for Vitest.
 *
 * Newer Node releases expose an experimental `localStorage` global that is
 * undefined unless Node receives `--localstorage-file`. That global can shadow
 * jsdom's implementation, making otherwise-browser tests depend on the local
 * Node invocation. Install the small in-memory browser contract explicitly.
 */
class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: new MemoryStorage(),
});
