import { inject } from "vue";
import { AgoClient } from "../../client/AgoClient";
import type { AgoConfig } from "../../client/types";
import { AGO_CLIENT_KEY } from "../symbols";

/**
 * Get or create an AgoClient.
 *
 * - Without args: returns the client from `AgoPlugin` (throws if none).
 * - With config: creates a new client instance.
 *
 * ```ts
 * // From plugin
 * const client = useAgo();
 *
 * // Standalone
 * const client = useAgo({ baseUrl: "https://YOUR-DOMAIN.useago.com" });
 * ```
 */
export function useAgo(config?: AgoConfig): AgoClient {
  if (config) {
    return new AgoClient(config);
  }

  const client = inject(AGO_CLIENT_KEY);
  if (!client) {
    throw new Error(
      "useAgo(): no AgoClient found. Either pass config or install AgoPlugin."
    );
  }
  return client;
}
