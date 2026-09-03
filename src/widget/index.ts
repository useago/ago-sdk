export type { AgoWidgetColors, AgoWidgetConfig } from "./types";

// Framework-agnostic (pure TS/JS) chat widget — the vanilla equivalent of the
// React `<ChatWidget>`, with form creator + clickable suggested replies.
export { mountChatWidget } from "./createChatWidget";
export type {
  ChatWidgetHandle,
  ConversationStarter,
  MountChatWidgetOptions,
  WelcomeMessage,
  WidgetFeedbackOptions,
  WidgetLabels,
  WidgetScreen,
  WidgetTheme,
  WidgetToolCallFormOptions,
} from "./types";

// The feedback row's strings, so `feedback: { labels }` can be typed (and the
// defaults reused) without reaching into the widget internals.
export { DEFAULT_FEEDBACK_LABELS } from "./renderFeedback";
export type { FeedbackLabels } from "./renderFeedback";

// The bubble widget's chrome strings and the ticket form's strings, for the
// same reason.
export { DEFAULT_WIDGET_LABELS } from "./labels";
export { DEFAULT_TOOL_CALL_FORM_LABELS } from "./toolCallLabels";
export type { ToolCallFormLabels } from "./toolCallLabels";

// The embed snippet's color mapping and the header contrast rule, so a host
// can preview what `colors` will produce.
export { colorsToTheme } from "./styles";
export { readableTextColor } from "./colorUtils";

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
