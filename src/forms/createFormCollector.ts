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
 * A single leaf comparison. The field it guards becomes required exactly when the
 * controlling `property` matches `value` against the answers collected so far:
 * - a single `value`, no `op` — equality (compared as strings);
 * - a single `value` with `op` — numeric comparison (both sides coerced to numbers);
 * - an array `value`, no `op` — "one of": matches when the property equals any
 *   listed value.
 */
export interface FormFieldLeafCondition {
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

/**
 * A field's conditional-requiredness rule: either a single {@link FormFieldLeafCondition}
 * or a boolean combination of rules. `anyOf` is OR (true when any nested rule
 * holds); `allOf` is AND (true when every nested rule holds). Both nest
 * arbitrarily, so you can mix them, e.g.
 * `{ anyOf: [{ property: "a", op: ">=", value: 1 }, { property: "b", value: "1" }] }`.
 * An empty `anyOf` is never required; an empty `allOf` is always required.
 *
 * Stripped from the LLM tool's `parameters` (see {@link toWireParameters}), but the
 * condition still reaches the agent via the dynamic context's requiredness rules so
 * it knows when each field becomes required.
 */
export type FormFieldCondition =
  | FormFieldLeafCondition
  | { anyOf: FormFieldCondition[] }
  | { allOf: FormFieldCondition[] };

/** A single field's schema: the wire-legal keys plus the SDK-only `requiredWhen`. */
export interface FormFieldSchema {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  /**
   * Makes the field required only while this condition holds. Drives the dynamic
   * `missing` list; stripped from the LLM tool's `parameters` (still sent to the
   * agent via the dynamic context's requiredness rules). See {@link toWireParameters}.
   */
  requiredWhen?: FormFieldCondition;
}

/**
 * Shape of a form's fields. Mirrors a client function's `parameters` (so the same
 * object feeds the store, the update function, and the dynamic context). Additionally allows the SDK-only per-field `requiredWhen`, which {@link toWireParameters} removes from the LLM tool's `parameters` (the `requiredWhen` conditions still reach the agent via the dynamic context's requiredness rules).
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
  /**
   * The submit response, set once `submitted` is true: the resolved value of the
   * client `handler`, the parsed JSON of a client `url` POST, or the backend
   * relay result. Lets a UI surface a server-returned message. Undefined until
   * a submit succeeds (and after `reset()`).
   */
  submitResult?: unknown;
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
 * - `{ via: "backend" }` — the browser relays the values to the backend, which resolves
 *   the destination from the form's backend-stored definition (name, URL and secret all
 *   stay server-side). `destination` is deprecated and ignored.
 * - `false` — collect only, no submit function.
 */
export type SubmitConfig<V = Record<string, unknown>> =
  | string
  | { via: "client"; url: string }
  | { via: "client"; handler: (values: V) => Promise<unknown> | unknown }
  | { via: "backend"; destination?: string }
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
  /**
   * Submit on its own as soon as every required field is filled, without waiting
   * for the agent or a UI button. The form submits at most once. Defaults to
   * `true` whenever a `submit` target is set: when on, no `submit_<name>` function
   * is exposed, the form submits itself, and the agent never confirms a submit.
   * Pass `autoSubmit: false` to keep the manual flow (expose `submit_<name>` and
   * submit only on an explicit call). Has no effect on a collect-only form (no
   * `submit` target); setting it `true` there is ignored with a warning.
   */
  autoSubmit?: boolean;
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
  /** Completeness status (`missing`/`complete`) derived from the current values + schema. */
  getStatus: () => FormCollectorStatus;
}

/**
 * The backend-stored shape returned by `GET /api/sdk/v1/forms/{name}` (see
 * {@link AgoClient.getFormCollector}). Mirrors the persistable subset of
 * {@link CreateFormCollectorOptions}: the `submit` here is never the client-only
 * `handler` variant (a function can't be stored server-side).
 */
export interface FormCollectorDefinition<V = Record<string, unknown>> {
  name: string;
  description: string;
  schema: FormCollectorSchema;
  /** Server-stored submit target, if any. Absent means collect-only. */
  submit?: SubmitConfig<V>;
  /** Server-stored default for auto-submitting once the form is complete. */
  autoSubmit?: boolean;
}

/**
 * Options for {@link loadFormCollector} / the name-only form of `useFormCollector`:
 * the `name` is required and the definition is fetched from the backend, while any
 * field here overrides the fetched one — notably a client-only `submit` handler,
 * which can't be stored server-side.
 */
export interface LoadFormCollectorOptions<V = Record<string, unknown>>
  extends Partial<Omit<CreateFormCollectorOptions<V>, "name">> {
  name: string;
}

// Must stay within the backend's client-function name rule once prefixed.
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === "";

/**
 * Evaluate a {@link FormFieldCondition} against the values collected so far.
 * `anyOf`/`allOf` recurse (OR / AND); for a leaf, an empty/unset controlling
 * value is never a match (the field isn't relevant yet), an array `value` is an
 * "is one of" test, equality compares as strings, and the comparison operators
 * coerce both sides to numbers and fail closed on non-numeric input.
 */
function evaluateCondition(
  cond: FormFieldCondition,
  values: Partial<Record<string, unknown>>,
): boolean {
  if ("anyOf" in cond)
    return cond.anyOf.some((c) => evaluateCondition(c, values));
  if ("allOf" in cond)
    return cond.allOf.every((c) => evaluateCondition(c, values));
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
 * SDK-only `requiredWhen` so the tool schema stays JSON-Schema-legal — and set
 * `required: []` so the agent can fill the form incrementally. The form's real
 * requiredness lives in `schema.required` + `requiredWhen` and reaches the agent
 * through the dynamic context (the requiredness rules plus the `missing` list), not
 * this per-call `required`.
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
  // Auto-submit is the default once a submit target exists: the form submits
  // itself when complete. Pass autoSubmit: false to keep the manual submit_<name>
  // flow. An explicit autoSubmit on a collect-only form is a no-op (warned).
  if (options.autoSubmit === true && !submitConfig) {
    logger.warn(
      `FormCollector "${name}": autoSubmit is ignored because no submit target is configured.`,
    );
  }
  const autoSubmit = (options.autoSubmit ?? true) && Boolean(submitConfig);
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

  // Surface a submit failure on the client event bus (no-op until installed).
  const emitFormError = (values: V, error: string): void => {
    boundClient?.emitFormEvent("form:error", {
      name,
      values: values as Record<string, unknown>,
      error,
    });
  };

  // De-dupe concurrent submissions: while one is in flight every caller shares the
  // same promise, so parallel agent update_ calls / rapid setValues / a double-clicked
  // button collapse to a single request. The latch clears when the request settles;
  // the `submitted` guard in maybeAutoSubmit then stops any later auto-submit.
  let pendingSubmit: Promise<FormSubmitResult> | null = null;

  const runSubmit = async (): Promise<FormSubmitResult> => {
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
            const error = `Submit failed: HTTP ${res.status}`;
            emitFormError(submitValues, error);
            return { ok: false, error };
          }
          result = await res.json().catch(() => undefined);
        }
      } else {
        // via: "backend" — relay by form name; the backend resolves the destination
        // from the stored definition, so the URL + secret stay server-side.
        if (!boundClient) {
          return {
            ok: false,
            error:
              "Backend submit requires install(client) (or useFormCollector) first.",
          };
        }
        result = await boundClient.submitFormCollector(
          name,
          submitValues as Record<string, unknown>,
        );
      }
      store.set({ ...store.get(), submitted: true, submitResult: result });
      boundClient?.emitFormEvent("form:submitted", {
        name,
        values: submitValues as Record<string, unknown>,
        result,
      });
      return { ok: true, result };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Submit failed";
      logger.error(`FormCollector "${name}" submit failed:`, err);
      emitFormError(submitValues, error);
      return { ok: false, error };
    }
  };

  const doSubmit = (): Promise<FormSubmitResult> => {
    if (pendingSubmit) return pendingSubmit;
    pendingSubmit = (async () => {
      try {
        return await runSubmit();
      } finally {
        pendingSubmit = null;
      }
    })();
    return pendingSubmit;
  };

  // When autoSubmit is on, submit as soon as the form is complete — at most once.
  // Re-reads the store so it sees the patch that was just applied; the `submitted`
  // guard stops a second fill (or setValues) from submitting again.
  const maybeAutoSubmit = async (): Promise<FormSubmitResult | null> => {
    if (!autoSubmit || !submitConfig) return null;
    const { values, submitted } = store.get();
    if (submitted) return null;
    if (!deriveFormStatus(schema, values).complete) return null;
    return doSubmit();
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
    handler: async (args) => {
      const next = applyPatch(coerce(args));
      const { missing } = deriveFormStatus(schema, next.values);
      const submission = await maybeAutoSubmit();
      if (!submission) return { ok: true, values: next.values, missing };
      // Tell the agent the form auto-submitted so it stops asking for fields.
      return submission.ok
        ? { ok: true, values: next.values, missing, submitted: true }
        : {
            ok: true,
            values: next.values,
            missing,
            submitted: false,
            submitError: submission.error,
          };
    },
  };

  const functions: ClientFunctionDefinition[] = [updateFn];

  // With autoSubmit the form submits itself on completion, so no submit tool is
  // exposed; the `submit()` method (e.g. a UI button) still works.
  if (submitConfig && !autoSubmit) {
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
  // Every field's name, type, description and allowed values already reach the agent
  // through the update_<name> tool's `parameters` (see toWireParameters). The only
  // requiredness information the tool omits is the base `required` list (it sends `[]`
  // so the form can fill incrementally) and the per-field `requiredWhen` conditions
  // (stripped to keep the tool schema JSON-Schema-legal). So context carries just those
  // rules, not a second copy of the whole schema — sending the full schema here doubled
  // the prompt (a large form's schema is the single biggest chunk of the request).
  const requiredWhenRules = Object.fromEntries(
    Object.entries(schema.properties ?? {})
      .filter(([, prop]) => prop.requiredWhen != null)
      .map(([key, prop]) => [key, prop.requiredWhen]),
  );
  const requirementRules: { required: string[]; requiredWhen?: typeof requiredWhenRules } = {
    required: schema.required ?? [],
    ...(Object.keys(requiredWhenRules).length > 0 && {
      requiredWhen: requiredWhenRules,
    }),
  };
  const contextProvider = (): ContextEntry => {
    const { values, submitted } = store.get();
    const { missing, complete } = deriveFormStatus(schema, values);
    const submitHint = !submitConfig
      ? ""
      : autoSubmit
        ? ` The form is submitted automatically as soon as every required field is filled, so there is no submit function to call.`
        : ` When nothing is missing and the user confirms, call submit_${name}.`;
    const phase = submitted
      ? `The "${name}" form has been submitted.`
      : `You are currently collecting information from the user to fill the "${name}" form.`;
    return {
      name: `Form: ${name}`,
      description:
        `${phase} ${description} ` +
        `The form's fields, their types and allowed values are defined by the update_${name} tool. ` +
        `Some fields are conditionally required; these rules say which fields are required and, via requiredWhen, when each becomes required: ` +
        `${JSON.stringify(requirementRules)}. ` +
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
      // Fire-and-forget: a UI-driven fill that completes the form auto-submits
      // too. doSubmit never throws (it returns a result), so void is safe.
      void maybeAutoSubmit();
    },
    reset: () => {
      store.set({
        values: initialValues,
        submitted: false,
      });
    },
    getStatus: () => deriveFormStatus(schema, store.get().values),
  };
}

/**
 * Async sibling of {@link createFormCollector} that pulls the form's definition
 * (description + schema + submit target) from the backend by name — the single
 * source of truth — instead of hardcoding it in client code. Any field passed in
 * `options` overrides the fetched one (e.g. a client-only `submit` handler or
 * `initialValues`).
 *
 * ```ts
 * const order = await loadFormCollector(client, { name: "order" });
 * order.install(client);
 * ```
 */
export async function loadFormCollector<V = Record<string, unknown>>(
  client: Pick<AgoClient, "getFormCollector">,
  options: LoadFormCollectorOptions<V>,
): Promise<FormCollector<V>> {
  const def = (await client.getFormCollector(
    options.name,
  )) as FormCollectorDefinition<V>;
  return createFormCollector<V>({
    name: def.name,
    description: options.description ?? def.description,
    schema: options.schema ?? def.schema,
    submit: options.submit ?? def.submit,
    initialValues: options.initialValues,
    autoSubmit: options.autoSubmit ?? def.autoSubmit,
  });
}
