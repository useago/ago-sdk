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
  /** Current value → pushed as dynamic context so the agent knows what to change. */
  get?: () => T;
  /** Apply the state change on the page. May be async. */
  set: (value: T) => void | Promise<void>;
}

/**
 * Options for {@link AgoClient.registerPageStateFunction}.
 */
export interface AgoPageStateOptions {
  /** Name of the synthesized client function. Defaults to "setPageState". */
  functionName?: string;
}

/**
 * Schema-plus-settings object accepted when registering a function: the schema
 * (minus `name`) and SDK-side options that are NOT sent to the backend.
 */
export type ClientFunctionRegisterOptions = Omit<
  ClientFunctionSchema,
  "name"
> & {
  /**
   * Max serialized result size in bytes before the SDK truncates it to a
   * flagged preview. Overrides the client-level default
   * (`AgoConfig.maxFunctionResultBytes`, 50 000 by default). `Infinity`
   * disables the guard for this function.
   */
  maxResultBytes?: number;
};

/**
 * Registered function with handler
 */
export interface RegisteredFunction {
  schema: ClientFunctionSchema;
  handler: ClientFunctionHandler;
  /** Per-function result-size ceiling; falls back to the registry default. */
  maxResultBytes?: number;
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
export interface ClientFunctionDefinition {
  name: string;
  description: string;
  parameters: ClientFunctionSchema["parameters"];
  handler: ClientFunctionHandler;
  /**
   * Max serialized result size in bytes before the SDK truncates it to a
   * flagged preview (default: `AgoConfig.maxFunctionResultBytes`, 50 000).
   * `Infinity` disables the guard for this function.
   */
  maxResultBytes?: number;
}
