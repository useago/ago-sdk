import { onMounted, onUnmounted, shallowRef, type ShallowRef } from "vue";
import type { ProactiveNudgeInstance } from "../../proactive/types";
import { useAgo } from "./useAgo";

export interface UseProactiveNudgeResult {
  /** The active nudge, or `null` when none is ready. */
  nudge: ShallowRef<ProactiveNudgeInstance | null>;
  /** Accept the nudge: run its action, seed the chat when relevant, clear it. */
  accept: () => Promise<void>;
  /** Dismiss the nudge (suppresses its trigger, see the governor). */
  dismiss: () => void;
}

/**
 * Consume proactive nudges (see `createAgoProactive` / `AgoConfig.proactive`)
 * with auto-cleanup on unmount. Vue mirror of the React `useProactiveNudge`.
 * Receiving a nudge marks it as shown (impression tracking + frequency caps),
 * so render only ONE consumer per nudge surface.
 *
 * ```ts
 * const { nudge, accept, dismiss } = useProactiveNudge();
 * ```
 */
export function useProactiveNudge(): UseProactiveNudgeResult {
  const client = useAgo();
  const nudge = shallowRef<ProactiveNudgeInstance | null>(null);

  const onReady = (next: ProactiveNudgeInstance) => {
    nudge.value = next;
    // Idempotent per nudge id: caps + impression tracking + nudge:shown.
    client.proactive?.shown(next);
  };
  // Keep this instance in sync when the nudge is resolved elsewhere.
  const onResolved = ({ nudge: resolved }: { nudge: ProactiveNudgeInstance }) => {
    if (nudge.value?.id === resolved.id) nudge.value = null;
  };

  onMounted(() => {
    client.on("nudge:ready", onReady);
    client.on("nudge:accepted", onResolved);
    client.on("nudge:dismissed", onResolved);
  });

  onUnmounted(() => {
    client.off("nudge:ready", onReady);
    client.off("nudge:accepted", onResolved);
    client.off("nudge:dismissed", onResolved);
  });

  return {
    nudge,
    accept: async () => {
      const current = nudge.value;
      if (!current) return;
      nudge.value = null;
      await client.proactive?.accept(current);
    },
    dismiss: () => {
      const current = nudge.value;
      if (!current) return;
      nudge.value = null;
      client.proactive?.dismiss(current);
    },
  };
}
