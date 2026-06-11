import type { ClientFunctionDefinition } from "./types";

/**
 * Create a reusable function definition.
 * Returns the same object — this is an identity function for discoverability and type-checking.
 *
 * ```ts
 * // Define once, reuse anywhere
 * export const lookupOrder = defineFunction({
 *   name: "lookupOrder",
 *   description: "Look up an order by ID",
 *   parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
 *   handler: async (args) => fetchOrder(args.id as string),
 * });
 *
 * // Register with client
 * client.registerFunction(lookupOrder);
 *
 * // Or use in React
 * useAgoFunction(lookupOrder.name, lookupOrder);
 * ```
 */
export function defineFunction(
  definition: ClientFunctionDefinition
): ClientFunctionDefinition {
  return definition;
}
