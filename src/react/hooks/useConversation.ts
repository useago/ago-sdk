import { useCallback, useEffect, useState } from "react";
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
export function useConversation({
  client: clientProp,
  autoLoad = true,
}: UseConversationOptions = {}): UseConversationResult {
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

  const refreshConversations = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const convs = await client.getConversations();
      setConversations(convs);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error("Failed to load conversations")
      );
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  const selectConversation = useCallback(
    async (conversationId: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const conversation = await client.getConversation(conversationId);
        setCurrentConversation(conversation);
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error("Failed to load conversation")
        );
      } finally {
        setIsLoading(false);
      }
    },
    [client]
  );

  const startNewConversation = useCallback(() => {
    setCurrentConversation(null);
  }, []);

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
