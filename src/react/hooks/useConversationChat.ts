import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { AgoClient } from "../../client/AgoClient";
import type {
  AgoConversation,
  ConversationSendOptions,
} from "../../client/AgoConversation";
import { AgoError } from "../../client/errors";
import type { AgoMessage } from "../../client/types";
import { useOptionalAgoClient } from "../context/AgoContext";

export interface UseConversationChatOptions {
  /** The AGO client instance. If omitted, reads from AgoProvider context. */
  client?: AgoClient;
}

export interface UseConversationChatResult {
  /** The conversation object (e.g. for `conversation.on(...)`). */
  conversation: AgoConversation;
  /** Server id, or a local `draft-…` id until the first answer starts. */
  conversationId: string;
  title: string;
  /** Visible messages, with their live `toolCalls` and `functionCalls`. */
  messages: AgoMessage[];
  /** This conversation is answering (or has a message waiting to be sent). */
  isGenerating: boolean;
  /** The conversation's history is being fetched. */
  isLoading: boolean;
  error: Error | null;
  /** Send a message; waits for the running answer to end first. `null` on failure (see `error`). */
  sendMessage: (
    content: string,
    options?: ConversationSendOptions,
  ) => Promise<AgoMessage | null>;
  /** Stop this conversation's answer only. */
  stop: () => Promise<void>;
}

/**
 * One conversation, kept apart from every other: its answer keeps streaming
 * while another conversation is on screen, and switching back shows it whole.
 * Without an id, starts a new conversation. Unmounting never stops an answer.
 *
 * ```tsx
 * const { messages, isGenerating, sendMessage, stop } = useConversationChat(conversationId);
 * ```
 */
export function useConversationChat(
  conversationId?: string,
  options: UseConversationChatOptions = {},
): UseConversationChatResult {
  const contextClient = useOptionalAgoClient();
  const client = options.client || contextClient;

  if (!client) {
    throw new AgoError(
      "useConversationChat requires an AgoClient. Either pass it as options.client or wrap your app in <AgoProvider>.",
      "provider_missing_client"
    );
  }

  const conversation = useMemo(
    () => client.conversation(conversationId),
    [client, conversationId],
  );
  const snapshot = useSyncExternalStore(
    conversation.subscribe,
    conversation.getSnapshot,
    conversation.getSnapshot,
  );
  const messages = useMemo(
    () => snapshot.messages.filter((m) => !m.hidden),
    [snapshot.messages],
  );

  const sendMessage = useCallback(
    async (content: string, sendOptions?: ConversationSendOptions) => {
      try {
        return await conversation.sendMessage(content, sendOptions);
      } catch {
        return null;
      }
    },
    [conversation],
  );

  const stop = useCallback(async () => {
    await conversation.stop();
  }, [conversation]);

  return {
    conversation,
    conversationId: snapshot.id,
    title: snapshot.title,
    messages,
    isGenerating: snapshot.isGenerating,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    sendMessage,
    stop,
  };
}
