import { useEffect, useRef } from "react";
import type {
  AgoPageDataSource,
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
  /**
   * Require explicit user approval before this function runs (pause mode only).
   * See `AgoConfig.approvalPolicy`.
   */
  requiresApproval?: boolean;
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

  const { name, description, parameters, handler, maxResultBytes, requiresApproval } =
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
      requiresApproval,
    });

    return () => {
      client.unregisterFunction(name);
    };
  }, [client, name, description, parameters, maxResultBytes, requiresApproval]);
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
 *
 * Pass `opts.data` to also hand the agent what the page ends up displaying, as
 * the result of its own `setPageState` call:
 *
 * ```tsx
 * const { data: rows, isFetching } = useQuery({ queryKey: ["rows", status], queryFn: fetchRows });
 *
 * useAgoPageState(controls, {
 *   data: {
 *     description: "The rows matching the current filters.",
 *     get: () => rows ?? [],
 *     isLoading: () => isFetching,
 *   },
 * });
 * ```
 */
export function useAgoPageState(
  controls: AgoStateControl[],
  opts?: AgoPageStateOptions
): void {
  const client = useAgoClient();
  const fnName = opts?.functionName ?? "setPageState";
  const requiresApproval = opts?.requiresApproval;
  // Only the static shape belongs in the deps: `data` itself is a fresh object
  // literal on every render, and re-registering that often would churn the
  // function list for nothing.
  const hasData = opts?.data !== undefined;
  const dataDescription = opts?.data?.description;
  const dataMaxResultBytes = opts?.data?.maxResultBytes;
  const settleTimeoutMs = opts?.settleTimeoutMs;

  // Capture the latest controls without re-registering on every render — the
  // get/set closures change each render, but the schema is stable.
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Re-register when model-visible fields change (e.g. an enum populated after
  // an async load), but not on get/set closure churn.
  const controlSignature = JSON.stringify(
    controls.map((c) => ({
      name: c.name,
      description: c.description,
      schema: c.schema,
      clearable: c.clearable,
    }))
  );

  useEffect(() => {
    // Stable wrappers: name/description/schema are read from the current
    // render, while get/set always resolve against the freshest controls.
    const stableControls: AgoStateControl[] = controlsRef.current.map((c) => {
      const findLatest = () =>
        controlsRef.current.find((next) => next.name === c.name) ?? c;
      return {
        name: c.name,
        description: c.description,
        schema: c.schema,
        clearable: c.clearable,
        get: c.get ? () => findLatest().get?.() : undefined,
        set: (value) => findLatest().set(value),
      };
    });

    // Same treatment for the data source: the snapshot must come from the
    // render that just committed, not from the one that mounted the hook.
    const data: AgoPageDataSource | undefined = hasData
      ? {
          // Defaulted rather than required at runtime: a plain-JS caller who
          // omits it should still get their data through, not silently lose it.
          description: dataDescription ?? "What the page is currently showing.",
          maxResultBytes: dataMaxResultBytes,
          get: () => optsRef.current?.data?.get(),
          isLoading: () => optsRef.current?.data?.isLoading?.() ?? false,
        }
      : undefined;

    client.registerPageStateFunction(stableControls, {
      functionName: fnName,
      requiresApproval,
      data,
      settleTimeoutMs,
    });

    return () => {
      client.unregisterPageStateFunction(fnName);
    };
  }, [
    client,
    fnName,
    requiresApproval,
    hasData,
    dataDescription,
    dataMaxResultBytes,
    settleTimeoutMs,
    controlSignature,
  ]);
}
