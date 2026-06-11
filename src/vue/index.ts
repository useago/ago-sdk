export { AgoPlugin } from "./plugin";
export type { AgoPluginOptions } from "./plugin";
export { useAgo } from "./composables/useAgo";
export { useChat } from "./composables/useChat";
export { useMessages } from "./composables/useMessages";
export { useConversation } from "./composables/useConversation";
export { useAgoFunction, useAgoNavigation } from "./composables/useAgoFunction";
export { useAgoEvents } from "./composables/useAgoEvents";
export { useAgoStore } from "./composables/useAgoStore";
export { AGO_CLIENT_KEY } from "./symbols";

// Re-export core types for convenience
export type {
  AgoConfig,
  AgoMessage,
  Conversation,
  AgoAgent,
  AgoSource,
  ToolCallData,
} from "../client/types";
