export type { AgoWidgetColors, AgoWidgetConfig } from "./types";

// Framework-agnostic (pure TS/JS) chat widget — the vanilla equivalent of the
// React `<ChatWidget>`, with form creator + clickable suggested replies.
export { mountChatWidget } from "./createChatWidget";
export type {
  ChatWidgetHandle,
  MountChatWidgetOptions,
  WelcomeMessage,
  WidgetTheme,
} from "./types";

// Dependency-free markdown → DOM renderer used for message content; exported so
// consumers building a custom vanilla UI can render assistant content the same way.
export { renderMarkdown } from "./renderMarkdown";

// Re-exported so the `forms` option can be typed without a second import.
export type { CreateFormCollectorOptions } from "../forms/createFormCollector";

// Re-exported so `persistConversation` and the handle's `session` can be typed
// without a second import.
export type {
  ConversationSession,
  ConversationSessionOptions,
} from "../state/createConversationSession";
