import { useEffect, useMemo } from "react";
import {
  createFormCollector,
  deriveFormStatus,
  type CreateFormCollectorOptions,
  type FormCollector,
  type FormCollectorState,
  type FormCollectorStatus,
} from "../../forms/createFormCollector";
import { useAgoClient } from "../context/AgoContext";
import { useAgoStore } from "./useAgoStore";

export interface UseFormCollectorResult<V = Record<string, unknown>>
  extends FormCollector<V> {
  /**
   * Live form state from the store (`values`, `submitted`) plus the completeness
   * status (`missing`, `complete`) derived on read — re-renders on every change.
   */
  state: FormCollectorState<V> & FormCollectorStatus;
}

/**
 * React wiring for {@link createFormCollector}: registers the collector's client
 * functions + dynamic context on mount, removes them on unmount, and returns the
 * live store state.
 *
 * The collector is recreated only when `name`, the schema, or the submit target
 * changes. Keep the schema and submit object stable (declare them outside render
 * or memoize them) so an inline `handler` isn't captured stale.
 *
 * ```tsx
 * const order = useFormCollector({
 *   name: "order",
 *   description: "The order the user wants to place",
 *   schema: {
 *     type: "object",
 *     properties: { product: { type: "string" }, quantity: { type: "number" } },
 *     required: ["product", "quantity"],
 *   },
 *   submit: { via: "backend", destination: "order_webhook" },
 * });
 *
 * return (
 *   <div>
 *     {order.state.missing.length > 0
 *       ? `Still need: ${order.state.missing.join(", ")}`
 *       : "Ready to submit"}
 *   </div>
 * );
 * ```
 */
export function useFormCollector<V = Record<string, unknown>>(
  options: CreateFormCollectorOptions<V>
): UseFormCollectorResult<V> {
  const client = useAgoClient();

  const schemaKey = JSON.stringify(options.schema);
  const submit = options.submit;
  const submitKey = !submit
    ? "none"
    : typeof submit === "string"
      ? `client:${submit}`
      : submit.via === "backend"
        ? `backend:${submit.destination}`
        : "handler" in submit
          ? "client:handler"
          : `client:${submit.url}`;

  const collector = useMemo(
    () => createFormCollector(options),
    // Recreate only on identity-defining changes — see docstring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.name, schemaKey, submitKey]
  );

  useEffect(() => collector.install(client), [client, collector]);

  // The store holds only canonical state; derive completeness on read. `raw` is
  // referentially stable between store changes (useSyncExternalStore), so these
  // memos recompute only on a real update — never inside store.get().
  const raw = useAgoStore(collector.store);
  const status = useMemo(
    () => deriveFormStatus(options.schema, raw.values),
    [raw, options.schema]
  );
  const state = useMemo(() => ({ ...raw, ...status }), [raw, status]);

  return { ...collector, state };
}
