import { shallowRef, onScopeDispose, type ShallowRef } from "vue";
import type { Store } from "../../state/createStore";

/**
 * Read a framework-agnostic AGO store (`createStore`) as a reactive Vue ref.
 *
 * The ref's `.value` updates on every `store.set(...)`. Mutate through the store,
 * not the ref. A `shallowRef` is used because the store replaces its value
 * wholesale, so deep reactivity would be wasted work.
 *
 * ```ts
 * const cart = createStore({ items: [] as string[] });
 *
 * // in setup():
 * const state = useAgoStore(cart);
 * // template: {{ state.items.length }}
 * ```
 */
export function useAgoStore<T>(store: Store<T>): ShallowRef<T> {
  const state = shallowRef(store.get()) as ShallowRef<T>;
  // Subscribe during setup so no updates are missed before mount; clean up when
  // the surrounding effect scope (the component) is disposed.
  const unsubscribe = store.subscribe((next) => {
    state.value = next;
  });
  onScopeDispose(unsubscribe);
  return state;
}
