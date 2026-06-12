import { useEffect, useMemo, useState } from "react";
import {
  createFormCollector,
  loadFormCollector,
  type CreateFormCollectorOptions,
  type FormCollector,
  type FormCollectorState,
  type FormCollectorStatus,
  type LoadFormCollectorOptions,
} from "../../forms/createFormCollector";
import { createStore } from "../../state/createStore";
import { useAgoClient } from "../context/AgoContext";
import { useAgoStore } from "./useAgoStore";

export interface UseFormCollectorResult<V = Record<string, unknown>>
  extends FormCollector<V> {
  /**
   * Live form state from the store (`values`, `submitted`) plus the completeness
   * status (`missing`, `complete`) derived on read — re-renders on every change.
   */
  state: FormCollectorState<V> & FormCollectorStatus;
  /**
   * True while the backend definition is being fetched (name-only usage). Always
   * `false` when an inline `schema` is provided.
   */
  loading: boolean;
  /** Set if fetching the backend definition failed. */
  error: Error | null;
}

const EMPTY_STATUS: FormCollectorStatus = { missing: [], complete: false };

/**
 * React wiring for {@link createFormCollector}: registers the collector's client
 * functions + dynamic context on mount, removes them on unmount, and returns the
 * live store state.
 *
 * Two modes, by whether you pass a `schema`:
 *
 * - **Inline** — pass `{ name, description, schema, submit? }` and the collector is
 *   built synchronously (recreated only when `name`, the schema, or the submit
 *   target changes; keep them stable). `loading` is always `false`.
 * - **Backend** — pass `{ name }` (no `schema`) and the definition is fetched from
 *   the backend ({@link loadFormCollector}) so the schema lives server-side, not in
 *   client code. `loading` is `true` until it resolves; any field you do pass
 *   overrides the fetched one (e.g. a client-only `submit` handler).
 *
 * ```tsx
 * // Backend-defined form — schema lives in the backend:
 * const order = useFormCollector({ name: "order" });
 *
 * return order.loading
 *   ? <p>Loading…</p>
 *   : <p>{order.state.missing.length ? `Still need: ${order.state.missing.join(", ")}` : "Ready"}</p>;
 * ```
 */
export function useFormCollector<V = Record<string, unknown>>(
  options: CreateFormCollectorOptions<V> | LoadFormCollectorOptions<V>,
): UseFormCollectorResult<V> {
  const client = useAgoClient();

  // The presence of an inline schema selects the mode: build now vs. fetch.
  const hasInlineSchema = options.schema != null;

  const schemaKey = JSON.stringify(options.schema ?? null);
  const submit = options.submit;
  const submitKey = !submit
    ? "none"
    : typeof submit === "string"
      ? `client:${submit}`
      : submit.via === "backend"
        ? "backend"
        : "handler" in submit
          ? "client:handler"
          : `client:${submit.url}`;
  const initialValuesKey = JSON.stringify(options.initialValues ?? null);

  // Inline collector — built synchronously when a schema is provided.
  const inlineCollector = useMemo(
    () =>
      hasInlineSchema
        ? createFormCollector(options as CreateFormCollectorOptions<V>)
        : null,
    // Recreate only on identity-defining changes — see docstring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasInlineSchema, options.name, schemaKey, submitKey, initialValuesKey],
  );

  // Fetched collector — loaded from the backend when no inline schema is given.
  const [fetched, setFetched] = useState<{
    collector: FormCollector<V> | null;
    loading: boolean;
    error: Error | null;
  }>({ collector: null, loading: !hasInlineSchema, error: null });

  useEffect(() => {
    if (hasInlineSchema) return;
    let cancelled = false;
    setFetched({ collector: null, loading: true, error: null });
    loadFormCollector(client, options as LoadFormCollectorOptions<V>)
      .then((collector) => {
        if (!cancelled) setFetched({ collector, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setFetched({
            collector: null,
            loading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, hasInlineSchema, options.name, submitKey, initialValuesKey]);

  const collector = hasInlineSchema ? inlineCollector : fetched.collector;
  const loading = hasInlineSchema ? false : fetched.loading;
  const error = hasInlineSchema ? null : fetched.error;

  // Install whichever collector is active (none until a fetched one resolves).
  useEffect(() => {
    if (!collector) return;
    return collector.install(client);
  }, [client, collector]);

  // A stable placeholder store so the hooks below always have a store to read,
  // even before a fetched collector exists.
  const placeholderStore = useMemo(
    () =>
      createStore<FormCollectorState<V>>({
        values: (options.initialValues ?? {}) as Partial<V>,
        submitted: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialValuesKey],
  );

  const raw = useAgoStore(collector?.store ?? placeholderStore);
  // Derive completeness from the collector's own schema (none yet → empty status).
  // `raw` is a dep so this recomputes on every store change, even though
  // `getStatus` reads the store directly rather than referencing `raw`.
  const status = useMemo(
    () => collector?.getStatus() ?? EMPTY_STATUS,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, collector],
  );
  const state = useMemo(() => ({ ...raw, ...status }), [raw, status]);

  // Expose a stable no-op shell until a collector exists, so consumers can call
  // methods (`submit`, `setValues`, …) without null checks during loading.
  const shell = useMemo<FormCollector<V>>(
    () => ({
      name: options.name,
      store: placeholderStore,
      functions: [],
      contextKey: `form:${options.name}`,
      contextProvider: () => ({ name: `Form: ${options.name}`, description: "" }),
      install: () => () => {},
      hydrate: () => {},
      submit: async () => ({ ok: false, error: "Form definition not loaded yet." }),
      getValues: () => placeholderStore.get().values,
      setValues: () => {},
      reset: () => {},
      getStatus: () => EMPTY_STATUS,
    }),
    [options.name, placeholderStore],
  );

  return { ...(collector ?? shell), state, loading, error };
}
