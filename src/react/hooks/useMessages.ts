import { useCallback, useEffect, useState } from "react";
import type { AgoClient } from "../../client/AgoClient";
import type { AgoMessage } from "../../client/types";
import { attachmentsFromFiles } from "../../utils/attachments";
import { useOptionalAgoClient } from "../context/AgoContext";

export interface UseMessagesOptions {
  /** The AGO client instance. If omitted, reads from AgoProvider context. */
  client?: AgoClient;
  /** Conversation ID to load messages for */
  conversationId?: string;
}

export interface UseMessagesResult {
  /** List of messages */
  messages: AgoMessage[];
  /** Whether a message is being sent */
  isLoading: boolean;
  /** Current error, if any */
  error: Error | null;
  /** Send a new message */
  sendMessage: (content: string, files?: File[]) => Promise<AgoMessage | null>;
  /** Clear messages */
  clearMessages: () => void;
  /** Current conversation ID */
  conversationId: string | undefined;
}

/**
 * Hook to manage messages in a conversation
 */
export function useMessages({
  client: clientProp,
  conversationId: initialConversationId,
}: UseMessagesOptions = {}): UseMessagesResult {
  const contextClient = useOptionalAgoClient();
  const client = clientProp || contextClient;

  if (!client) {
    throw new Error(
      "useMessages requires an AgoClient. Either pass it as options.client or wrap your app in <AgoProvider>."
    );
  }
  const [messages, setMessages] = useState<AgoMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(
    initialConversationId
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Load messages when conversation ID changes
  useEffect(() => {
    if (initialConversationId && initialConversationId !== conversationId) {
      setConversationId(initialConversationId);
      loadMessages(initialConversationId);
    }
    // Intentionally keyed on the prop only: `conversationId` is compared inside
    // the guard, and `loadMessages` is recreated every render (not memoized).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId]);

  const loadMessages = async (convId: string) => {
    try {
      const loadedMessages = await client.getMessages(convId);
      setMessages(loadedMessages);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load messages"));
    }
  };

  // Subscribe to message events
  useEffect(() => {
    const handleMessageStart = (data: { conversationId: string; messageId: string }) => {
      // Update conversation ID if this is a new conversation
      if (!conversationId) {
        setConversationId(data.conversationId);
      }
    };

    const handleMessageChunk = (data: {
      content: string;
      conversationId: string;
      messageId: string;
    }) => {
      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && lastMessage.id === data.messageId) {
          return [
            ...prev.slice(0, -1),
            { ...lastMessage, content: lastMessage.content + data.content },
          ];
        }
        return prev;
      });
    };

    const handleAnswerComplete = (message: AgoMessage) => {
      // Main answer text is done; follow-up replies may still be streaming. Reveal
      // the answer and flip the streaming assistant message to DONE (adopting the
      // real id from the event so message:complete updates the same entry), but
      // keep `isLoading` so the follow-up indicator stays until the stream closes.
      setMessages((prev) => {
        let streamingIndex = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === "assistant" && prev[i].status === "IN_PROGRESS") {
            streamingIndex = i;
            break;
          }
        }
        if (streamingIndex < 0) return prev;
        return [
          ...prev.slice(0, streamingIndex),
          { ...prev[streamingIndex], ...message },
          ...prev.slice(streamingIndex + 1),
        ];
      });
    };

    const handleMessageComplete = (message: AgoMessage) => {
      setMessages((prev) => {
        // Replace the streaming message with the complete one
        const existingIndex = prev.findIndex((m) => m.id === message.id);
        if (existingIndex >= 0) {
          return [...prev.slice(0, existingIndex), message, ...prev.slice(existingIndex + 1)];
        }
        return [...prev, message];
      });
      setIsLoading(false);
    };

    const handleMessageError = (data: { error: string }) => {
      setError(new Error(data.error));
      setIsLoading(false);
    };

    client.on("message:start", handleMessageStart);
    client.on("message:chunk", handleMessageChunk);
    client.on("message:answer-complete", handleAnswerComplete);
    client.on("message:complete", handleMessageComplete);
    client.on("message:error", handleMessageError);

    return () => {
      client.off("message:start", handleMessageStart);
      client.off("message:chunk", handleMessageChunk);
      client.off("message:answer-complete", handleAnswerComplete);
      client.off("message:complete", handleMessageComplete);
      client.off("message:error", handleMessageError);
    };
  }, [client, conversationId]);

  const sendMessage = useCallback(
    async (content: string, files?: File[]): Promise<AgoMessage | null> => {
      setIsLoading(true);
      setError(null);

      // Add optimistic user message, with local previews of any uploaded files
      // so they show on the user's own bubble before the server round trip.
      const userMessage: AgoMessage = {
        id: `temp-${Date.now()}`,
        conversationId: conversationId || "",
        content,
        role: "user",
        status: "DONE",
        attachments:
          files && files.length > 0 ? attachmentsFromFiles(files) : undefined,
        createdAt: new Date(),
      };

      // Add empty assistant message for streaming
      const assistantMessage: AgoMessage = {
        id: `temp-assistant-${Date.now()}`,
        conversationId: conversationId || "",
        content: "",
        role: "assistant",
        status: "IN_PROGRESS",
        createdAt: new Date(),
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);

      try {
        const response = await client.sendMessage(content, {
          conversationId,
          files,
        });

        // Update conversation ID if new
        if (response.conversationId && !conversationId) {
          setConversationId(response.conversationId);
        }

        // Replace temp messages with real ones.
        // The handleMessageComplete callback may also fire — it uses findIndex
        // by message.id so it will simply update the same entry (no duplicate).
        setMessages((prev) => {
          const filtered = prev.filter(
            (m) => !m.id.startsWith("temp-")
          );

          const updatedUserMessage = {
            ...userMessage,
            id: userMessage.id.replace("temp-", "user-"),
            conversationId: response.conversationId,
          };

          // Only add the response if it's not already present (the event
          // handler may have already inserted it).
          const alreadyPresent = filtered.some((m) => m.id === response.id);
          if (alreadyPresent) {
            return [...filtered, updatedUserMessage].sort(
              (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
          }

          return [...filtered, updatedUserMessage, response];
        });

        return response;
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to send message"));
        setIsLoading(false);

        // Remove the optimistic messages on error
        setMessages((prev) => prev.filter((m) => !m.id.startsWith("temp-")));

        return null;
      }
    },
    [client, conversationId]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setConversationId(undefined);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    conversationId,
  };
}
