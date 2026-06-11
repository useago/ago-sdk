import { onMounted, onUnmounted } from "vue";
import type { AgoClientEvents, AgoEventName } from "../../client/types";
import { useAgo } from "./useAgo";

/**
 * Subscribe to AGO client events with auto-cleanup on unmount.
 *
 * ```ts
 * useAgoEvents("message:complete", (msg) => {
 *   console.log("Got message:", msg.content);
 * });
 * ```
 */
export function useAgoEvents<K extends AgoEventName>(
  event: K,
  handler: (data: AgoClientEvents[K]) => void
): void {
  const client = useAgo();

  onMounted(() => {
    client.on(event, handler);
  });

  onUnmounted(() => {
    client.off(event, handler);
  });
}
