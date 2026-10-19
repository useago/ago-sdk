import { useCallback, useSyncExternalStore } from "react";
import type { AgoClient } from "../../client/AgoClient";
import { uiCatalog } from "../../i18n";
import { useOptionalAgoClient } from "../context/AgoContext";

export function useUiCatalog(explicitClient?: AgoClient | null) {
  const contextClient = useOptionalAgoClient();
  const client = explicitClient ?? contextClient;
  const subscribe = useCallback((notify: () => void) => {
    client?.on("config:changed", notify);
    return () => { client?.off("config:changed", notify); };
  }, [client]);
  const snapshot = () => client?.getLanguage?.() ?? null;
  return uiCatalog(useSyncExternalStore(subscribe, snapshot, snapshot));
}
