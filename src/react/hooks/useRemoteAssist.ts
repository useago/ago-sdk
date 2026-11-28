import { useCallback, useSyncExternalStore } from "react";
import type { AgoClient } from "../../client/AgoClient";
import type { RemoteAssistSnapshot } from "../../remoteAssist/types";
import { AgoError } from "../../client/errors";
import { useOptionalAgoClient } from "../context/AgoContext";

export interface UseRemoteAssistResult extends RemoteAssistSnapshot {
  /** Accept the pending request (only call it from the visitor's click). */
  accept: () => Promise<boolean>;
  decline: () => void;
  /** End the session. Local first: nothing runs after it returns. */
  stop: () => void;
  /** Answer a command waiting for approval (`pendingApproval.commandId`). */
  approve: (commandId: string) => void;
  reject: (commandId: string) => void;
  /** Answer the agent's ringing call (`call.status === "ringing"`), from the visitor's click. */
  acceptCall: () => Promise<boolean>;
  declineCall: () => void;
  hangUpCall: () => void;
  setCallMuted: (muted: boolean) => void;
}

/**
 * Remote assistance state and actions, for a custom consent prompt and banner
 * (set `remoteAssist: { ui: false }` in the config to hide the built-in ones).
 *
 * ```tsx
 * const { state, session, accept, decline, stop } = useRemoteAssist();
 * if (state === "requested") return <Prompt name={session?.agentName} onAccept={accept} onDecline={decline} />;
 * if (state === "active") return <Banner name={session?.agentName} onStop={stop} />;
 * ```
 */
export function useRemoteAssist(options: { client?: AgoClient } = {}): UseRemoteAssistResult {
  const contextClient = useOptionalAgoClient();
  const client = options.client || contextClient;
  if (!client) {
    throw new AgoError(
      "useRemoteAssist requires an AgoClient. Either pass it as options.client or wrap your app in <AgoProvider>.",
      "missing_client",
    );
  }
  const controller = client.remoteAssist;
  const subscribe = useCallback(
    (notify: () => void) => controller.subscribe(notify),
    [controller],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );
  return {
    ...snapshot,
    accept: useCallback(() => controller.accept(), [controller]),
    decline: useCallback(() => controller.decline(), [controller]),
    stop: useCallback(() => controller.stop(), [controller]),
    approve: useCallback((id: string) => controller.approve(id), [controller]),
    reject: useCallback((id: string) => controller.reject(id), [controller]),
    acceptCall: useCallback(() => controller.acceptCall(), [controller]),
    declineCall: useCallback(() => controller.declineCall(), [controller]),
    hangUpCall: useCallback(() => controller.hangUpCall(), [controller]),
    setCallMuted: useCallback((muted: boolean) => controller.setCallMuted(muted), [controller]),
  };
}
