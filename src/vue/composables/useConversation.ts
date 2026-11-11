import { ref, onMounted, onUnmounted } from "vue";
import { beginBindingActivation, isBindingOwner, withBindingOwnership } from "../../client/bindingOwnership";
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
export function useConversationInternal(options: UseConversationOptions = {}, manageActivation = true) {
  const client = options.client ?? useAgo();
  const autoLoad = options.autoLoad ?? true;

  const conversations = ref<Conversation[]>([]);
  const currentConversation = ref<Conversation | null>(null);
  const isLoading = ref(false);
  const error = ref<Error | null>(null);

  let owner: symbol | undefined;
  let generation = 0;
  const reset = (data: import("../../client/types").AgoClientEvents["conversation:update"]) => {
    if (data.conversationId === null) {
      generation++; owner = undefined; conversations.value = []; currentConversation.value = null;
      error.value = null; isLoading.value = false;
    } else if (currentConversation.value?.id === data.conversationId) {
      currentConversation.value = { ...currentConversation.value, interaction: data.interaction };
    }
  };
  async function refreshConversations() {
    const epoch = generation;
    isLoading.value = true;
    error.value = null;
    try {
      const data = (await client.getConversations()).data;
      if (epoch === generation) conversations.value = data;
    } catch (err) {
      if (epoch === generation) error.value = err instanceof Error ? err : new Error("Failed to load conversations");
    } finally {
      if (epoch === generation) isLoading.value = false;
    }
  }

  async function selectConversation(id: string) {
    isLoading.value = true;
    error.value = null;
    const activation = beginBindingActivation(client, () => client.setActiveConversation(id));
    owner = activation.token;
    try {
      const conversation = await activation.result;
      if (isBindingOwner(client, activation.token)) currentConversation.value = conversation;
    } catch (err) {
      if (isBindingOwner(client, activation.token) && !(err instanceof AgoError && err.code === "request_detached"))
        error.value = err instanceof Error ? err : new Error("Failed to load conversation");
    } finally {
      if (isBindingOwner(client, activation.token)) isLoading.value = false;
    }
  }

  function startNewConversation() {
    currentConversation.value = null;
    if (manageActivation) {
      const activation = beginBindingActivation(client, () => client.setActiveConversation(null));
      owner = activation.token; void activation.result.catch(() => {});
    }
  }

  onMounted(() => {
    client.on("conversation:update", reset);
    if (autoLoad) refreshConversations();
  });

  onUnmounted(() => {
    generation++;
    client.off("conversation:update", reset);
    if (owner && isBindingOwner(client, owner)) void withBindingOwnership(client, owner, () => client.setActiveConversation(null)).catch(() => {});
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

export function useConversation(options: UseConversationOptions = {}) {
  return useConversationInternal(options);
}
