import { onMounted, onUnmounted } from "vue";
import type { ClientFunctionHandler, ClientFunctionSchema } from "../../functions/types";
import { useAgo } from "./useAgo";

/**
 * Register a client-side function with auto-cleanup on unmount.
 *
 * ```ts
 * useAgoFunction("showToast", {
 *   description: "Show a toast",
 *   parameters: { type: "object", properties: { message: { type: "string" } } },
 *   handler: async (args) => { toast(args.message); return { shown: true }; },
 * });
 * ```
 */
export function useAgoFunction(
  name: string,
  options: {
    description: string;
    parameters: ClientFunctionSchema["parameters"];
    handler: ClientFunctionHandler;
  }
): void {
  const client = useAgo();

  onMounted(() => {
    client.registerFunction(name, options.handler, {
      description: options.description,
      parameters: options.parameters,
    });
  });

  onUnmounted(() => {
    client.unregisterFunction(name);
  });
}

export interface AgoRoute {
  name: string;
  path: string;
  description: string;
}

/**
 * Register navigation routes with auto-cleanup on unmount.
 * Works with vue-router's `useRouter().push`.
 *
 * ```ts
 * const router = useRouter();
 * useAgoNavigation((path) => router.push(path), [
 *   { name: "dashboard", path: "/dashboard", description: "Main dashboard" },
 * ]);
 * ```
 */
export function useAgoNavigation(
  navigate: (path: string) => void,
  routes: AgoRoute[]
): void {
  const client = useAgo();

  onMounted(() => {
    client.registerNavigationFunction(navigate, routes);
  });

  onUnmounted(() => {
    client.unregisterFunction("navigateToPage");
  });
}
