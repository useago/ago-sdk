import { ref, onMounted, onUnmounted } from "vue";
import type { BindingHandle } from "../../client/bindingOwnership";
import { AgoError } from "../../client/errors";
import type { AgoClient } from "../../client/AgoClient";
import type { Conversation } from "../../client/types";
import { useAgo } from "./useAgo";

export interface UseConversationOptions {
  client?: AgoClient;
  autoLoad?: boolean;
}

/**
 * Composable to manage conversations.
 *
 * ```ts
 * const { conversations, selectConversation } = useConversation();
 * ```
 */
export function useConversation(options: UseConversationOptions = {}) {
  const client = options.client ?? useAgo();
  const autoLoad = options.autoLoad ?? true;

  const conversations = ref<Conversation[]>([]);
  const currentConversation = ref<Conversation | null>(null);
  const isLoading = ref(false);
  const error = ref<Error | null>(null);

  let owner: BindingHandle | undefined;
  let generation = 0;
  const reset = (data: import("../../client/types").AgoClientEvents["conversation:update"]) => {
    if (data.conversationId === null) {
      generation++;
      owner = undefined;
      conversations.value = [];
      currentConversation.value = null;
      error.value = null;
      isLoading.value = false;
    } else if (currentConversation.value?.id === data.conversationId) {
      currentConversation.value = { ...currentConversation.value, interaction: data.interaction };
    }
  };
  async function refreshConversations() {
    const capturedGeneration = generation;
    isLoading.value = true;
    error.value = null;
    try {
      const data = (await client.getConversations()).data;
      if (capturedGeneration === generation) conversations.value = data;
    } catch (err) {
      if (capturedGeneration === generation) error.value = err instanceof Error ? err : new Error("Failed to load conversations");
    } finally {
      if (capturedGeneration === generation) isLoading.value = false;
    }
  }

  async function selectConversation(id: string) {
    isLoading.value = true;
    error.value = null;
    const activation = client._bindConversation();
    activation.select(id);
    owner = activation;
    try {
      const conversation = await client.conversation(id).load();
      if (activation.isCurrent()) currentConversation.value = conversation;
    } catch (err) {
      if (activation.isCurrent() && !(err instanceof AgoError && err.code === "request_detached"))
        error.value = err instanceof Error ? err : new Error("Failed to load conversation");
    } finally {
      if (owner === activation) isLoading.value = false;
    }
  }

  function startNewConversation() {
    currentConversation.value = null;
    isLoading.value = false;
    error.value = null;
    const activation = client._bindConversation();
    activation.select(null);
    owner = activation;
  }

  onMounted(() => {
    client.on("conversation:update", reset);
    if (autoLoad) refreshConversations();
  });

  onUnmounted(() => {
    generation++;
    client.off("conversation:update", reset);
    if (owner && owner.isCurrent()) owner.detach();
    owner = undefined;
  });

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
