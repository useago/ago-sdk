import { ref, onMounted, onUnmounted } from "vue";
import { beginBindingActivation, isBindingOwner, withBindingOwnership } from "../../client/bindingOwnership";
import { AgoError } from "../../client/errors";
import type { AgoClient } from "../../client/AgoClient";
import type { AgoMessage, AgoUploadFile } from "../../client/types";
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
export function useMessagesInternal(options: UseMessagesOptions = {}) {
  const client = options.client ?? useAgo();

  const messages = ref<AgoMessage[]>([]);
  const conversationId = ref<string | undefined>(options.conversationId);
  const isLoading = ref(false);
  const error = ref<Error | null>(null);

  const currentConversation = ref<import("../../client/types").Conversation | null>(null);
  let owner: symbol | undefined;
  let viewEpoch = 0;
  let pendingSend: { token: symbol; epoch: number; retargeted: boolean } | undefined;
  let selected = options.conversationId;
  async function activate(id: string | null) {
    viewEpoch++;
    selected = id ?? undefined;
    conversationId.value = selected;
    messages.value = [];
    currentConversation.value = null;
    error.value = null;
    isLoading.value = false;
    const activation = beginBindingActivation(client, () => client.setActiveConversation(id));
    owner = activation.token;
    try {
      const conversation = await activation.result;
      if (!isBindingOwner(client, activation.token)) return;
      currentConversation.value = conversation;
      messages.value = (conversation?.messages ?? []).filter((m) => !m.hidden);
    } catch (err) {
      if (isBindingOwner(client, activation.token) && !(err instanceof AgoError && err.code === "request_detached"))
        error.value = err instanceof Error ? err : new Error("Failed to load messages");
    }
  }
  const accepts = (id?: string, allowRetarget = false) => {
    if (owner && !isBindingOwner(client, owner)) return false;
    if (!id || !selected || selected === id) return true;
    if (!allowRetarget || !pendingSend || pendingSend.retargeted || pendingSend.epoch !== viewEpoch || !isBindingOwner(client, pendingSend.token)) return false;
    pendingSend.retargeted = true;
    selected = id;
    conversationId.value = id;
    currentConversation.value = null;
    messages.value = messages.value.filter((message) => message.id.startsWith("temp-") || message.conversationId === id);
    return true;
  };
  const handleUpdate = (message: AgoMessage) => {
    if (!accepts(message.conversationId, true)) return;
    const idx = messages.value.findIndex((m) => m.id === message.id);
    if (message.hidden) messages.value = messages.value.filter((m) => m.id !== message.id);
    else if (idx < 0) messages.value.push(message);
    else messages.value[idx] = message;
  };
  const handleConversationUpdate = (data: import("../../client/types").AgoClientEvents["conversation:update"]) => {
    if (data.conversationId === null) {
      viewEpoch++; owner = undefined; selected = undefined; conversationId.value = undefined;
      messages.value = []; currentConversation.value = null; error.value = null; isLoading.value = false;
    } else if (accepts(data.conversationId, true) && currentConversation.value?.id === data.conversationId) {
      currentConversation.value = { ...currentConversation.value, interaction: data.interaction };
    }
  };

  const handleStart = (data: { conversationId: string; messageId: string }) => {
    if (!accepts(data.conversationId, true)) return;
    if (!conversationId.value) {
      selected = data.conversationId;
      conversationId.value = data.conversationId;
    }
  };

  const handleChunk = (data: { content: string; messageId: string; conversationId: string }) => {
    if (!accepts(data.conversationId)) return;
    const idx = messages.value.findIndex((m: AgoMessage) => m.id === data.messageId);
    if (idx >= 0) {
      messages.value[idx] = {
        ...messages.value[idx],
        content: messages.value[idx].content + data.content,
      };
    }
  };

  const handleComplete = (message: AgoMessage) => {
    if (!accepts(message.conversationId)) return;
    const idx = messages.value.findIndex((m: AgoMessage) => m.id === message.id);
    if (idx >= 0) {
      messages.value[idx] = message;
    } else {
      messages.value.push(message);
    }
    isLoading.value = false;
  };

  const handleError = (data: { error: string; conversationId?: string }) => {
    if (!accepts(data.conversationId)) return;
    error.value = new Error(data.error);
    isLoading.value = false;
  };

  // The user stopped the turn. `message:complete` has usually already finalized
  // the bubble as CANCELED; this covers what it can't — a stop that landed
  // before the backend named the message, and a turn stopped while it was paused
  // on a client function (no stream is open then, so no completion follows).
  const handleStopped = (data: { conversationId: string }) => {
    if (!accepts(data.conversationId)) return;
    let idx = -1;
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const m: AgoMessage = messages.value[i];
      if (
        m.role === "assistant" &&
        (m.status === "IN_PROGRESS" || m.status === "WAITING_CLIENT")
      ) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      if (messages.value[idx].content) {
        messages.value[idx] = { ...messages.value[idx], status: "CANCELED" };
      } else {
        messages.value.splice(idx, 1);
      }
    }
    isLoading.value = false;
  };

  onMounted(() => {
    client.on("message:update", handleUpdate);
    client.on("conversation:update", handleConversationUpdate);
    client.on("message:start", handleStart);
    client.on("message:chunk", handleChunk);
    client.on("message:complete", handleComplete);
    client.on("message:error", handleError);
    client.on("message:stopped", handleStopped);
    if (options.conversationId) void activate(options.conversationId);
  });

  onUnmounted(() => {
    client.off("message:update", handleUpdate);
    client.off("conversation:update", handleConversationUpdate);
    client.off("message:start", handleStart);
    client.off("message:chunk", handleChunk);
    client.off("message:complete", handleComplete);
    client.off("message:error", handleError);
    client.off("message:stopped", handleStopped);
    if (owner && isBindingOwner(client, owner)) void withBindingOwnership(client, owner, () => client.setActiveConversation(null)).catch(() => {});
    viewEpoch++; owner = undefined;
  });

  async function sendMessage(content: string, files?: AgoUploadFile[]): Promise<AgoMessage | null> {
    let token = owner;
    const epoch = viewEpoch;
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
      const send = () => client.sendMessage(content, { conversationId: conversationId.value, files });
      let pending: Promise<AgoMessage>;
      if (token && isBindingOwner(client, token)) pending = withBindingOwnership(client, token, send);
      else {
        const activation = beginBindingActivation(client, send);
        token = activation.token; owner = token; pending = activation.result;
      }
      pendingSend = { token, epoch, retargeted: false };
      const response = await pending;
      if ((token && !isBindingOwner(client, token)) || viewEpoch !== epoch) return null;
      const retargeted = !!response.conversationId && response.conversationId !== selected;
      if (retargeted) {
        selected = response.conversationId;
        conversationId.value = response.conversationId;
        currentConversation.value = null;
      }
      if (response.status === "DONE" || response.status === "ERROR" || response.status === "CANCELED") {
        isLoading.value = false;
      }
      // Replace temp messages
      messages.value = messages.value.filter((m: AgoMessage) => !m.id.startsWith("temp-") && (!retargeted || m.conversationId === response.conversationId));
      const updatedUser = { ...userMsg, id: userMsg.id.replace("temp-", "user-"), conversationId: response.conversationId };
      if (!messages.value.some((m: AgoMessage) => m.id === response.id)) {
        messages.value.push(updatedUser, response);
      } else {
        messages.value.push(updatedUser);
      }
      return response;
    } catch (err) {
      if ((token && !isBindingOwner(client, token)) || viewEpoch !== epoch) return null;
      if (err instanceof AgoError && err.code === "request_detached") {
        isLoading.value = false;
        messages.value = messages.value.filter((m) => !m.id.startsWith("temp-"));
        return null;
      }
      error.value = err instanceof Error ? err : new Error("Failed to send");
      isLoading.value = false;
      messages.value = messages.value.filter((m: AgoMessage) => !m.id.startsWith("temp-"));
      return null;
    } finally {
      if (pendingSend?.token === token && pendingSend?.epoch === epoch) pendingSend = undefined;
    }
  }

  /**
   * Stop the turn that is generating: closes the stream and tells the backend to
   * stop. The partial answer stays in the transcript as `CANCELED`. No-op when
   * nothing is generating.
   */
  async function stop(): Promise<void> {
    await client.stop();
  }

  function clearMessages() {
    void activate(null);
  }

  return { messages, isLoading, error, conversationId, sendMessage, stop, clearMessages, activate, currentConversation };
}

export function useMessages(options: UseMessagesOptions = {}) {
  const { messages, isLoading, error, conversationId, sendMessage, stop, clearMessages } = useMessagesInternal(options);
  return { messages, isLoading, error, conversationId, sendMessage, stop, clearMessages };
}
