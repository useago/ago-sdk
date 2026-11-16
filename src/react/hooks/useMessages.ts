import { useCallback, useEffect, useRef, useState } from "react";
import type { BindingHandle } from "../../client/bindingOwnership";
import { AgoError } from "../../client/errors";
import type { AgoClient } from "../../client/AgoClient";
import type { AgoMessage, AgoUploadFile, Conversation } from "../../client/types";
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
   * when nothing is generating or interaction state blocks sending. Wire it to a Stop button shown while
   * {@link isLoading} is true. Stops this conversation only once it has an id.
   */
  stop: () => Promise<void>;
  /** Clear messages */
  clearMessages: () => void;
  /** Current conversation ID */
  conversationId: string | undefined;
}

/** Manage the selected conversation using its shared message state. */
export function useMessagesInternal(
  { client: clientProp, conversationId: initialConversationId, observeBackground = true }: UseMessagesOptions & { observeBackground?: boolean } = {},
  onAcceptedComplete?: (message: AgoMessage) => void,
) {
  const contextClient = useOptionalAgoClient();
  const client = clientProp || contextClient;
  if (!client) {
    throw new Error("useMessages requires an AgoClient. Either pass it as options.client or wrap your app in <AgoProvider>.");
  }
  const boundClient = useRef(client);
  const isCurrentClient = boundClient.current === client;
  const resetPending = useRef(false);
  const complete = useRef(onAcceptedComplete);
  complete.current = onAcceptedComplete;
  const [conversation, setConversation] = useState(() => client.conversation(initialConversationId));
  const [conversationClient, setConversationClient] = useState(client);
  const [appliedConversationId, setAppliedConversationId] = useState(initialConversationId);
  const [snapshotState, setSnapshotState] = useState(() => ({ conversation, value: conversation.getSnapshot() }));
  const snapshot = snapshotState.value;
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const owner = useRef<BindingHandle>();
  const viewGeneration = useRef(0);
  const current = useRef(conversation);
  current.current = conversation;
  const observation = useRef(observeBackground);
  observation.current = observeBackground;
  const preparing = useRef<symbol>();
  const pendingSend = useRef<{ conversation: typeof conversation; viewGeneration: number }>();

  const activate = useCallback(async (id: string | null) => {
    const generation = ++viewGeneration.current;
    preparing.current = undefined;
    setIsPreparing(false);
    setLoadError(null);
    setCurrentConversation(null);
    const next = client.conversation(id ?? undefined);
    current.current = next;
    setConversationClient(client);
    setConversation(next);
    setSnapshotState({ conversation: next, value: next.getSnapshot() });
    const token = client._bindConversation();
    token.setBackgroundObservation(observation.current);
    token.select(id ?? next.id);
    owner.current = token;
    if (!id) return;
    try {
      const loaded = await next.load();
      if (viewGeneration.current === generation && token.isCurrent()) setCurrentConversation(loaded);
    } catch (err) {
      if (viewGeneration.current === generation && token.isCurrent() && !(err instanceof AgoError && err.code === "request_detached")) {
        setLoadError(err instanceof Error ? err : new Error("Failed to load messages"));
      }
    }
  }, [client]);

  useEffect(() => {
    boundClient.current = client;
    resetPending.current = false;
    setAppliedConversationId(initialConversationId);
    const viewGenerationRef = viewGeneration;
    void activate(initialConversationId ?? null);
    return () => {
      viewGenerationRef.current++;
      const token = owner.current;
      if (token && token.isCurrent()) token.detach();
      owner.current = undefined;
      preparing.current = undefined;
    };
  }, [activate, client, initialConversationId]);

  useEffect(() => {
    setSnapshotState({ conversation, value: conversation.getSnapshot() });
    const unsubscribe = conversation.subscribe(() => setSnapshotState({ conversation, value: conversation.getSnapshot() }));
    const offFork = conversation._subscribeToFork((id) => {
      if (
        pendingSend.current?.conversation !== conversation || pendingSend.current.viewGeneration !== viewGeneration.current ||
        !owner.current || !owner.current.isCurrent()
      ) return;
      const target = client.conversation(id);
      current.current = target;
      setConversation(target);
      setSnapshotState({ conversation: target, value: target.getSnapshot() });
      setCurrentConversation(null);
    });
    const onComplete = (message: AgoMessage) => {
      if (
        (!owner.current || owner.current.isCurrent()) && message.conversationId === current.current.id &&
        !message.hidden && message.status === "DONE"
      ) complete.current?.(message);
    };
    client.on("message:complete", onComplete);
    return () => {
      unsubscribe();
      offFork();
      client.off("message:complete", onComplete);
    };
  }, [client, conversation]);

  useEffect(() => {
    const reset = (data: import("../../client/types").AgoClientEvents["conversation:update"]) => {
      if (data.conversationId !== null) return;
      ++viewGeneration.current;
      resetPending.current = true;
      owner.current = undefined;
      preparing.current = undefined;
      const draft = client.conversation();
      current.current = draft;
      setConversation(draft);
      setSnapshotState({ conversation: draft, value: draft.getSnapshot() });
      setCurrentConversation(null);
      setLoadError(null);
      setIsPreparing(false);
    };
    client.on("conversation:update", reset);
    return () => client.off("conversation:update", reset);
  }, [client]);

  const sendMessage = useCallback(async (content: string, files?: AgoUploadFile[]): Promise<AgoMessage | null> => {
    const selected = current.current;
    const generation = viewGeneration.current;
    setLoadError(null);
    pendingSend.current = { conversation: selected, viewGeneration: generation };
    try {
      const response = await selected.sendMessage(content, { files });
      return generation === viewGeneration.current ? response : null;
    } catch (err) {
      if (generation === viewGeneration.current && current.current === selected && !(err instanceof AgoError && err.code === "request_detached")) {
        setLoadError(err instanceof Error ? err : new Error("Failed to send message"));
      }
      return null;
    } finally {
      if (pendingSend.current?.conversation === selected && pendingSend.current.viewGeneration === generation) pendingSend.current = undefined;
    }
  }, []);
  const stop = useCallback(async () => {
    await current.current.stop();
  }, []);
  const clearMessages = useCallback(() => {
    void activate(null);
  }, [activate]);
  useEffect(() => {
    const token = owner.current;
    if (!token?.isCurrent()) return;
    token.setBackgroundObservation(observeBackground);
    if (!observeBackground) return;
    const selected = current.current;
    const state = selected.getSnapshot();
    if (state.isDraft || state.isGenerating || state.interaction?.canSendMessage !== false) return;
    const capturedViewGeneration = viewGeneration.current;
    void selected.load().then((loaded) => {
      if (viewGeneration.current === capturedViewGeneration && current.current === selected && token.isCurrent()) setCurrentConversation(loaded);
    }).catch((error: unknown) => {
      if (viewGeneration.current === capturedViewGeneration && token.isCurrent() && !(error instanceof AgoError && error.code === "request_detached")) {
        setLoadError(error instanceof Error ? error : new Error("Failed to load messages"));
      }
    });
  }, [observeBackground, conversation]);
  useEffect(() => { resetPending.current = false; });
  const hasSnapshot = isCurrentClient && conversationClient === client &&
    appliedConversationId === initialConversationId && snapshotState.conversation === conversation;
  /** Send from the widget, discarding a draft invalidated by the host callback. */
  const _sendFromWidget = useCallback(async (
    content: string,
    files: AgoUploadFile[] | undefined,
    onMessageSent: ((content: string) => void) | undefined,
    isBlocked: () => boolean,
  ): Promise<boolean> => {
    if (!hasSnapshot || preparing.current || resetPending.current || boundClient.current !== client) return true;
    let token = owner.current;
    let acquired = false;
    if (!token || !token.isCurrent()) {
      token = client._bindConversation();
      owner.current = token;
      token.setBackgroundObservation(observation.current);
      acquired = true;
    }
    const generation = viewGeneration.current;
    const attempt = Symbol();
    preparing.current = attempt;
    setIsPreparing(true);
    const run = token.captureOperation();
    let started = false;
    const finish = () => {
      if (preparing.current === attempt) {
        preparing.current = undefined;
        setIsPreparing(false);
      }
    };
    try {
      onMessageSent?.(content);
      try {
        return await run(() => {
          if (viewGeneration.current !== generation || !token.isCurrent()) return true;
          if (isBlocked()) return false;
          finish();
          started = true;
          return sendMessage(content, files).then((result) => result !== null);
        });
      } catch (error) {
        return error instanceof AgoError && error.code === "request_detached";
      }
    } finally {
      finish();
      if (!started && acquired && token.isCurrent()) {
        token.release();
        if (owner.current === token) owner.current = undefined;
      }
    }
  }, [client, hasSnapshot, sendMessage]);
  return {
    // Hidden continuations can carry activity without belonging in the transcript.
    messages: hasSnapshot ? snapshot.messages.filter((message) => !message.hidden) : [],
    isLoading: hasSnapshot && snapshot.isGenerating,
    isHistoryLoading: hasSnapshot && snapshot.isLoading,
    isPreparing: hasSnapshot && isPreparing,
    error: hasSnapshot ? loadError || snapshot.error : null,
    sendMessage,
    stop,
    clearMessages,
    conversationId: hasSnapshot ? (snapshot.isDraft ? undefined : snapshot.id) : initialConversationId,
    currentConversation: hasSnapshot && currentConversation && currentConversation.id === snapshot.id
      ? { ...currentConversation, interaction: snapshot.interaction ?? undefined }
      : null,
    activate,
    _sendFromWidget,
  };
}

/** Observe and send messages in the selected conversation from a React view. */
export function useMessages(options: UseMessagesOptions = {}): UseMessagesResult {
  return useMessagesInternal(options);
}
