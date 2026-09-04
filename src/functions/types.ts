/**
 * Schema for a client-side function that AGO can call
 */
export interface ClientFunctionSchema {
  /** Function name (must be unique) */
  name: string;
  /** Description for the LLM to understand when to call this function */
  description: string;
  /** JSON Schema for function parameters */
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description?: string;
        enum?: (string | number)[];
        items?: { type: string; enum?: (string | number)[] };
        default?: unknown;
      }
    >;
    required?: string[];
  };
}

/**
 * Function handler type
 */
export type ClientFunctionHandler = (
  args: Record<string, unknown>
) => Promise<unknown> | unknown;

/**
 * A single editable control on the current page (a filter, a sort, a view mode,
 * a selection…). It becomes one optional property of the synthesized
 * `setPageState` function, and its current value is surfaced back to the agent
 * as dynamic context. This is the state-mutation mirror of a navigation route.
 */
export interface AgoStateControl<T = unknown> {
  /** Machine name of the control, e.g. "statusFilter". Becomes a property of the tool. */
  name: string;
  /** Description for the LLM, e.g. "Filter the list by review status". */
  description: string;
  /** JSON schema for a SINGLE field (like one property of navigateToPage). */
  schema: {
    type: "string" | "number" | "boolean" | "array";
    enum?: (string | number)[];
    items?: { type: string; enum?: (string | number)[] };
  };
  /** String-only: `""` means "clear" instead of being dropped as filler. */
  clearable?: boolean;
  /** Current value → pushed as dynamic context so the agent knows what to change. */
  get?: () => T;
  /** Apply the state change on the page. May be async. */
  set: (
    value: T
  ) => void | AgoStateSetResult | Promise<void | AgoStateSetResult>;
}

/**
 * Tagged outcome a page setter may return to reject or mark unchanged.
 *
 * Returning nothing (void) means APPLY. Returning an unrecognized JS value
 * (e.g. a string from an assignment expression) is also treated as APPLY.
 */
export type AgoStateSetResult =
  | { result: "rejected"; reason: string }
  | { result: "unchanged" };

/** The verdict part of a setPageState answer, without the page snapshot. */
export interface AgoPageStateEnvelope {
  success: boolean;
  applied: string[];
  unchanged: string[];
  rejected?: Record<string, string>;
}

/**
 * What `setPageState` answers the agent. Every non-dropped field the agent sent
 * is accounted for by name, so it can tell a change it made from one that was
 * already true. Dropped placeholders are intentionally omitted.
 */
export interface AgoPageStateResult<TData = unknown> extends AgoPageStateEnvelope {
  data?: TData;
}

/**
 * What the page currently displays, returned to the agent as the *result* of
 * `setPageState` instead of only as context on the next message.
 *
 * Declare it when the agent should be able to act on what its own change
 * produced ("search for dupont" → it can say who was found).
 *
 * A control change usually kicks off work (a refetch, a recomputation). The SDK
 * has to wait for that work before reading, and there are two ways to tell it
 * when the work is done. **Prefer the first.**
 *
 * **1. Return a promise from `get()`** — you own the await, so the SDK is
 * exact: it resolves when your work resolves, with no polling and no timing
 * assumption. With TanStack Query, `ensureQueryData` gives you that promise and
 * shares the single in-flight request with the UI:
 *
 * ```ts
 * useAgoPageState(controls, {
 *   data: {
 *     description: "The users matching the current filters.",
 *     get: () => queryClient.ensureQueryData({
 *       queryKey: ["users", filters],
 *       queryFn: fetchUsers,
 *     }),
 *   },
 * });
 * ```
 *
 * **2. Declare `isLoading`** — for data you cannot get a promise for. The SDK
 * polls it instead, which is a heuristic: the flag has to be up within ~100 ms
 * of the change or the SDK concludes the page settled and reads the previous
 * rows. Fine for a query library that flips `isFetching` on render, wrong for a
 * debounced fetch.
 *
 * ```ts
 * const { data: users, isFetching } = useQuery({ queryKey: ["users", filters], queryFn: fetchUsers });
 *
 * useAgoPageState(controls, {
 *   data: {
 *     description: "The users matching the current filters.",
 *     get: () => users ?? [],
 *     // isFetching, NOT isLoading: a background refetch must count as loading,
 *     // otherwise the agent reads the rows from the previous search.
 *     isLoading: () => isFetching,
 *   },
 * });
 * ```
 */
export interface AgoPageDataSource<T = unknown> {
  /** What this data is, for the LLM: "The users matching the current filters." */
  description: string;
  /**
   * The snapshot handed back to the agent.
   *
   * Return a promise and the SDK awaits it: that promise resolving *is* the
   * signal that the work the change triggered has finished, so nothing is
   * guessed. It is bounded by `settleTimeoutMs`.
   */
  get: () => T | Promise<T>;
  /**
   * True while the page is (re)loading this data. Only needed when `get()`
   * cannot return a promise. The SDK polls it every 50 ms and treats two
   * consecutive `false` readings as settled, so a flag raised more than ~100 ms
   * after the change is missed and the agent reads stale rows.
   */
  isLoading?: () => boolean;
  /**
   * Size ceiling for the returned snapshot, in bytes. Defaults to the client's
   * `maxFunctionResultBytes`. Over the ceiling the snapshot keeps the first
   * whole items that fit; `success` and `applied` are never dropped.
   */
  maxResultBytes?: number;
}

/**
 * Options for {@link AgoClient.registerPageStateFunction}.
 */
export interface AgoPageStateOptions {
  /** Name of the synthesized client function. Defaults to "setPageState". */
  functionName?: string;
  /**
   * Require explicit user approval before this state change runs. See
   * {@link AgoConfig.approvalPolicy} — pause mode only. Defaults to `false`.
   */
  requiresApproval?: boolean;
  /**
   * Declare what the page displays so `setPageState` returns it. Omit it and
   * the result stays exactly `{ success, applied }`.
   *
   * Also registers a read-only companion function (`readPageData`, derived from
   * `functionName`) that returns the same snapshot without touching the page.
   *
   * The snapshot travels only when the agent calls one of those functions: it
   * is deliberately kept out of the `page-state:` dynamic context, which would
   * put it in every message.
   */
  data?: AgoPageDataSource;
  /**
   * How long to wait for the page to finish reloading before reading the
   * snapshot. Defaults to 10 000 ms; on timeout whatever is there is returned.
   */
  settleTimeoutMs?: number;
}

/**
 * The MCP behavior hints AGO has no equivalent for, used when the WebMCP bridge
 * is on (`AgoConfig.webmcp`).
 *
 * ```ts
 * webmcp: { annotations: { readOnlyHint: true } }
 * ```
 */
export interface WebMCPToolMeta {
  /**
   * Both default to `false`, so only set what is true: `readOnlyHint` marks a
   * function that changes nothing, `untrustedContentHint` one whose result may
   * carry third-party text.
   */
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
}

/** SDK-side function settings that are never sent to the backend. */
interface ClientFunctionSettings {
  /**
   * Max serialized result size in bytes before the SDK truncates it to a
   * flagged preview. Overrides the client-level default
   * (`AgoConfig.maxFunctionResultBytes`, 50 000 by default). `Infinity`
   * disables the guard for this function.
   */
  maxResultBytes?: number;
  /**
   * Require explicit user approval before this function runs. See
   * {@link AgoConfig.approvalPolicy} — pause mode only. ORs with the policy.
   */
  requiresApproval?: boolean;
  /**
   * WebMCP metadata, read only when the bridge is on (`AgoConfig.webmcp`).
   * `false` keeps this function out of WebMCP while leaving it available to the
   * in-app agent.
   */
  webmcp?: WebMCPToolMeta | false;
}

/**
 * Schema-plus-settings object accepted when registering a function: the schema
 * (minus `name`) and SDK-side options that are NOT sent to the backend.
 */
export type ClientFunctionRegisterOptions = Omit<ClientFunctionSchema, "name"> &
  ClientFunctionSettings;

/**
 * Registered function with handler
 */
export interface RegisteredFunction extends ClientFunctionSettings {
  schema: ClientFunctionSchema;
  handler: ClientFunctionHandler;
}

/**
 * Single-object function definition — combines name, schema, and handler.
 *
 * ```ts
 * const fn = defineFunction({
 *   name: "lookupOrder",
 *   description: "Look up an order by ID",
 *   parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
 *   handler: async (args) => fetchOrder(args.id as string),
 * });
 * client.registerFunction(fn);
 * ```
 */
export interface ClientFunctionDefinition extends ClientFunctionSettings {
  name: string;
  description: string;
  parameters: ClientFunctionSchema["parameters"];
  handler: ClientFunctionHandler;
}
