import { onMounted, onUnmounted } from "vue";
import type {
  AgoPageStateOptions,
  AgoStateControl,
  ClientFunctionHandler,
  ClientFunctionSchema,
} from "../../functions/types";
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
    client.unregisterNavigationFunction();
  });
}

/**
 * Register editable page-state controls with auto-cleanup on unmount.
 * The state-mutation mirror of `useAgoNavigation`: the agent can change the
 * current page's state (filters, sort, view mode…) and read it back.
 *
 * ```ts
 * const status = ref("all");
 * useAgoPageState([
 *   {
 *     name: "statusFilter",
 *     description: "Filter the list by review status",
 *     schema: { type: "string", enum: ["all", "pending", "approved"] },
 *     get: () => status.value,
 *     set: (v) => { status.value = v as string; },
 *   },
 * ]);
 * ```
 */
export function useAgoPageState(
  controls: AgoStateControl[],
  opts?: AgoPageStateOptions
): void {
  const client = useAgo();
  const fnName = opts?.functionName ?? "setPageState";

  onMounted(() => {
    client.registerPageStateFunction(controls, { functionName: fnName });
  });

  onUnmounted(() => {
    client.unregisterPageStateFunction(fnName);
  });
}
