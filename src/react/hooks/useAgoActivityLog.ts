import { useCallback, useEffect, useState } from "react";
import type { ActivityEntry, ActivityInput } from "../../activity/ActivityLedger";
import type { AgoClient } from "../../client/AgoClient";
import { AgoError } from "../../client/errors";
import { useOptionalAgoClient } from "../context/AgoContext";

export interface UseAgoActivityLogOptions {
  client?: AgoClient;
}

export interface UseAgoActivityLogResult {
  entries: ActivityEntry[];
  latest?: ActivityEntry;
  record: (entry: ActivityInput) => void;
  clear: () => void;
}

/** Recent user + agent activity, kept in sync with the client's ledger. */
export function useAgoActivityLog(
  options: UseAgoActivityLogOptions = {}
): UseAgoActivityLogResult {
  const contextClient = useOptionalAgoClient();
  const client = options.client || contextClient;

  if (!client) {
    throw new AgoError(
      "useAgoActivityLog requires an AgoClient. Either pass it as options.client or wrap your app in <AgoProvider>.",
      "provider_missing_client"
    );
  }

  const [entries, setEntries] = useState<ActivityEntry[]>(() =>
    client.getRecentActivity()
  );

  useEffect(() => {
    setEntries(client.getRecentActivity());
    const onRecorded = () => setEntries(client.getRecentActivity());
    client.on("activity:recorded", onRecorded);
    return () => client.off("activity:recorded", onRecorded);
  }, [client]);

  const record = useCallback(
    (entry: ActivityInput) => client.recordActivity(entry),
    [client]
  );

  const clear = useCallback(() => {
    client.clearActivity();
    setEntries([]);
  }, [client]);

  return {
    entries,
    latest: entries.length > 0 ? entries[entries.length - 1] : undefined,
    record,
    clear,
  };
}
