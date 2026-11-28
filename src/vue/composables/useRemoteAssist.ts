import { onMounted, onUnmounted, shallowRef } from "vue";
import type { AgoClient } from "../../client/AgoClient";
import type { RemoteAssistSnapshot } from "../../remoteAssist/types";
import { useAgo } from "./useAgo";

/**
 * Remote assistance state and actions, for a custom consent prompt and banner
 * (set `remoteAssist: { ui: false }` in the config to hide the built-in ones).
 *
 * ```ts
 * const { snapshot, accept, decline, stop } = useRemoteAssist();
 * // snapshot.value.state: "idle" | "requested" | "active"
 * ```
 */
export function useRemoteAssist(options: { client?: AgoClient } = {}) {
  const client = options.client ?? useAgo();
  const controller = client.remoteAssist;
  const snapshot = shallowRef<RemoteAssistSnapshot>(controller.getSnapshot());
  let unsubscribe: (() => void) | null = null;

  onMounted(() => {
    snapshot.value = controller.getSnapshot();
    unsubscribe = controller.subscribe(() => {
      snapshot.value = controller.getSnapshot();
    });
  });
  onUnmounted(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  return {
    snapshot,
    accept: () => controller.accept(),
    decline: () => controller.decline(),
    stop: () => controller.stop(),
    approve: (commandId: string) => controller.approve(commandId),
    reject: (commandId: string) => controller.reject(commandId),
    acceptCall: () => controller.acceptCall(),
    declineCall: () => controller.declineCall(),
    hangUpCall: () => controller.hangUpCall(),
    setCallMuted: (muted: boolean) => controller.setCallMuted(muted),
  };
}
