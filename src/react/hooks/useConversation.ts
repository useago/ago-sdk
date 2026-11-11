import { useCallback, useEffect, useRef, useState } from "react";
import { beginBindingActivation, isBindingOwner, withBindingOwnership } from "../../client/bindingOwnership";
import { AgoError } from "../../client/errors";
import type { AgoClient } from "../../client/AgoClient";
import type { Conversation } from "../../client/types";
import { useOptionalAgoClient } from "../context/AgoContext";

export interface UseConversationOptions {
  /** The AGO client instance. If omitted, reads from AgoProvider context. */
  client?: AgoClient;
  /** Auto-load conversations on mount */
  autoLoad?: boolean;
}

export interface UseConversationResult {
  /** List of conversations */
  conversations: Conversation[];
  /** Currently selected conversation */
  currentConversation: Conversation | null;
  /** Whether conversations are loading */
  isLoading: boolean;
  /** Current error, if any */
  error: Error | null;
  /** Select a conversation */
  selectConversation: (conversationId: string) => Promise<void>;
  /** Clear current conversation (start new) */
  startNewConversation: () => void;
  /** Refresh conversations list */
  refreshConversations: () => Promise<void>;
}

/**
 * Hook to manage conversations
 */
export function useConversationInternal({
  client: clientProp,
  autoLoad = true,
}: UseConversationOptions = {}, manageActivation = true): UseConversationResult {
  const contextClient = useOptionalAgoClient();
  const client = clientProp || contextClient;

  if (!client) {
    throw new Error(
      "useConversation requires an AgoClient. Either pass it as options.client or wrap your app in <AgoProvider>."
    );
  }
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] =
    useState<Conversation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const owner = useRef<symbol>();
  const generation = useRef(0);
  useEffect(() => {
    const state = generation;
    const reset = (data: import("../../client/types").AgoClientEvents["conversation:update"]) => {
      if (data.conversationId === null) {
        generation.current++; owner.current = undefined;
        setConversations([]); setCurrentConversation(null); setError(null); setIsLoading(false);
      } else {
        setCurrentConversation((prev) => prev?.id === data.conversationId ? { ...prev, interaction: data.interaction } : prev);
      }
    };
    client.on("conversation:update", reset);
    return () => {
      state.current++;
      client.off("conversation:update", reset);
      const token = owner.current;
      if (token && isBindingOwner(client, token)) void withBindingOwnership(client, token, () => client.setActiveConversation(null)).catch(() => {});
      owner.current = undefined;
    };
  }, [client]);

  const refreshConversations = useCallback(async () => {
    const epoch = generation.current;
    setIsLoading(true);
    setError(null);

    try {
      const { data } = await client.getConversations();
      if (epoch === generation.current) setConversations(data);
    } catch (err) {
      if (epoch === generation.current) setError(
        err instanceof Error ? err : new Error("Failed to load conversations")
      );
    } finally {
      if (epoch === generation.current) setIsLoading(false);
    }
  }, [client]);

  const selectConversation = useCallback(
    async (conversationId: string) => {
      setIsLoading(true);
      setError(null);

      const { token, result } = beginBindingActivation(client, () => client.setActiveConversation(conversationId));
      owner.current = token;
      try {
        const conversation = await result;
        if (isBindingOwner(client, token)) setCurrentConversation(conversation);
      } catch (err) {
        if (isBindingOwner(client, token) && !(err instanceof AgoError && err.code === "request_detached"))
          setError(err instanceof Error ? err : new Error("Failed to load conversation"));
      } finally {
        if (isBindingOwner(client, token)) setIsLoading(false);
      }
    },
    [client]
  );

  const startNewConversation = useCallback(() => {
    setCurrentConversation(null);
    if (manageActivation) {
      const { token, result } = beginBindingActivation(client, () => client.setActiveConversation(null));
      owner.current = token; void result.catch(() => {});
    }
  }, [client, manageActivation]);

  // Auto-load conversations on mount
  useEffect(() => {
    if (autoLoad) {
      refreshConversations();
    }
  }, [autoLoad, refreshConversations]);

  return {
    conversations,
    currentConversation,
    isLoading,
    error,
    selectConversation,
    startNewConversation,
    refreshConversations,
  };
}

export function useConversation(options: UseConversationOptions = {}): UseConversationResult {
  return useConversationInternal(options);
}
