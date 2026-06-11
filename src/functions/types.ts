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
        enum?: string[];
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
 * Registered function with handler
 */
export interface RegisteredFunction {
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
export interface ClientFunctionDefinition {
  name: string;
  description: string;
  parameters: ClientFunctionSchema["parameters"];
  handler: ClientFunctionHandler;
}
