import { ref, onMounted } from "vue";
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

  async function refreshConversations() {
    isLoading.value = true;
    error.value = null;
    try {
      conversations.value = await client.getConversations();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error("Failed to load conversations");
    } finally {
      isLoading.value = false;
    }
  }

  async function selectConversation(id: string) {
    isLoading.value = true;
    error.value = null;
    try {
      currentConversation.value = await client.getConversation(id);
    } catch (err) {
      error.value = err instanceof Error ? err : new Error("Failed to load conversation");
    } finally {
      isLoading.value = false;
    }
  }

  function startNewConversation() {
    currentConversation.value = null;
  }

  onMounted(() => {
    if (autoLoad) refreshConversations();
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
