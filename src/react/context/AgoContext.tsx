import React, { createContext, useContext, useEffect } from "react";
import type { AgoClient } from "../../client/AgoClient";
import type { AgoConfig } from "../../client/types";
import type {
  ClientFunctionDefinition,
  ClientFunctionHandler,
} from "../../functions/types";
import { useAgo } from "../hooks/useAgo";

const AgoContext = createContext<AgoClient | null>(null);

/**
 * Top-level declarative configuration for the `AgoProvider`.
 *
 * - `tools` — full function definitions to expose to the AI app-wide
 * - `helpers` — map of pre-built helper name → handler override (or `true` for default)
 * - `pageContext` — `"auto"` enables automatic URL/title capture
 */
export interface AgoDeclarativeConfig {
  tools?: ClientFunctionDefinition[];
  helpers?: Record<string, ClientFunctionHandler | true>;
  pageContext?: "auto" | "manual";
}

export type AgoProviderProps = {
  children: React.ReactNode;
} & AgoDeclarativeConfig &
  (
    | ({ client: AgoClient } & Partial<Record<keyof AgoConfig, never>>)
    | ({ client?: never } & AgoConfig)
  );

/**
 * Provides an AgoClient to all descendant components via React context.
 *
 * ```tsx
 * // Minimal setup
 * <AgoProvider baseUrl="https://YOUR-DOMAIN.useago.com">
 *   <App />
 * </AgoProvider>
 *
 * // Declarative config — tools, helpers, page context
 * <AgoProvider
 *   baseUrl="https://YOUR-DOMAIN.useago.com"
 *   tools={[lookupOrder, cancelOrder]}
 *   helpers={{
 *     showToast: (args) => toast(args.message as string),
 *     copyToClipboard: true, // use default handler
 *   }}
 *   pageContext="auto"
 * >
 *   <App />
 * </AgoProvider>
 *
 * // With a pre-built client (useful for testing)
 * <AgoProvider client={myClient}>
 *   <App />
 * </AgoProvider>
 * ```
 */
export const AgoProvider: React.FC<AgoProviderProps> = ({
  children,
  client: externalClient,
  tools,
  helpers,
  pageContext,
  ...config
}) => {
  // Only call useAgo when no external client is provided
  const { client: internalClient } = useAgo(
    externalClient ? { baseUrl: "" } : (config as AgoConfig)
  );
  const client = externalClient || internalClient;

  // Register app-wide tools declaratively
  useEffect(() => {
    if (!tools || tools.length === 0) return;

    for (const tool of tools) {
      client.register(tool);
    }

    return () => {
      for (const tool of tools) {
        client.unregisterFunction(tool.name);
      }
    };
  }, [client, tools]);

  // Wire up pre-built helpers declaratively
  useEffect(() => {
    if (!helpers) return;

    const registered: string[] = [];
    // Lazy-load helpers to avoid pulling the whole module if unused
    import("../../helpers/functions").then((mod) => {
      for (const [name, handlerOrTrue] of Object.entries(helpers)) {
        const helper = (mod as unknown as Record<string, ClientFunctionDefinition | undefined>)[name];
        if (!helper) {
          console.warn(`[AGO] Unknown helper: "${name}"`);
          continue;
        }
        const definition: ClientFunctionDefinition =
          handlerOrTrue === true
            ? helper
            : { ...helper, handler: handlerOrTrue };
        client.register(definition);
        registered.push(definition.name);
      }
    });

    return () => {
      for (const name of registered) {
        client.unregisterFunction(name);
      }
    };
  }, [client, helpers]);

  // Enable automatic page context capture
  useEffect(() => {
    if (pageContext === "auto") {
      client.enableAutoPageContext();
    }
  }, [client, pageContext]);

  return <AgoContext.Provider value={client}>{children}</AgoContext.Provider>;
};

/**
 * Returns the AgoClient from the nearest AgoProvider.
 * Throws if used outside of an AgoProvider.
 */
export function useAgoClient(): AgoClient {
  const client = useContext(AgoContext);
  if (!client) {
    throw new Error(
      "useAgoClient must be used within an <AgoProvider>. " +
        "Wrap your component tree with <AgoProvider baseUrl=\"...\">."
    );
  }
  return client;
}

/**
 * Returns the AgoClient from context, or null if no provider exists.
 * Use this when client access is optional.
 */
export function useOptionalAgoClient(): AgoClient | null {
  return useContext(AgoContext);
}
