import { useEffect, useState } from "react";
import type { AgoClient } from "../../client/AgoClient";
import type { HandoffState } from "../../client/types";
import { AgoError } from "../../client/errors";
import { useOptionalAgoClient } from "../context/AgoContext";

export interface UseHandoffResult {
  /** `null` while the AI answers. */
  handoff: HandoffState | null;
  /** A visitor asked for a human and nobody picked it up yet. */
  isWaiting: boolean;
  /** A human support agent owns the conversation (the AI is silent). */
  isHuman: boolean;
  /** First name of the agent, when known. */
  agentName: string | null;
}

/**
 * Live human takeover state of a conversation (the active one by default).
 *
 * ```tsx
 * const { isWaiting, isHuman, agentName } = useHandoff(conversationId);
 * if (isWaiting) return <p>Waiting for an agent</p>;
 * if (isHuman) return <p>You are talking with {agentName ?? "an agent"}</p>;
 * ```
 */
export function useHandoff(
  conversationId?: string | null,
  options: { client?: AgoClient } = {},
): UseHandoffResult {
  const contextClient = useOptionalAgoClient();
  const client = options.client || contextClient;
  if (!client) {
    throw new AgoError(
      "useHandoff requires an AgoClient. Either pass it as options.client or wrap your app in <AgoProvider>.",
      "missing_client",
    );
  }
  const read = (): HandoffState | null => {
    const id = conversationId ?? client.getActiveConversation();
    return id ? client.getHandoff(id) : null;
  };
  const [handoff, setHandoff] = useState<HandoffState | null>(read);

  useEffect(() => {
    const refresh = () => setHandoff(read());
    refresh();
    client.on("handoff:changed", refresh);
    client.on("conversation:updated", refresh);
    client.on("conversation:loaded", refresh);
    client.on("message:complete", refresh);
    client.on("message:handoff-paused", refresh);
    return () => {
      client.off("handoff:changed", refresh);
      client.off("conversation:updated", refresh);
      client.off("conversation:loaded", refresh);
      client.off("message:complete", refresh);
      client.off("message:handoff-paused", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, conversationId]);

  return {
    handoff,
    isWaiting: handoff?.state === "waiting",
    isHuman: handoff?.state === "human",
    agentName: handoff?.agentName ?? null,
  };
}
