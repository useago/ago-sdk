import { useCallback, useEffect, useRef, useState } from "react";
import { beginBindingActivation, captureBindingPrincipal, invalidateBindingOwner, isBindingOwner, withBindingOwnership } from "../../client/bindingOwnership";
import { AgoError } from "../../client/errors";
import type { AgoClient } from "../../client/AgoClient";
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
   * {@link isLoading} is true.
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
export function useMessagesInternal({
  client: clientProp,
  conversationId: initialConversationId,
}: UseMessagesOptions = {}, onAcceptedComplete?: (message: AgoMessage) => void) {
  const completeCallback = useRef(onAcceptedComplete);
  completeCallback.current = onAcceptedComplete;
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
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const boundClient = useRef(client);
  const owner = useRef<symbol>();
  const viewEpoch = useRef(0);
  const pendingSend = useRef<{ token: symbol; epoch: number; retargeted: boolean }>();
  const preparing = useRef<symbol>();
  const resetPending = useRef(false);
  const selected = useRef<string | undefined>(initialConversationId);
  const visibility = useRef(new Map<string, boolean>());
  const snapshots = useRef(new Map<string, AgoMessage>());
  const latestMessages = useRef(messages);
  latestMessages.current = messages;
  const suspended = useRef(false);
  const [currentConversation, setCurrentConversation] = useState<import("../../client/types").Conversation | null>(null);
  const activate = useCallback(async (id: string | null) => {
    viewEpoch.current++;
    preparing.current = undefined;
    setIsPreparing(false);
    suspended.current = false;
    selected.current = id ?? undefined;
    visibility.current.clear();
    snapshots.current.clear();
    setConversationId(id ?? undefined);
    setMessages([]);
    setCurrentConversation(null);
    setError(null);
    setIsLoading(false);
    const { token, result } = beginBindingActivation(client, () => client.setActiveConversation(id));
    owner.current = token;
    try {
      const conversation = await result;
      if (!isBindingOwner(client, token)) return;
      setCurrentConversation(conversation);
      for (const message of conversation?.messages ?? []) {
        if (!visibility.current.has(message.id)) visibility.current.set(message.id, !!message.hidden);
      }
      setMessages((conversation?.messages ?? []).filter((m) => !m.hidden && !visibility.current.get(m.id)));
    } catch (err) {
      if (isBindingOwner(client, token) && !(err instanceof AgoError && err.code === "request_detached"))
        setError(err instanceof Error ? err : new Error("Failed to load messages"));
    }
  }, [client]);

  useEffect(() => {
    const epoch = viewEpoch;
    const currentVisibility = visibility;
    if (boundClient.current !== client) {
      boundClient.current = client;
      epoch.current++;
      selected.current = initialConversationId;
      visibility.current.clear();
      snapshots.current.clear();
      suspended.current = false;
      pendingSend.current = undefined;
      preparing.current = undefined;
      setIsPreparing(false);
      setMessages([]);
      setConversationId(initialConversationId);
      setCurrentConversation(null);
      setError(null);
      setIsLoading(false);
    }
    if (initialConversationId) void activate(initialConversationId);
    return () => {
      const token = owner.current;
      if (token && isBindingOwner(client, token)) {
        void withBindingOwnership(client, token, () => client.setActiveConversation(null)).catch(() => {});
      }
      epoch.current++;
      preparing.current = undefined;
      owner.current = undefined;
      currentVisibility.current.clear();
      suspended.current = false;
    };
  }, [activate, client, initialConversationId]);

  useEffect(() => {
    resetPending.current = false;
  });

  // Subscribe to message events
  useEffect(() => {
    // A paused entry (WAITING_CLIENT) is still the turn's streaming bubble: the
    // resumed stream re-targets it, so it counts as "streaming" everywhere below.
    const isStreamingStatus = (status: AgoMessage["status"]) =>
      status === "IN_PROGRESS" || status === "WAITING_CLIENT";

    const accepts = (id?: string, allowRetarget = false) => {
      if (owner.current && !isBindingOwner(client, owner.current)) return false;
      if (!id || selected.current === id) return true;
      const pending = pendingSend.current;
      if (!selected.current) {
        if (allowRetarget && pending && pending.epoch === viewEpoch.current && isBindingOwner(client, pending.token)) {
          selected.current = id;
          setConversationId(id);
        }
        return true;
      }
      if (!allowRetarget || !pending || pending.retargeted || pending.epoch !== viewEpoch.current || !isBindingOwner(client, pending.token)) return false;
      pending.retargeted = true;
      visibility.current.clear();
      snapshots.current.clear();
      selected.current = id;
      setConversationId(id);
      setCurrentConversation(null);
      setMessages((prev) => prev.filter((message) => message.id.startsWith("temp-") || message.conversationId === id));
      return true;
    };

    const handleMessageStart = (data: { conversationId: string; messageId: string }) => {
      if (!accepts(data.conversationId, true) || visibility.current.get(data.messageId)) return;
      // Update conversation ID if this is a new conversation
      if (!conversationId) {
        selected.current = data.conversationId;
        setConversationId(data.conversationId);
      }
      // A stream can begin without going through this hook's `sendMessage`. The
      // hidden auto-continuation after navigation sends straight through the
      // client, so there's no optimistic assistant placeholder in that case. Add
      // one (keyed on the real messageId so `message:chunk` appends to it) and
      // flip `isLoading`, making the second turn visible as a streaming reply.
      setIsLoading(true);
      setMessages((prev) => {
        // A resumed paused turn streams into the SAME assistant message: revive
        // the existing entry instead of appending a duplicate id (duplicate React
        // keys break the transcript rendering).
        const existingIndex = prev.findIndex((m) => m.id === data.messageId);
        if (existingIndex >= 0) {
          return prev.map((m, i) =>
            i === existingIndex ? { ...m, status: "IN_PROGRESS" as const } : m
          );
        }
        const alreadyStreaming = prev.some(
          (m) => m.role === "assistant" && isStreamingStatus(m.status)
        );
        if (alreadyStreaming) return prev;
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
      if (!accepts(data.conversationId) || visibility.current.get(data.messageId)) return;
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
      if (!accepts(message.conversationId)) return;
      if (!visibility.current.has(message.id)) visibility.current.set(message.id, !!message.hidden);
      if (message.hidden && !visibility.current.get(message.id)) return;
      if (visibility.current.get(message.id)) {
        setMessages((prev) => prev.filter((m) => m.id !== message.id && !m.id.startsWith("temp-assistant-")));
        return;
      }
      const snapshot = snapshots.current.get(message.id);
      if (snapshot && snapshot !== message && ["DONE", "ERROR", "CANCELED"].includes(snapshot.status)) return;
      // Main answer text is done; follow-up replies may still be streaming. Reveal
      // the answer and flip the streaming assistant message to DONE (adopting the
      // real id from the event so message:complete updates the same entry), but
      // keep `isLoading` so the follow-up indicator stays until the stream closes.
      setMessages((prev) => {
        let streamingIndex = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === "assistant" && isStreamingStatus(prev[i].status)) {
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
      if (!accepts(message.conversationId)) return;
      if (!visibility.current.has(message.id)) visibility.current.set(message.id, !!message.hidden);
      const hidden = visibility.current.get(message.id) === true;
      const snapshot = snapshots.current.get(message.id);
      if (message.hidden && !hidden) {
        if (snapshot && ["DONE", "ERROR", "CANCELED"].includes(snapshot.status)) setIsLoading(false);
        return;
      }
      if (snapshot && snapshot !== message && ["DONE", "ERROR", "CANCELED"].includes(snapshot.status)) message = snapshot;
      setMessages((prev) => {
        if (hidden) return prev.filter((m) => m.id !== message.id && !m.id.startsWith("temp-assistant-"));
        // Replace the streaming message with the complete one
        const existingIndex = prev.findIndex((m) => m.id === message.id);
        if (existingIndex >= 0) {
          return [...prev.slice(0, existingIndex), message, ...prev.slice(existingIndex + 1)];
        }
        return [...prev, message];
      });
      setIsLoading(false);
      if (!hidden && message.status === "DONE") completeCallback.current?.(message);
    };

    const handleMessageError = (data: { error: string; conversationId?: string }) => {
      if (!accepts(data.conversationId)) return;
      setError(new Error(data.error));
      setIsLoading(false);
    };

    // The user stopped the turn. `message:complete` has usually already finalized
    // the bubble as CANCELED; this covers what it can't — a stop that landed
    // before the backend named the message, and a turn stopped while it was
    // paused on a client function (no stream is open then, so no completion
    // event follows). An empty bubble is dropped rather than left blank.
    const handleMessageStopped = (data: { conversationId: string }) => {
      if (!accepts(data.conversationId)) return;
      setMessages((prev) => {
        let streamingIndex = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === "assistant" && isStreamingStatus(prev[i].status)) {
            streamingIndex = i;
            break;
          }
        }
        if (streamingIndex < 0) return prev;
        if (!prev[streamingIndex].content) {
          return prev.filter((_, i) => i !== streamingIndex);
        }
        return prev.map((m, i) =>
          i === streamingIndex ? { ...m, status: "CANCELED" as const } : m
        );
      });
      setIsLoading(false);
    };

    const handleUpdate = (message: AgoMessage) => {
      if (!accepts(message.conversationId, true)) return;
      const hidden = message.hidden ?? visibility.current.get(message.id) ?? false;
      visibility.current.set(message.id, hidden);
      snapshots.current.set(message.id, message);
      setMessages((prev) => {
        const index = prev.findIndex((m) => m.id === message.id);
        if (hidden) return prev.filter((m) => m.id !== message.id);
        if (index < 0) return [...prev, message];
        return prev.map((m, i) => i === index ? message : m);
      });
    };
    const handleConversationUpdate = (data: import("../../client/types").AgoClientEvents["conversation:update"]) => {
      if (data.conversationId === null) {
        viewEpoch.current++;
        resetPending.current = true;
        preparing.current = undefined;
        setIsPreparing(false);
        suspended.current = false;
        selected.current = undefined;
        visibility.current.clear();
        snapshots.current.clear();
        owner.current = undefined;
        setConversationId(undefined); setMessages([]); setCurrentConversation(null); setError(null); setIsLoading(false);
      } else if (accepts(data.conversationId, true) && data.conversationId === selected.current) {
        setCurrentConversation((prev) => prev && prev.id === data.conversationId ? { ...prev, interaction: data.interaction } : prev);
      }
    };
    client.on("message:update", handleUpdate);
    client.on("conversation:update", handleConversationUpdate);
    client.on("message:start", handleMessageStart);
    client.on("message:chunk", handleMessageChunk);
    client.on("message:answer-complete", handleAnswerComplete);
    client.on("message:complete", handleMessageComplete);
    client.on("message:error", handleMessageError);
    client.on("message:stopped", handleMessageStopped);

    return () => {
      client.off("message:update", handleUpdate);
      client.off("conversation:update", handleConversationUpdate);
      client.off("message:start", handleMessageStart);
      client.off("message:chunk", handleMessageChunk);
      client.off("message:answer-complete", handleAnswerComplete);
      client.off("message:complete", handleMessageComplete);
      client.off("message:error", handleMessageError);
      client.off("message:stopped", handleMessageStopped);
    };
  }, [client, conversationId]);

  const sendMessage = useCallback(
    async (content: string, files?: AgoUploadFile[]): Promise<AgoMessage | null> => {
      let token = owner.current;
      const epoch = viewEpoch.current;
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
        const send = () => client.sendMessage(content, { conversationId, files });
        let pending: Promise<AgoMessage>;
        if (token && isBindingOwner(client, token)) pending = withBindingOwnership(client, token, send);
        else {
          const activation = beginBindingActivation(client, send);
          token = activation.token; owner.current = token; pending = activation.result;
        }
        pendingSend.current = { token, epoch, retargeted: false };
        const response = await pending;
        if ((token && !isBindingOwner(client, token)) || viewEpoch.current !== epoch) return null;

        const retargeted = !!response.conversationId && response.conversationId !== selected.current;
        if (retargeted) {
          visibility.current.clear();
          snapshots.current.clear();
          selected.current = response.conversationId;
          setConversationId(response.conversationId);
          setCurrentConversation(null);
        }

        if (response.status === "DONE" || response.status === "ERROR" || response.status === "CANCELED") {
          setIsLoading(false);
        }

        if (!visibility.current.has(response.id)) visibility.current.set(response.id, !!response.hidden);
        const hidden = visibility.current.get(response.id) === true;

        // Replace temp messages with real ones.
        // The handleMessageComplete callback may also fire — it uses findIndex
        // by message.id so it will simply update the same entry (no duplicate).
        setMessages((prev) => {
          const filtered = prev.filter(
            (m) => !m.id.startsWith("temp-") && (!retargeted || m.conversationId === response.conversationId)
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

          return hidden || response.hidden ? [...filtered, updatedUserMessage] : [...filtered, updatedUserMessage, response];
        });

        return response;
      } catch (err) {
        if ((token && !isBindingOwner(client, token)) || viewEpoch.current !== epoch) return null;
        if (err instanceof AgoError && err.code === "request_detached") {
          setIsLoading(false);
          setMessages((prev) => prev.filter((m) => !m.id.startsWith("temp-")));
          return null;
        }
        setError(err instanceof Error ? err : new Error("Failed to send message"));
        setIsLoading(false);

        // Remove the optimistic messages on error
        setMessages((prev) => prev.filter((m) => !m.id.startsWith("temp-")));

        return null;
      } finally {
        if (pendingSend.current?.token === token && pendingSend.current?.epoch === epoch) pendingSend.current = undefined;
      }
    },
    [client, conversationId]
  );

  const suspendObservation = useCallback((isPreMessage = false) => {
    const token = owner.current;
    const last = [...latestMessages.current].reverse().find((message) => message.role === "assistant");
    if (suspended.current || !token || !isBindingOwner(client, token) || pendingSend.current || preparing.current || client.isGenerating() || !selected.current || (!isPreMessage && (!last || !["TODO", "IN_PROGRESS", "WAITING_APPROVAL", "PAUSED"].includes(last.status)))) return;
    viewEpoch.current++;
    suspended.current = true;
    void withBindingOwnership(client, token, () => client.setActiveConversation(null)).catch(() => {});
  }, [client]);

  const resumeObservation = useCallback(() => {
    const id = selected.current;
    const previous = owner.current;
    if (!suspended.current || !id || !previous || !isBindingOwner(client, previous)) return;
    suspended.current = false;
    visibility.current.clear();
    snapshots.current.clear();
    const epoch = ++viewEpoch.current;
    const activation = beginBindingActivation(client, () => client.setActiveConversation(id));
    owner.current = activation.token;
    void activation.result.then((conversation) => {
      if (viewEpoch.current !== epoch || !isBindingOwner(client, activation.token)) return;
      setCurrentConversation(conversation);
      for (const message of conversation?.messages ?? []) {
        if (!visibility.current.has(message.id)) visibility.current.set(message.id, !!message.hidden);
      }
      const restored = (conversation?.messages ?? []).filter((message) => !message.hidden && !visibility.current.get(message.id));
      setMessages(restored);
      const lastAssistant = [...restored].reverse().find((message) => message.role === "assistant");
      if ((!lastAssistant && conversation?.interaction?.canSendMessage !== false) || (lastAssistant && ["DONE", "ERROR", "CANCELED"].includes(lastAssistant.status))) setIsLoading(false);
    }).catch((err: unknown) => {
      if (viewEpoch.current === epoch && isBindingOwner(client, activation.token) && !(err instanceof AgoError && err.code === "request_detached")) setError(err instanceof Error ? err : new Error("Failed to load messages"));
    });
  }, [client]);

  const prepareSend = useCallback(() => {
    if (preparing.current || resetPending.current || boundClient.current !== client || selected.current !== conversationId) return null;
    const guard = captureBindingPrincipal(client);
    let token = owner.current;
    let acquired = false;
    if (!token || !isBindingOwner(client, token)) {
      const activation = beginBindingActivation(client, () => Promise.resolve());
      token = activation.token;
      owner.current = token;
      acquired = true;
    }
    const epoch = viewEpoch.current;
    const attempt = Symbol();
    preparing.current = attempt;
    setIsPreparing(true);
    return {
      run: guard,
      finish: () => {
        if (preparing.current === attempt) {
          preparing.current = undefined;
          setIsPreparing(false);
        }
      },
      isCurrent: () => boundClient.current === client && viewEpoch.current === epoch && isBindingOwner(client, token),
      release: () => {
        if (acquired && isBindingOwner(client, token)) {
          invalidateBindingOwner(client);
          if (owner.current === token) owner.current = undefined;
        }
      },
    };
  }, [client, conversationId]);

  const stop = useCallback(async () => {
    await client.stop();
  }, [client]);

  const clearMessages = useCallback(() => {
    void activate(null);
  }, [activate]);

  return {
    messages: boundClient.current === client ? messages : [],
    isLoading: boundClient.current === client ? isLoading : false,
    isPreparing: boundClient.current === client ? isPreparing : false,
    error: boundClient.current === client ? error : null,
    sendMessage,
    stop,
    clearMessages,
    conversationId: boundClient.current === client ? conversationId : initialConversationId,
    currentConversation: boundClient.current === client ? currentConversation : null,
    activate,
    suspendObservation,
    resumeObservation,
    prepareSend,
  };
}

export function useMessages(options: UseMessagesOptions = {}): UseMessagesResult {
  return useMessagesInternal(options);
}
