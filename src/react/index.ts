// React context
export { AgoProvider, useAgoClient, useOptionalAgoClient } from "./context";
export type { AgoProviderProps, AgoDeclarativeConfig } from "./context/AgoContext";

// React components
export { ChatWidget } from "./components/ChatWidget";
export type { ChatWidgetProps } from "./components/ChatWidget";

export { Message } from "./components/Message";
export type { MessageProps } from "./components/Message";

export { Markdown } from "./components/Markdown";
export type { MarkdownProps } from "./components/Markdown";

export { ChatInput } from "./components/ChatInput";
export type { ChatInputProps } from "./components/ChatInput";

// React hooks
export { useAgo } from "./hooks/useAgo";
export type { UseAgoOptions, UseAgoResult } from "./hooks/useAgo";

export { useMessages } from "./hooks/useMessages";
export type { UseMessagesOptions, UseMessagesResult } from "./hooks/useMessages";

export { useConversation } from "./hooks/useConversation";
export type { UseConversationOptions, UseConversationResult } from "./hooks/useConversation";

export { useChat } from "./hooks/useChat";
export type { UseChatOptions, UseChatResult } from "./hooks/useChat";

export { useAgoFunction, useAgoNavigation } from "./hooks/useAgoFunction";
export type { UseAgoFunctionOptions, AgoRoute } from "./hooks/useAgoFunction";

export { useAgoContext } from "./hooks/useAgoContext";

export { useAgoStore } from "./hooks/useAgoStore";

export { useFormCollector } from "./hooks/useFormCollector";
export type { UseFormCollectorResult } from "./hooks/useFormCollector";

// Form collector core (re-exported for typing the ChatWidget `forms` prop)
export { createFormCollector, deriveFormStatus } from "../forms/createFormCollector";
export type {
  CreateFormCollectorOptions,
  FormCollector,
  FormCollectorSchema,
  FormCollectorState,
  FormCollectorStatus,
  FormSubmitResult,
  SubmitConfig,
} from "../forms/createFormCollector";

// Testing utilities
export { createMockClient } from "./testing";

// Re-export core types for convenience
export type {
  AgoConfig,
  AgoMessage,
  Conversation,
  AgoAgent,
  AgoSource,
  ToolCallData,
} from "../client/types";
