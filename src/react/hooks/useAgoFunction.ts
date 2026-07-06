import { useEffect, useRef } from "react";
import type {
  AgoPageStateOptions,
  AgoStateControl,
  ClientFunctionDefinition,
  ClientFunctionHandler,
} from "../../functions/types";
import { useAgoClient } from "../context/AgoContext";

export interface UseAgoFunctionOptions {
  description: string;
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
  handler: ClientFunctionHandler;
  /**
   * Max serialized result size in bytes before the SDK truncates it to a
   * flagged preview (default: `AgoConfig.maxFunctionResultBytes`, 50 000).
   * `Infinity` disables the guard for this function.
   */
  maxResultBytes?: number;
}

/**
 * Declaratively register a client-side function with the AGO agent.
 * Automatically unregisters on unmount and re-registers when deps change.
 *
 * Accepts either a full definition object (preferred) or classic (name, options) args.
 *
 * ```tsx
 * // Preferred — pass the whole definition
 * useAgoFunction({
 *   name: "showToast",
 *   description: "Show a notification to the user",
 *   parameters: { type: "object", properties: { message: { type: "string" } } },
 *   handler: async (args) => { toast(args.message); return { shown: true }; },
 * });
 *
 * // Or reuse a pre-defined function
 * const lookupOrder = defineFunction({ name: "lookupOrder", ... });
 * useAgoFunction(lookupOrder);
 *
 * // Classic form
 * useAgoFunction("showToast", { description: "...", parameters: {...}, handler: async (args) => ... });
 * ```
 */
export function useAgoFunction(definition: ClientFunctionDefinition): void;
export function useAgoFunction(
  name: string,
  options: UseAgoFunctionOptions
): void;
export function useAgoFunction(
  nameOrDef: string | ClientFunctionDefinition,
  options?: UseAgoFunctionOptions
): void {
  const client = useAgoClient();

  const { name, description, parameters, handler, maxResultBytes } =
    typeof nameOrDef === "string"
      ? { name: nameOrDef, ...(options as UseAgoFunctionOptions) }
      : nameOrDef;

  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const stableHandler: ClientFunctionHandler = (args) =>
      handlerRef.current(args);

    client.registerFunction(name, stableHandler, {
      description,
      parameters,
      maxResultBytes,
    });

    return () => {
      client.unregisterFunction(name);
    };
  }, [client, name, description, parameters, maxResultBytes]);
}

export interface AgoRoute {
  name: string;
  path: string;
  description: string;
}

/**
 * Declaratively register navigation routes with the AGO agent.
 * Wraps `registerNavigationFunction` with React lifecycle management.
 *
 * ```tsx
 * const navigate = useNavigate();
 * useAgoNavigation(navigate, [
 *   { name: "dashboard", path: "/dashboard", description: "Main dashboard" },
 *   { name: "settings", path: "/settings", description: "User settings" },
 * ]);
 * ```
 */
export function useAgoNavigation(
  navigate: (path: string) => void,
  routes: AgoRoute[]
): void {
  const client = useAgoClient();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    client.registerNavigationFunction(
      (path) => navigateRef.current(path),
      routes
    );

    return () => {
      client.unregisterNavigationFunction();
    };
  }, [client, routes]);
}

/**
 * Declaratively register editable page-state controls with the AGO agent.
 * The state-mutation mirror of `useAgoNavigation`: it wraps
 * `registerPageStateFunction` with React lifecycle management, so the agent can
 * change the current page's state (filters, sort, view mode…) and read the
 * current state back.
 *
 * ```tsx
 * const [status, setStatus] = useState("all");
 * useAgoPageState([
 *   {
 *     name: "statusFilter",
 *     description: "Filter the list by review status",
 *     schema: { type: "string", enum: ["all", "pending", "approved"] },
 *     get: () => status,
 *     set: setStatus,
 *   },
 * ]);
 * ```
 */
export function useAgoPageState(
  controls: AgoStateControl[],
  opts?: AgoPageStateOptions
): void {
  const client = useAgoClient();
  const fnName = opts?.functionName ?? "setPageState";

  // Capture the latest controls without re-registering on every render — the
  // get/set closures change each render, but the schema is stable.
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  useEffect(() => {
    // Stable wrappers: name/description/schema are read once (at register
    // time), while get/set always resolve against the freshest controls.
    const stableControls: AgoStateControl[] = controlsRef.current.map((c) => {
      const findLatest = () =>
        controlsRef.current.find((next) => next.name === c.name) ?? c;
      return {
        name: c.name,
        description: c.description,
        schema: c.schema,
        get: c.get ? () => findLatest().get?.() : undefined,
        set: (value) => findLatest().set(value),
      };
    });

    client.registerPageStateFunction(stableControls, { functionName: fnName });

    return () => {
      client.unregisterPageStateFunction(fnName);
    };
  }, [client, fnName]);
}
