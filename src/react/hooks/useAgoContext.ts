import { useEffect, useId, useRef } from "react";
import type { ContextEntry, DynamicContextProvider } from "../../state/ClientContextRegistry";
import { useAgoClient } from "../context/AgoContext";

/**
 * Declaratively expose a piece of context to the AI agent with every message.
 *
 * Accepts either:
 * - An **object** — sent as-is on every message (re-registered when it changes).
 *   Use for data that already lives in React state.
 * - A **function** — called lazily at each message send, so the AI always gets
 *   the freshest value. Use for data outside React state (global stores, refs,
 *   computed values).
 *
 * A unique key is auto-generated per component instance via `useId()`. Pass an
 * explicit key as second argument to share context across components or
 * reference it from elsewhere.
 *
 * ```tsx
 * // Static object — captured at render time
 * function OrderPage({ order }) {
 *   useAgoContext({
 *     name: "Order detail",
 *     description: "The user is viewing a specific order",
 *     data: { orderId: order.id, status: order.status },
 *   });
 * }
 *
 * // Dynamic function — evaluated at each sendMessage
 * function App() {
 *   const storeRef = useRef(reduxStore);
 *   useAgoContext(() => {
 *     const state = storeRef.current.getState();
 *     return { name: "App shell", data: { userId: state.auth.userId } };
 *   });
 * }
 *
 * // With an explicit key
 * useAgoContext({ name: "Sidebar filter", data: { filter } }, "sidebar-filter");
 * ```
 */
export function useAgoContext(entry: ContextEntry, key?: string): void;
export function useAgoContext(provider: DynamicContextProvider, key?: string): void;
export function useAgoContext(
  entryOrProvider: ContextEntry | DynamicContextProvider,
  key?: string
): void {
  const client = useAgoClient();
  const autoKey = useId();
  const effectiveKey = key ?? autoKey;

  const providerRef = useRef(entryOrProvider);
  providerRef.current = entryOrProvider;

  const isDynamic = typeof entryOrProvider === "function";

  // Serialize static entries for deep-change detection — skipped for functions.
  const serialized = isDynamic ? "" : JSON.stringify(entryOrProvider);

  useEffect(() => {
    if (typeof providerRef.current === "function") {
      const stableProvider: DynamicContextProvider = () =>
        (providerRef.current as DynamicContextProvider)();
      client.addDynamicContext(effectiveKey, stableProvider);
      return () => {
        client.removeDynamicContext(effectiveKey);
      };
    }

    client.setContext(effectiveKey, providerRef.current as ContextEntry);
    return () => {
      client.removeContext(effectiveKey);
    };
    // Re-run when the serialized entry changes (static mode) or when mode toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, effectiveKey, isDynamic, serialized]);
}
