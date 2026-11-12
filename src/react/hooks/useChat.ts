import type { AgoClient } from "../../client/AgoClient";
import type { AgoMessage, AgoUploadFile, Conversation } from "../../client/types";
import { useOptionalAgoClient } from "../context/AgoContext";
import { useConversationInternal } from "./useConversation";
import { useMessagesInternal } from "./useMessages";

export interface UseChatOptions {
  /** AgoClient instance. If omitted, reads from AgoProvider context. */
  client?: AgoClient;
  /** Initial conversation ID to load */
  conversationId?: string;
  /** Auto-load conversation list on mount (default: true) */
  autoLoad?: boolean;
}

export interface UseChatResult {
  /** Messages in the current conversation */
  messages: AgoMessage[];
  /** Whether a message is being sent/streamed */
  isLoading: boolean;
  /** Current error */
  error: Error | null;
  /** Send a message */
  sendMessage: (content: string, files?: AgoUploadFile[]) => Promise<AgoMessage | null>;
  /** Stop the turn that is generating (the "Stop" button). No-op when idle. */
  stop: () => Promise<void>;
  /** Clear current messages */
  clearMessages: () => void;
  /** Current conversation ID */
  conversationId: string | undefined;
  /** All conversations */
  conversations: Conversation[];
  /** Currently selected conversation */
  currentConversation: Conversation | null;
  /** Whether conversations are loading */
  isConversationsLoading: boolean;
  /** Select a conversation by ID */
  selectConversation: (conversationId: string) => Promise<void>;
  /** Start a new conversation */
  startNewConversation: () => void;
  /** Refresh conversations list */
  refreshConversations: () => Promise<void>;
}

/**
 * All-in-one hook for building a custom chat UI.
 * Composes useMessages + useConversation.
 *
 * ```tsx
 * const { messages, sendMessage, conversations, selectConversation } = useChat();
 * ```
 */
export function useChat(options: UseChatOptions = {}): UseChatResult {
  const contextClient = useOptionalAgoClient();
  const client = options.client || contextClient;

  if (!client) {
    throw new Error(
      "useChat requires an AgoClient. Either pass it as options.client or wrap your app in <AgoProvider>."
    );
  }

  const messageResult = useMessagesInternal({
    client,
    conversationId: options.conversationId,
  });

  const conversationResult = useConversationInternal({
    client,
    autoLoad: options.autoLoad,
  }, false);

  return {
    messages: messageResult.messages,
    isLoading: messageResult.isLoading,
    error: messageResult.error || conversationResult.error,
    sendMessage: messageResult.sendMessage,
    stop: messageResult.stop,
    clearMessages: messageResult.clearMessages,
    conversationId: messageResult.conversationId,
    conversations: conversationResult.conversations,
    currentConversation: messageResult.currentConversation,
    isConversationsLoading: conversationResult.isLoading,
    selectConversation: async (id) => { await messageResult.activate(id); },
    startNewConversation: messageResult.clearMessages,
    refreshConversations: conversationResult.refreshConversations,
  };
}
