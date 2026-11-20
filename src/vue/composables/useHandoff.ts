import { computed, onMounted, onUnmounted, ref, unref, watch, type Ref } from "vue";
import type { AgoClient } from "../../client/AgoClient";
import type { HandoffState } from "../../client/types";
import { useAgo } from "./useAgo";

/**
 * Live human takeover state of a conversation (the active one by default).
 *
 * ```ts
 * const { isWaiting, isHuman, agentName } = useHandoff(conversationId);
 * ```
 */
export function useHandoff(
  conversationId?: Ref<string | undefined | null> | string | null,
  options: { client?: AgoClient } = {},
) {
  const client = options.client ?? useAgo();
  const read = (): HandoffState | null => {
    const id = unref(conversationId) ?? client.getActiveConversation();
    return id ? client.getHandoff(id) : null;
  };
  const handoff = ref<HandoffState | null>(read());
  const refresh = () => {
    handoff.value = read();
  };
  const events = [
    "handoff:changed",
    "conversation:updated",
    "conversation:loaded",
    "message:complete",
    "message:handoff-paused",
  ] as const;

  onMounted(() => {
    refresh();
    for (const event of events) client.on(event, refresh);
  });
  onUnmounted(() => {
    for (const event of events) client.off(event, refresh);
  });
  if (conversationId && typeof conversationId === "object") watch(conversationId, refresh);

  return {
    handoff,
    isWaiting: computed(() => handoff.value?.state === "waiting"),
    isHuman: computed(() => handoff.value?.state === "human"),
    agentName: computed(() => handoff.value?.agentName ?? null),
  };
}
