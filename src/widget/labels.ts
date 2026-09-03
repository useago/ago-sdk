/**
 * English defaults for the bubble widget's chrome strings, and the merge that
 * layers a partial `labels` option on top of them.
 */

import { DEFAULT_TIME_AGO_LABELS } from "./timeAgo";
import type { MountChatWidgetOptions, WidgetLabels } from "./types";

export const DEFAULT_WIDGET_LABELS: WidgetLabels = {
  home: "Home",
  chats: "Chats",
  history: "History",
  newConversation: "New conversation",
  noHistory: "No chat history yet",
  askQuestion: "Ask a question",
  back: "Back",
  close: "Close chat",
  newChat: "New chat",
  errorTitle: "Something went wrong",
  errorDescription:
    "The answer could not be generated. Please try again.",
  scrollToBottom: "Scroll to bottom",
  dismiss: "Dismiss",
  attachFiles: "Attach files",
  tooManyFiles: "Too many files. Maximum allowed: {max}",
  invalidFileType: "Invalid file type: {name}",
  fileTooLarge: "File too large: {name} (maximum {max})",
  timeAgo: DEFAULT_TIME_AGO_LABELS,
};

export function resolveLabels(
  overrides: MountChatWidgetOptions["labels"],
): WidgetLabels {
  return {
    ...DEFAULT_WIDGET_LABELS,
    ...overrides,
    timeAgo: { ...DEFAULT_WIDGET_LABELS.timeAgo, ...overrides?.timeAgo },
  };
}
