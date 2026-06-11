import type {
  ClientFunctionDefinition,
  ClientFunctionHandler,
} from "../functions/types";

/**
 * Attach a handler to a pre-built function definition.
 *
 * Pre-built helpers (`showToast`, `trackEvent`, ...) ship with a no-op or
 * console-logging default handler. Use `withHandler` to wire them up to
 * your actual implementation without mutating the original definition.
 *
 * ```ts
 * import { showToast, withHandler } from "@useago/sdk";
 *
 * client.register(
 *   withHandler(showToast, (args) => {
 *     myToast(args.message as string);
 *     return { shown: true };
 *   })
 * );
 * ```
 */
export function withHandler<T extends ClientFunctionDefinition>(
  definition: T,
  handler: ClientFunctionHandler
): T {
  return { ...definition, handler };
}
