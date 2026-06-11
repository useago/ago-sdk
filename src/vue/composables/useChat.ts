import { computed } from "vue";
import type { AgoClient } from "../../client/AgoClient";
import { useMessages } from "./useMessages";
import { useConversation } from "./useConversation";

export interface UseChatOptions {
  client?: AgoClient;
  conversationId?: string;
  autoLoad?: boolean;
}

/**
 * All-in-one composable combining messages + conversations.
 *
 * ```ts
 * const { messages, sendMessage, conversations, selectConversation } = useChat();
 * ```
 */
export function useChat(options: UseChatOptions = {}) {
  const msgResult = useMessages({
    client: options.client,
    conversationId: options.conversationId,
  });

  const convResult = useConversation({
    client: options.client,
    autoLoad: options.autoLoad,
  });

  const error = computed(
    () => msgResult.error.value || convResult.error.value
  );

  return {
    // Messages
    messages: msgResult.messages,
    isLoading: msgResult.isLoading,
    error,
    sendMessage: msgResult.sendMessage,
    clearMessages: msgResult.clearMessages,
    conversationId: msgResult.conversationId,
    // Conversations
    conversations: convResult.conversations,
    currentConversation: convResult.currentConversation,
    isConversationsLoading: convResult.isLoading,
    selectConversation: convResult.selectConversation,
    startNewConversation: convResult.startNewConversation,
    refreshConversations: convResult.refreshConversations,
  };
}
