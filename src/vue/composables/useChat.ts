import { computed } from "vue";
import type { AgoClient } from "../../client/AgoClient";
import { useMessagesInternal } from "./useMessages";
import { useConversationInternal } from "./useConversation";

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
  const msgResult = useMessagesInternal({
    client: options.client,
    conversationId: options.conversationId,
  });

  const convResult = useConversationInternal({
    client: options.client,
    autoLoad: options.autoLoad,
  }, false);

  const error = computed(
    () => msgResult.error.value || convResult.error.value
  );

  return {
    // Messages
    messages: msgResult.messages,
    isLoading: msgResult.isLoading,
    error,
    sendMessage: msgResult.sendMessage,
    stop: msgResult.stop,
    clearMessages: msgResult.clearMessages,
    conversationId: msgResult.conversationId,
    // Conversations
    conversations: convResult.conversations,
    currentConversation: msgResult.currentConversation,
    isConversationsLoading: convResult.isLoading,
    selectConversation: async (id: string) => { await msgResult.activate(id); },
    startNewConversation: msgResult.clearMessages,
    refreshConversations: convResult.refreshConversations,
  };
}
