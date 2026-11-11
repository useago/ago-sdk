import { useCallback, useEffect, useRef, useState } from "react";
import type { AgoClient } from "../../client/AgoClient";
import type { AgoConversation } from "../../client/AgoConversation";
import type { AgoMessage, AgoUploadFile } from "../../client/types";
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
  sendMessage: (content: string, files?: AgoUploadFile[]) => Promise<AgoMessage | null>;
  /**
   * Stop the turn that is generating: closes the stream and tells the backend
   * to stop. The partial answer stays in the transcript as `CANCELED`. No-op
   * when nothing is generating. Wire it to a Stop button shown while
   * {@link isLoading} is true. Stops this hook's conversation only.
   */
  stop: () => Promise<void>;
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
  // Read by the event handlers, which must see an adopted id before React re-renders.
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  // This hook's own send: its optimistic assistant bubble, until a stream names it.
  const pendingPlaceholderRef = useRef<string | null>(null);
  // Real message id -> the optimistic bubble standing in for it.
  const placeholdersRef = useRef(new Map<string, string>());
  // The conversation this hook sends to, so Stop can name it before it has a server id.
  const conversationRef = useRef<AgoConversation | null>(null);

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
      // Hidden messages (e.g. auto-continuation nudges) stay in the model's
      // context but must never surface in the visible transcript.
      setMessages(loadedMessages.filter((m) => !m.hidden));
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load messages"));
    }
  };

  // Subscribe to message events
  useEffect(() => {
    // A paused entry (WAITING_CLIENT) is still the turn's streaming bubble: the
    // resumed stream re-targets it, so it counts as "streaming" everywhere below.
    const isStreamingStatus = (status: AgoMessage["status"]) =>
      status === "IN_PROGRESS" || status === "WAITING_CLIENT";

    // The client can run several conversations at once: another conversation's
    // events never touch this one.
    const isOther = (id: string | undefined) =>
      !!id && !!conversationIdRef.current && id !== conversationIdRef.current;

    // The entry of `messageId`: itself, or the optimistic bubble standing in for
    // it. Resolved when the event arrives: React runs the state updaters later.
    const finder = (messageId: string) => {
      const placeholder = messageId ? placeholdersRef.current.get(messageId) : undefined;
      return (prev: AgoMessage[]) => {
        const index = prev.findIndex((m) => m.id === messageId);
        if (index >= 0 || !placeholder) return index;
        return prev.findIndex((m) => m.id === placeholder);
      };
    };

    const handleMessageStart = (data: { conversationId: string; messageId: string }) => {
      if (isOther(data.conversationId)) return;
      // Update conversation ID if this is a new conversation
      if (!conversationIdRef.current) {
        conversationIdRef.current = data.conversationId;
        setConversationId(data.conversationId);
      }
      // This hook's own send keeps its optimistic bubble, now tied to the real id.
      const placeholder = pendingPlaceholderRef.current;
      if (placeholder) {
        pendingPlaceholderRef.current = null;
        placeholdersRef.current.set(data.messageId, placeholder);
      }
      // A stream can begin without going through this hook's `sendMessage`. The
      // hidden auto-continuation after navigation sends straight through the
      // client, so there's no optimistic assistant placeholder in that case. Add
      // one (keyed on the real messageId so `message:chunk` appends to it) and
      // flip `isLoading`, making the second turn visible as a streaming reply.
      setIsLoading(true);
      const indexOf = finder(data.messageId);
      setMessages((prev) => {
        // A resumed paused turn streams into the SAME assistant message: revive
        // the existing entry instead of appending a duplicate id (duplicate React
        // keys break the transcript rendering).
        const existingIndex = indexOf(prev);
        if (existingIndex >= 0) {
          return prev.map((m, i) =>
            i === existingIndex ? { ...m, status: "IN_PROGRESS" as const } : m
          );
        }
        return [
          ...prev,
          {
            id: data.messageId,
            conversationId: data.conversationId,
            content: "",
            role: "assistant",
            status: "IN_PROGRESS",
            createdAt: new Date(),
          },
        ];
      });
    };

    const handleMessageChunk = (data: {
      content: string;
      conversationId: string;
      messageId: string;
    }) => {
      if (isOther(data.conversationId)) return;
      // Append by id, wherever the entry sits. Optimistic `temp-` placeholders
      // never match a real messageId, so hook-initiated sends keep revealing
      // their text at answer-complete, exactly as before.
      setMessages((prev) => {
        const index = prev.findIndex((m) => m.id === data.messageId);
        if (index < 0) return prev;
        return prev.map((m, i) =>
          i === index ? { ...m, content: m.content + data.content } : m
        );
      });
    };

    const handleAnswerComplete = (message: AgoMessage) => {
      if (isOther(message.conversationId)) return;
      // Main answer text is done; follow-up replies may still be streaming. Reveal
      // the answer and flip its message to DONE (adopting the real id, so
      // message:complete updates the same entry), but keep `isLoading` so the
      // follow-up indicator stays until the stream closes.
      const indexOf = finder(message.id);
      setMessages((prev) => {
        const index = indexOf(prev);
        if (index < 0) return prev;
        return prev.map((m, i) => (i === index ? { ...m, ...message } : m));
      });
    };

    const handleMessageComplete = (message: AgoMessage) => {
      if (isOther(message.conversationId)) return;
      const indexOf = finder(message.id);
      setMessages((prev) => {
        // Replace the streaming message with the complete one
        const existingIndex = indexOf(prev);
        if (existingIndex >= 0) {
          return [...prev.slice(0, existingIndex), message, ...prev.slice(existingIndex + 1)];
        }
        return [...prev, message];
      });
      setIsLoading(false);
    };

    const handleMessageError = (data: { error: string; conversationId?: string }) => {
      if (isOther(data.conversationId)) return;
      setError(new Error(data.error));
      setIsLoading(false);
    };

    // The user stopped the turn. `message:complete` has usually already finalized
    // the bubble as CANCELED; this covers what it can't — a stop that landed
    // before the backend named the message, and a turn stopped while it was
    // paused on a client function (no stream is open then, so no completion
    // event follows). An empty bubble is dropped rather than left blank.
    const handleMessageStopped = (data: { conversationId: string; messageId: string }) => {
      if (isOther(data.conversationId)) return;
      const indexOf = finder(data.messageId);
      setMessages((prev) => {
        let index = indexOf(prev);
        // Stopped before the backend named the message: it can only be the
        // bubble still streaming.
        for (let i = prev.length - 1; !data.messageId && index < 0 && i >= 0; i--) {
          if (prev[i].role === "assistant" && isStreamingStatus(prev[i].status)) index = i;
        }
        if (index < 0 || !isStreamingStatus(prev[index].status)) return prev;
        if (!prev[index].content) {
          return prev.filter((_, i) => i !== index);
        }
        return prev.map((m, i) =>
          i === index ? { ...m, status: "CANCELED" as const } : m
        );
      });
      setIsLoading(false);
    };

    client.on("message:start", handleMessageStart);
    client.on("message:chunk", handleMessageChunk);
    client.on("message:answer-complete", handleAnswerComplete);
    client.on("message:complete", handleMessageComplete);
    client.on("message:error", handleMessageError);
    client.on("message:stopped", handleMessageStopped);

    return () => {
      client.off("message:start", handleMessageStart);
      client.off("message:chunk", handleMessageChunk);
      client.off("message:answer-complete", handleAnswerComplete);
      client.off("message:complete", handleMessageComplete);
      client.off("message:error", handleMessageError);
      client.off("message:stopped", handleMessageStopped);
    };
  }, [client]);

  const sendMessage = useCallback(
    async (content: string, files?: AgoUploadFile[]): Promise<AgoMessage | null> => {
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
      pendingPlaceholderRef.current = assistantMessage.id;

      try {
        // A new conversation is created here, not inside `sendMessage`, so Stop can
        // name it before the server does. Optional: test doubles may not have it.
        if (!conversationIdRef.current) conversationRef.current ??= client.conversation?.() ?? null;
        const response = await client.sendMessage(content, {
          conversationId: conversationIdRef.current ?? conversationRef.current?.id,
          files,
        });

        // Update conversation ID if new
        if (response.conversationId && !conversationIdRef.current) {
          conversationIdRef.current = response.conversationId;
          setConversationId(response.conversationId);
        }
        placeholdersRef.current.delete(response.id);

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
        if (pendingPlaceholderRef.current === assistantMessage.id) {
          pendingPlaceholderRef.current = null;
        }

        // Remove the optimistic messages on error
        setMessages((prev) => prev.filter((m) => !m.id.startsWith("temp-")));

        return null;
      }
    },
    [client, conversationId]
  );

  const stop = useCallback(async () => {
    // Named from the first send on: `client.stop()` without an id stops every conversation.
    await client.stop(conversationIdRef.current ?? conversationRef.current?.id);
  }, [client]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    conversationIdRef.current = undefined;
    conversationRef.current = null;
    setConversationId(undefined);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    stop,
    clearMessages,
    conversationId,
  };
}
