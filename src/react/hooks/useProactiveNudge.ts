import { useCallback, useEffect, useRef, useState } from "react";
import type { AgoClient } from "../../client/AgoClient";
import { AgoError } from "../../client/errors";
import type { ProactiveNudgeInstance } from "../../proactive/types";
import { useOptionalAgoClient } from "../context/AgoContext";

export interface UseProactiveNudgeOptions {
  /** The AGO client instance. If omitted, reads from AgoProvider context. */
  client?: AgoClient;
  /**
   * Called after `accept()` when the nudge should expand into the chat (it
   * came from `intervene: 'agent'` or carries a `goal`). The SDK has already
   * pre-seeded the conversation with a hidden kickoff message at this point;
   * use this to open your chat UI (widget, panel…).
   */
  onExpand?: (nudge: ProactiveNudgeInstance) => void;
}

export interface UseProactiveNudgeResult {
  /** The active nudge, or `null` when none is ready. */
  nudge: ProactiveNudgeInstance | null;
  /** Accept the nudge: run its action, seed the chat when relevant, clear it. */
  accept: () => Promise<void>;
  /** Dismiss the nudge (suppresses its trigger, see the governor). */
  dismiss: () => void;
}

/**
 * Consume proactive nudges (see `createAgoProactive` / `AgoConfig.proactive`).
 * Receiving a nudge marks it as shown (impression tracking + frequency caps),
 * so only render ONE consumer of this hook per nudge surface — or use the
 * prebuilt `<AgoNudge />`.
 *
 * ```tsx
 * const { nudge, accept, dismiss } = useProactiveNudge({
 *   onExpand: () => setChatOpen(true),
 * });
 * if (!nudge) return null;
 * return <MyToast text={nudge.message} onAccept={accept} onClose={dismiss} />;
 * ```
 */
export function useProactiveNudge(
  options: UseProactiveNudgeOptions = {}
): UseProactiveNudgeResult {
  const contextClient = useOptionalAgoClient();
  const client = options.client ?? contextClient;
  if (!client) {
    throw new AgoError(
      "useProactiveNudge: no AgoClient. Pass one via options.client or wrap " +
        "your tree with <AgoProvider>.",
      "proactive_missing_client"
    );
  }

  const [nudge, setNudge] = useState<ProactiveNudgeInstance | null>(null);

  // Stable refs so accept/dismiss keep their identity across renders.
  const nudgeRef = useRef(nudge);
  nudgeRef.current = nudge;
  const onExpandRef = useRef(options.onExpand);
  onExpandRef.current = options.onExpand;

  useEffect(() => {
    const onReady = (next: ProactiveNudgeInstance) => {
      setNudge(next);
      // Idempotent per nudge id: caps + impression tracking + nudge:shown.
      client.proactive?.shown(next);
    };
    // Keep every hook instance in sync when the nudge is resolved elsewhere.
    const onResolved = ({ nudge: resolved }: { nudge: ProactiveNudgeInstance }) => {
      setNudge((current) => (current?.id === resolved.id ? null : current));
    };

    client.on("nudge:ready", onReady);
    client.on("nudge:accepted", onResolved);
    client.on("nudge:dismissed", onResolved);
    return () => {
      client.off("nudge:ready", onReady);
      client.off("nudge:accepted", onResolved);
      client.off("nudge:dismissed", onResolved);
    };
  }, [client]);

  const accept = useCallback(async () => {
    const current = nudgeRef.current;
    if (!current) return;
    setNudge(null);
    await client.proactive?.accept(current);
    if (current.source === "agent" || current.goal) {
      onExpandRef.current?.(current);
    }
  }, [client]);

  const dismiss = useCallback(() => {
    const current = nudgeRef.current;
    if (!current) return;
    setNudge(null);
    client.proactive?.dismiss(current);
  }, [client]);

  return { nudge, accept, dismiss };
}
