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

// Framework-agnostic bottom-sheet controller. The vanilla widget and the React
// `useSheet` hook both drive their presentation from this one state machine, so
// a Vue or Angular binding can consume it directly rather than reimplementing it.
export { createSheetController, compactMediaQuery } from "./sheetController";
export type {
  SheetController,
  SheetOptions,
  SheetSnapshot,
  SheetState,
  SheetChangeCause,
  ElementProps,
} from "./sheetController";
