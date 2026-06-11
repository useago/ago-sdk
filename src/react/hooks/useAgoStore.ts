import { useSyncExternalStore } from "react";
import type { Store } from "../../state/createStore";

/**
 * Read a framework-agnostic AGO store (`createStore`) reactively in React.
 *
 * Re-renders the component whenever the store's value changes. Mutate the store
 * via `store.set(...)`, not the value returned here.
 *
 * ```tsx
 * const cart = createStore({ items: [] as string[] });
 *
 * function CartBadge() {
 *   const { items } = useAgoStore(cart);
 *   return <span>{items.length}</span>;
 * }
 * ```
 */
export function useAgoStore<T>(store: Store<T>): T {
  // store.get doubles as the SSR/hydration snapshot — the value is identical
  // on server and client at first paint.
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
