import { useEffect, useMemo, useRef, useState } from "react";
import { AgoClient } from "../../client/AgoClient";
import type { AgoConfig } from "../../client/types";

export type UseAgoOptions = AgoConfig;

export interface UseAgoResult {
  /** The AGO client instance */
  client: AgoClient;
  /** Whether the client is ready */
  isReady: boolean;
}

/**
 * Hook to create and manage an AgoClient instance
 *
 * Pass `null` to skip client creation entirely (used by `AgoProvider` when an
 * external client is supplied — constructing a throwaway client would waste
 * resources and fail `baseUrl` validation).
 */
export function useAgo(config: UseAgoOptions): UseAgoResult;
export function useAgo(
  config: UseAgoOptions | null
): { client: AgoClient | null; isReady: boolean };
export function useAgo(
  config: UseAgoOptions | null
): { client: AgoClient | null; isReady: boolean } {
  const [isReady, setIsReady] = useState(false);
  const clientRef = useRef<AgoClient | null>(null);

  // Create client on mount
  const client = useMemo(() => {
    if (clientRef.current) {
      clientRef.current.destroy();
      clientRef.current = null;
    }
    if (!config) {
      return null;
    }
    const newClient = new AgoClient(config);
    clientRef.current = newClient;
    return newClient;
    // Only baseUrl/widgetId recreate the client; every other key flows through
    // updateConfig below. Including `config` itself would recreate on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.baseUrl, config?.widgetId]);

  useEffect(() => {
    if (client && clientRef.current === null) {
      // A previous cleanup destroyed the memoized client and this effect is
      // re-running with the SAME instance — React StrictMode's simulated
      // unmount/remount. Hooks re-register their own functions/listeners/
      // context in their re-run effects; revive the constructor-owned
      // attachments (the proactive controller).
      clientRef.current = client;
      client.reviveAfterDestroy();
    }
    setIsReady(true);

    return () => {
      clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, [client]);

  // Update config when it changes (except for the keys that recreate the client)
  useEffect(() => {
    if (clientRef.current && config) {
      clientRef.current.updateConfig({
        agent: config.agent,
        defaultAgentId: config.defaultAgentId,
        permission: config.permission,
        userEmail: config.userEmail,
        userJwt: config.userJwt,
        getUserJwt: config.getUserJwt,
        debug: config.debug,
        warnOnEmptyReply: config.warnOnEmptyReply,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    config?.agent,
    config?.defaultAgentId,
    config?.permission,
    config?.userEmail,
    config?.userJwt,
    config?.getUserJwt,
    config?.debug,
    config?.warnOnEmptyReply,
  ]);

  return {
    client,
    isReady,
  };
}
