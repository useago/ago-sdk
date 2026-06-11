import { ref, onMounted, onUnmounted } from "vue";
import type { AgoClient } from "../../client/AgoClient";
import type { AgoMessage } from "../../client/types";
import { useAgo } from "./useAgo";

export interface UseMessagesOptions {
  client?: AgoClient;
  conversationId?: string;
}

/**
 * Composable to manage messages in a conversation.
 *
 * ```ts
 * const { messages, sendMessage, isLoading } = useMessages();
 * ```
 */
export function useMessages(options: UseMessagesOptions = {}) {
  const client = options.client ?? useAgo();

  const messages = ref<AgoMessage[]>([]);
  const conversationId = ref<string | undefined>(options.conversationId);
  const isLoading = ref(false);
  const error = ref<Error | null>(null);

  const handleStart = (data: { conversationId: string; messageId: string }) => {
    if (!conversationId.value) {
      conversationId.value = data.conversationId;
    }
  };

  const handleChunk = (data: { content: string; messageId: string }) => {
    const idx = messages.value.findIndex((m: AgoMessage) => m.id === data.messageId);
    if (idx >= 0) {
      messages.value[idx] = {
        ...messages.value[idx],
        content: messages.value[idx].content + data.content,
      };
    }
  };

  const handleComplete = (message: AgoMessage) => {
    const idx = messages.value.findIndex((m: AgoMessage) => m.id === message.id);
    if (idx >= 0) {
      messages.value[idx] = message;
    } else {
      messages.value.push(message);
    }
    isLoading.value = false;
  };

  const handleError = (data: { error: string }) => {
    error.value = new Error(data.error);
    isLoading.value = false;
  };

  onMounted(() => {
    client.on("message:start", handleStart);
    client.on("message:chunk", handleChunk);
    client.on("message:complete", handleComplete);
    client.on("message:error", handleError);
  });

  onUnmounted(() => {
    client.off("message:start", handleStart);
    client.off("message:chunk", handleChunk);
    client.off("message:complete", handleComplete);
    client.off("message:error", handleError);
  });

  async function sendMessage(content: string, files?: File[]): Promise<AgoMessage | null> {
    isLoading.value = true;
    error.value = null;

    // Optimistic user message
    const userMsg: AgoMessage = {
      id: `temp-${Date.now()}`,
      conversationId: conversationId.value || "",
      content,
      role: "user",
      status: "DONE",
      createdAt: new Date(),
    };
    const assistantMsg: AgoMessage = {
      id: `temp-assistant-${Date.now()}`,
      conversationId: conversationId.value || "",
      content: "",
      role: "assistant",
      status: "IN_PROGRESS",
      createdAt: new Date(),
    };
    messages.value.push(userMsg, assistantMsg);

    try {
      const response = await client.sendMessage(content, {
        conversationId: conversationId.value,
        files,
      });
      if (response.conversationId && !conversationId.value) {
        conversationId.value = response.conversationId;
      }
      // Replace temp messages
      messages.value = messages.value.filter((m: AgoMessage) => !m.id.startsWith("temp-"));
      const updatedUser = { ...userMsg, id: userMsg.id.replace("temp-", "user-"), conversationId: response.conversationId };
      if (!messages.value.some((m: AgoMessage) => m.id === response.id)) {
        messages.value.push(updatedUser, response);
      } else {
        messages.value.push(updatedUser);
      }
      return response;
    } catch (err) {
      error.value = err instanceof Error ? err : new Error("Failed to send");
      isLoading.value = false;
      messages.value = messages.value.filter((m: AgoMessage) => !m.id.startsWith("temp-"));
      return null;
    }
  }

  function clearMessages() {
    messages.value = [];
    conversationId.value = undefined;
    error.value = null;
  }

  return { messages, isLoading, error, conversationId, sendMessage, clearMessages };
}
