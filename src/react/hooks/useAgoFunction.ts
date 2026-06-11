import { useEffect, useRef } from "react";
import type { ClientFunctionDefinition, ClientFunctionHandler } from "../../functions/types";
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
        enum?: string[];
        default?: unknown;
      }
    >;
    required?: string[];
  };
  handler: ClientFunctionHandler;
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

  const { name, description, parameters, handler } =
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
    });

    return () => {
      client.unregisterFunction(name);
    };
  }, [client, name, description, parameters]);
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
      client.unregisterFunction("navigateToPage");
    };
  }, [client, routes]);
}
