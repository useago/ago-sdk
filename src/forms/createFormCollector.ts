import type { AgoClient } from "../client/AgoClient";
import type { Conversation, ToolCallData } from "../client/types";
import type {
  ClientFunctionDefinition,
  ClientFunctionSchema,
} from "../functions/types";
import type { ContextEntry } from "../state/ClientContextRegistry";
import { createStore, type Store } from "../state/createStore";
import { logger } from "../utils/logger";

/**
 * A field's conditional-requiredness rule. The field becomes required exactly
 * when the controlling `property` matches `value` against the answers collected
 * so far:
 * - a single `value`, no `op` — equality (compared as strings);
 * - a single `value` with `op` — numeric comparison (both sides coerced to numbers);
 * - an array `value`, no `op` — "one of": matches when the property equals any
 *   listed value.
 *
 * SDK-only — it is stripped from the schema before it reaches the LLM tool
 */
export interface FormFieldCondition {
  /** The controlling field whose value the rule tests. */
  property: string;
  /** Comparison operator; omitted means equality. Ignored when `value` is an array. */
  op?: ">=" | "<=" | ">" | "<";
  /**
   * The value(s) to test the controlling field against. A single value is an
   * equality (or, with `op`, a numeric comparison); an array is an "is one of"
   * membership test, e.g. `value: ["1", "2", "3"]`.
   */
  value: string | number | Array<string | number>;
}

/** A single field's schema: the wire-legal keys plus the SDK-only `requiredWhen`. */
export interface FormFieldSchema {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  /**
   * Makes the field required only while this condition holds. Drives the dynamic
   * `missing` list; stripped before the LLM tool — see {@link toWireParameters}.
   */
  requiredWhen?: FormFieldCondition;
}

/**
 * Shape of a form's fields. Mirrors a client function's `parameters` (so the same
 * object feeds the store, the update function, and the dynamic context). Additionally allows the SDK-only per-field `requiredWhen`, which {@link toWireParameters} removes before the schema reaches the LLM.
 */
export interface FormCollectorSchema {
  type: "object";
  properties: Record<string, FormFieldSchema>;
  required?: string[];
}

/** Canonical, source-of-truth state held in the collector's store. */
export interface FormCollectorState<V = Record<string, unknown>> {
  /** Field values collected so far. */
  values: Partial<V>;
  /** True once a submit succeeded. */
  submitted: boolean;
}

/** Completeness status derived from values + schema — computed on read, never stored. */
export interface FormCollectorStatus {
  /** Required field names still empty. */
  missing: string[];
  /** True when no required field is missing. */
  complete: boolean;
}

/** Result returned by `submit()` / the generated `submit_<name>` function. */
export interface FormSubmitResult {
  ok: boolean;
  missing?: string[];
  result?: unknown;
  error?: string;
}

/**
 * Where a completed form is sent.
 * - `"https://..."` (a bare string) — shorthand for `{ via: "client", url }`: the browser
 *   POSTs the values to that URL.
 * - `{ via: "client", url }` — same, written out.
 * - `{ via: "client", handler }` — the browser runs your own submit logic.
 * - `{ via: "backend", destination }` — the browser relays the values to the backend,
 *   which forwards them to the server-configured destination (URL + secret stay server-side).
 * - `false` — collect only, no submit function.
 */
export type SubmitConfig<V = Record<string, unknown>> =
  | string
  | { via: "client"; url: string }
  | { via: "client"; handler: (values: V) => Promise<unknown> | unknown }
  | { via: "backend"; destination: string }
  | false;

export interface CreateFormCollectorOptions<V = Record<string, unknown>> {
  /** Short identifier; becomes the `update_<name>` / `submit_<name>` function names. */
  name: string;
  /** What the form is, for the LLM. */
  description: string;
  /** The single source of truth for the form's fields. */
  schema: FormCollectorSchema;
  /** How the completed form is submitted. Default: `false` (collect only). */
  submit?: SubmitConfig<V>;
  /** Pre-filled values. */
  initialValues?: Partial<V>;
}

export interface FormCollector<V = Record<string, unknown>> {
  name: string;
  /** Observable store driving the form UI (read via `useAgoStore`). */
  store: Store<FormCollectorState<V>>;
  /** Client functions to register: `[update]` or `[update, submit]`. */
  functions: ClientFunctionDefinition[];
  /** Dynamic-context key under which the form state is exposed. */
  contextKey: string;
  /** Dynamic-context provider — re-read on every message. */
  contextProvider: () => ContextEntry;
  /** Register the functions + dynamic context on a client. Returns an uninstall fn. */
  install: (client: AgoClient) => () => void;
  /**
   * Rebuild the state by replaying the persisted `update_<name>` / `submit_<name>`
   * tool-call arguments of a loaded conversation — restoring what the agent had
   * collected after a page reload. Replays from the initial values, so it is
   * idempotent. `install` wires this to the client's `conversation:loaded` event,
   * so a custom front rarely needs to call it directly.
   */
  hydrate: (toolCalls: readonly ToolCallData[]) => void;
  /** Submit the form now (e.g. from a UI button). Blocks until required fields are filled. */
  submit: () => Promise<FormSubmitResult>;
  getValues: () => Partial<V>;
  setValues: (patch: Partial<V>) => void;
  reset: () => void;
}

// Must stay within the backend's client-function name rule once prefixed.
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === "";

/**
 * Evaluate a {@link FormFieldCondition} against the values collected so far. An
 * empty/unset controlling value is never a match (the field isn't relevant yet).
 * An array `value` is an "is one of" test; equality compares as strings; the
 * comparison operators coerce both sides to numbers and fail closed on
 * non-numeric input.
 */
function evaluateCondition(
  cond: FormFieldCondition,
  values: Partial<Record<string, unknown>>,
): boolean {
  const actual = (values as Record<string, unknown>)[cond.property];
  if (isEmpty(actual)) return false;
  // "one of": an array value matches when the field equals any listed value.
  if (Array.isArray(cond.value)) {
    return cond.value.some((v) => String(actual) === String(v));
  }
  if (!cond.op) return String(actual) === String(cond.value);
  const a = Number(actual);
  const b = Number(cond.value);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  switch (cond.op) {
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case "<":
      return a < b;
    default:
      logger.warn(
        `Unknown requiredWhen op "${cond.op as string}"; treating as not required.`,
      );
      return false;
  }
}

/**
 * Compute which required fields are still empty and whether the form is complete.
 * Pure — the single home for the "required + non-empty" rule, shared by the update
 * handler, submit, the dynamic context, and the React hook. Derived on read so the
 * store only ever holds canonical state ({@link FormCollectorState}).
 *
 * Requiredness is answer-dependent: a field listed in `required` is required unless
 * it carries a `requiredWhen` that doesn't currently hold, and any field whose
 * `requiredWhen` holds becomes required. So conditional fields surface in `missing`
 * exactly when the answers make them relevant.
 */
export function deriveFormStatus(
  schema: FormCollectorSchema,
  values: Partial<Record<string, unknown>>,
): FormCollectorStatus {
  const properties = schema.properties ?? {};
  const required = new Set<string>();
  for (const key of schema.required ?? []) {
    const cond = properties[key]?.requiredWhen;
    if (!cond || evaluateCondition(cond, values)) required.add(key);
  }
  for (const [key, prop] of Object.entries(properties)) {
    if (prop.requiredWhen && evaluateCondition(prop.requiredWhen, values)) {
      required.add(key);
    }
  }
  const missing = [...required].filter((key) =>
    isEmpty((values as Record<string, unknown>)[key]),
  );
  return { missing, complete: missing.length === 0 };
}

/**
 * Build the LLM-facing tool `parameters` from a form schema: keep only the
 * wire-legal property keys (`type`/`description`/`enum`/`default`) — dropping the
 * SDK-only `requiredWhen` so the LLM never sees a non-standard keyword — and set
 * `required: []` so the agent can fill the form incrementally. The form's real
 * requiredness lives in `schema.required` + `requiredWhen` and reaches the agent
 * through the dynamic-context `missing` list, not this per-call `required`.
 */
function toWireParameters(
  schema: FormCollectorSchema,
): ClientFunctionSchema["parameters"] {
  const properties: ClientFunctionSchema["parameters"]["properties"] = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    properties[key] = {
      type: prop.type,
      ...(prop.description != null && { description: prop.description }),
      ...(prop.enum && { enum: prop.enum }),
      ...(prop.default !== undefined && { default: prop.default }),
    };
  }
  return { type: "object", properties, required: [] };
}

/**
 * Wire one schema into a conversational form: an observable store, an
 * `update_<name>` client function the agent calls to fill fields, a dynamic-context
 * provider that tells the agent what's still missing, and an optional submit.
 *
 * ```ts
 * const order = createFormCollector({
 *   name: "order",
 *   description: "The order the user wants to place",
 *   schema: {
 *     type: "object",
 *     properties: { product: { type: "string" }, quantity: { type: "number" } },
 *     required: ["product", "quantity"],
 *   },
 *   submit: { via: "client", url: "/api/orders" },
 * });
 * order.install(client);
 * order.store.subscribe((s) => render(s));
 * ```
 */
export function createFormCollector<V = Record<string, unknown>>(
  options: CreateFormCollectorOptions<V>,
): FormCollector<V> {
  const { name, description, schema } = options;
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid form collector name "${name}": must match ${NAME_PATTERN} ` +
        `(it becomes the update_/submit_ function names).`,
    );
  }

  // A bare string is shorthand for { via: "client", url }; "" is treated as no submit.
  const submitConfig: Exclude<
    SubmitConfig<V>,
    string
  > = typeof options.submit === "string"
    ? options.submit
      ? { via: "client", url: options.submit }
      : false
    : (options.submit ?? false);
  const properties = schema.properties ?? {};

  // Keep only known fields and coerce them to their declared type.
  const coerce = (patch: Record<string, unknown>): Partial<V> => {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(patch)) {
      const prop = properties[key];
      if (!prop) continue; // drop fields not in the schema
      if (raw === null || raw === undefined) {
        out[key] = raw;
      } else if (prop.type === "number" || prop.type === "integer") {
        const n = typeof raw === "number" ? raw : Number(raw);
        out[key] = Number.isNaN(n) ? raw : n;
      } else if (prop.type === "boolean") {
        out[key] =
          typeof raw === "boolean"
            ? raw
            : raw === "true"
              ? true
              : raw === "false"
                ? false
                : Boolean(raw);
      } else {
        out[key] = raw;
      }
    }
    return out as Partial<V>;
  };

  const initialValues = (options.initialValues ?? {}) as Partial<V>;

  const store = createStore<FormCollectorState<V>>({
    values: initialValues,
    submitted: false,
  });

  const applyPatch = (patch: Partial<V>): FormCollectorState<V> => {
    const current = store.get();
    const next: FormCollectorState<V> = {
      ...current,
      values: { ...current.values, ...patch },
    };
    store.set(next);
    return next;
  };

  let boundClient: AgoClient | null = null;

  const doSubmit = async (): Promise<FormSubmitResult> => {
    const { values } = store.get();
    const { complete, missing } = deriveFormStatus(schema, values);
    if (!complete) {
      return { ok: false, missing };
    }
    if (!submitConfig) {
      return {
        ok: false,
        error: "No submit target configured for this form collector.",
      };
    }

    const submitValues = values as V;
    try {
      let result: unknown;
      if (submitConfig.via === "client") {
        if ("handler" in submitConfig) {
          result = await submitConfig.handler(submitValues);
        } else {
          const res = await fetch(submitConfig.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(submitValues),
          });
          if (!res.ok) {
            return { ok: false, error: `Submit failed: HTTP ${res.status}` };
          }
          result = await res.json().catch(() => undefined);
        }
      } else {
        // via: "backend" — relay the exact object; the URL + secret stay server-side.
        if (!boundClient) {
          return {
            ok: false,
            error:
              "Backend submit requires install(client) (or useFormCollector) first.",
          };
        }
        result = await boundClient.submitFormCollector(
          submitConfig.destination,
          submitValues as Record<string, unknown>,
        );
      }
      store.set({ ...store.get(), submitted: true });
      return { ok: true, result };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Submit failed";
      logger.error(`FormCollector "${name}" submit failed:`, err);
      return { ok: false, error };
    }
  };

  const updateFn: ClientFunctionDefinition = {
    name: `update_${name}`,
    description:
      `Fill or update fields of the "${name}" form. ${description} ` +
      `Pass any subset of fields; call it repeatedly to fill the form as the user provides ` +
      `information. Returns the current values and which required fields are still missing.`,
    // Wire-only shape: SDK-only keys (e.g. requiredWhen) stripped and required
    // emptied so the agent can fill incrementally — see toWireParameters.
    parameters: toWireParameters(schema),
    handler: (args) => {
      const next = applyPatch(coerce(args));
      const { missing } = deriveFormStatus(schema, next.values);
      return { ok: true, values: next.values, missing };
    },
  };

  const functions: ClientFunctionDefinition[] = [updateFn];

  if (submitConfig) {
    functions.push({
      name: `submit_${name}`,
      description:
        `Submit the completed "${name}" form. Only call this once every required field is ` +
        `collected and the user has confirmed. If fields are missing it returns them ` +
        `instead of submitting.`,
      parameters: { type: "object", properties: {} },
      handler: () => doSubmit(),
    });
  }

  // Persisted client-function tool calls arrive with the backend prefix
  // (e.g. `client__update_order`); strip it to compare against our local names.
  const CLIENT_FUNCTION_PREFIX = "client__";
  const submitFnName = submitConfig ? `submit_${name}` : null;
  const localFnName = (toolCall: ToolCallData): string | undefined => {
    const raw = toolCall.functionName ?? toolCall.toolName;
    if (!raw) return undefined;
    return raw.startsWith(CLIENT_FUNCTION_PREFIX)
      ? raw.slice(CLIENT_FUNCTION_PREFIX.length)
      : raw;
  };

  const hydrate = (toolCalls: readonly ToolCallData[]): void => {
    // Replay from a clean slate so repeated hydration is idempotent and a switch
    // to a conversation without this form resets it back to its initial values.
    let values: Partial<V> = { ...initialValues };
    let submitted = false;
    for (const toolCall of toolCalls) {
      const fn = localFnName(toolCall);
      if (fn === updateFn.name) {
        if (toolCall.arguments) {
          values = { ...values, ...coerce(toolCall.arguments) };
        }
      } else if (
        submitFnName &&
        fn === submitFnName &&
        toolCall.status?.toLowerCase() === "done"
      ) {
        submitted = true;
      }
    }
    store.set({ values, submitted });
  };

  const contextKey = `form:${name}`;
  // The full schema reaches the agent through context (not just the tool params) so it
  // knows every field, its type, the real `required` list (vs. the tool's `[]`), and the
  // `requiredWhen` conditions explaining why a field is/becomes required while collecting.
  const contextProvider = (): ContextEntry => {
    const { values, submitted } = store.get();
    const { missing, complete } = deriveFormStatus(schema, values);
    const submitHint = submitConfig
      ? ` When nothing is missing and the user confirms, call submit_${name}.`
      : "";
    const phase = submitted
      ? `The "${name}" form has been submitted.`
      : `You are currently collecting information from the user to fill the "${name}" form.`;
    return {
      name: `Form: ${name}`,
      description:
        `${phase} ${description} ` +
        `There are conditionnals questions/values to collected, you can find this information with the requiredWhen field in the form. ` +
        `The form schema is the following: ${JSON.stringify(schema)}. ` +
        `Data collected so far: ${JSON.stringify(values)}. ` +
        `Call update_${name} with any fields the user provides; ask only for what is still missing.${submitHint}`,
      data: {
        values,
        missing,
        complete,
        submitted,
      },
    };
  };

  const handleConversationLoaded = (conversation: Conversation): void => {
    const toolCalls = (conversation.messages ?? []).flatMap(
      (m) => m.toolCalls ?? [],
    );
    hydrate(toolCalls);
  };

  const install = (client: AgoClient): (() => void) => {
    boundClient = client;
    for (const fn of functions) {
      client.register(fn);
    }
    // Registering the provider emits `context:changed`, so the dev panel shows the
    // form's initial missing fields from the very start of the conversation.
    client.addDynamicContext(contextKey, contextProvider);
    // Keep context observers (e.g. the dev panel) live on every store change —
    // hydration, agent `update_<name>` calls, and UI `setValues`/`reset`.
    const unsubscribe = store.subscribe(() => client.notifyContextChanged());
    // Restore the form after a reload: a loaded conversation replays its tool calls.
    client.on("conversation:loaded", handleConversationLoaded);
    return () => {
      unsubscribe();
      for (const fn of functions) {
        client.unregisterFunction(fn.name);
      }
      client.removeDynamicContext(contextKey);
      client.off("conversation:loaded", handleConversationLoaded);
      if (boundClient === client) {
        boundClient = null;
      }
    };
  };

  return {
    name,
    store,
    functions,
    contextKey,
    contextProvider,
    install,
    hydrate,
    submit: doSubmit,
    getValues: () => store.get().values,
    setValues: (patch: Partial<V>) => {
      applyPatch(coerce(patch as Record<string, unknown>));
    },
    reset: () => {
      store.set({
        values: initialValues,
        submitted: false,
      });
    },
  };
}
