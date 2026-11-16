import { ref, onMounted, onUnmounted } from "vue";
import type { BindingHandle } from "../../client/bindingOwnership";
import { AgoError } from "../../client/errors";
import type { AgoClient } from "../../client/AgoClient";
import type { AgoMessage, AgoUploadFile, Conversation } from "../../client/types";
import { useAgo } from "./useAgo";

export interface UseMessagesOptions {
  client?: AgoClient;
  conversationId?: string;
}

/** Manage the selected conversation using its shared message state. */
export function useMessagesInternal(options: UseMessagesOptions = {}) {
  const client = options.client ?? useAgo();
  const messages = ref<AgoMessage[]>([]);
  const conversationId = ref<string | undefined>(options.conversationId);
  const isLoading = ref(false);
  const isHistoryLoading = ref(false);
  const error = ref<Error | null>(null);
  const currentConversation = ref<Conversation | null>(null);
  let conversation = client.conversation(options.conversationId);
  let unsubscribe: (() => void) | undefined;
  let offFork: (() => void) | undefined;
  let pendingSend: { conversation: typeof conversation; viewGeneration: number } | undefined;
  let owner: BindingHandle | undefined;
  let viewGeneration = 0;
  function update() {
    const snapshot = conversation.getSnapshot();
    messages.value = snapshot.messages.filter((message) => !message.hidden);
    conversationId.value = snapshot.isDraft ? undefined : snapshot.id;
    isLoading.value = snapshot.isGenerating;
    isHistoryLoading.value = snapshot.isLoading;
    if (snapshot.error) error.value = snapshot.error;
    if (currentConversation.value?.id === snapshot.id) {
      currentConversation.value = { ...currentConversation.value, interaction: snapshot.interaction ?? undefined };
    }
  }
  function subscribe() {
    unsubscribe = conversation.subscribe(update);
    const source = conversation;
    offFork = source._subscribeToFork((id) => {
      if (pendingSend?.conversation !== source || pendingSend.viewGeneration !== viewGeneration || !owner || !owner.isCurrent()) return;
      unsubscribe?.();
      offFork?.();
      conversation = client.conversation(id);
      currentConversation.value = null;
      update();
      subscribe();
    });
  }
  async function activate(id: string | null) {
    ++viewGeneration;
    unsubscribe?.();
    offFork?.();
    conversation = client.conversation(id ?? undefined);
    currentConversation.value = null;
    error.value = null;
    update();
    subscribe();
    const activation = client._bindConversation();
    activation.select(id ?? conversation.id);
    owner = activation;
    if (!id) return;
    try {
      const loaded = await conversation.load();
      if (activation.isCurrent()) currentConversation.value = loaded;
    } catch (err) {
      if (activation.isCurrent() && !(err instanceof AgoError && err.code === "request_detached")) {
        error.value = err instanceof Error ? err : new Error("Failed to load messages");
      }
    }
  }
  const reset = (data: import("../../client/types").AgoClientEvents["conversation:update"]) => {
    if (data.conversationId !== null) return;
    viewGeneration++;
    owner = undefined;
    unsubscribe?.();
    offFork?.();
    conversation = client.conversation();
    currentConversation.value = null;
    error.value = null;
    update();
    subscribe();
  };
  onMounted(() => {
    client.on("conversation:update", reset);
    void activate(options.conversationId ?? null);
  });
  onUnmounted(() => {
    viewGeneration++;
    client.off("conversation:update", reset);
    unsubscribe?.();
    offFork?.();
    if (owner && owner.isCurrent()) owner.detach();
    owner = undefined;
  });
  async function sendMessage(content: string, files?: AgoUploadFile[]): Promise<AgoMessage | null> {
    const selected = conversation;
    const generation = viewGeneration;
    error.value = null;
    pendingSend = { conversation: selected, viewGeneration: generation };
    try {
      const result = await selected.sendMessage(content, { files });
      return generation === viewGeneration ? result : null;
    } catch (err) {
      if (generation === viewGeneration && selected === conversation && !(err instanceof AgoError && err.code === "request_detached")) {
        error.value = err instanceof Error ? err : new Error("Failed to send");
      }
      return null;
    } finally {
      if (pendingSend?.conversation === selected && pendingSend.viewGeneration === generation) pendingSend = undefined;
    }
  }
  async function stop(): Promise<void> {
    await conversation.stop();
  }
  function clearMessages() {
    void activate(null);
  }
  return {
    messages, isLoading, isHistoryLoading, error, conversationId,
    sendMessage, stop, clearMessages, activate, currentConversation,
  };
}

/**
 * Observe and send messages in the selected conversation from a Vue view.
 * `stop` ends the generating turn unless interaction state blocks sending.
 *
 * ```ts
 * const { messages, sendMessage, stop } = useMessages();
 * ```
 */
export function useMessages(options: UseMessagesOptions = {}) {
  const { messages, isLoading, error, conversationId, sendMessage, stop, clearMessages } = useMessagesInternal(options);
  return { messages, isLoading, error, conversationId, sendMessage, stop, clearMessages };
}
