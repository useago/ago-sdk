import { useEffect, useMemo, useRef, useState } from "react";
import { AgoClient } from "../../client/AgoClient";
import type { AgoConfig } from "../../client/types";

export interface UseAgoOptions extends AgoConfig {}

export interface UseAgoResult {
  /** The AGO client instance */
  client: AgoClient;
  /** Whether the client is ready */
  isReady: boolean;
}

/**
 * Hook to create and manage an AgoClient instance
 */
export function useAgo(config: UseAgoOptions): UseAgoResult {
  const [isReady, setIsReady] = useState(false);
  const clientRef = useRef<AgoClient | null>(null);

  // Create client on mount
  const client = useMemo(() => {
    if (clientRef.current) {
      clientRef.current.destroy();
    }
    const newClient = new AgoClient(config);
    clientRef.current = newClient;
    return newClient;
  }, [config.baseUrl, config.widgetId]);

  useEffect(() => {
    setIsReady(true);

    return () => {
      clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, [client]);

  // Update config when it changes (except for the keys that recreate the client)
  useEffect(() => {
    if (clientRef.current) {
      clientRef.current.updateConfig({
        agent: config.agent,
        defaultAgentId: config.defaultAgentId,
        permission: config.permission,
        userEmail: config.userEmail,
        userJwt: config.userJwt,
        debug: config.debug,
      });
    }
  }, [config.agent, config.defaultAgentId, config.permission, config.userEmail, config.userJwt, config.debug]);

  return {
    client,
    isReady,
  };
}
