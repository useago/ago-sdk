// React Native entry: the headless React API (provider + hooks) without any
// DOM component. Every module reachable from here must run without `window`
// or `document`. Build the UI with React Native views.

// Client and context
export { AgoClient } from "../client/AgoClient";
export { AgoProvider, useAgoClient, useOptionalAgoClient } from "../react/context";
export type { AgoProviderProps, AgoDeclarativeConfig } from "../react/context/AgoContext";

// Files picked with expo-document-picker / expo-image-picker
export { toAgoFile } from "./toAgoFile";
export type { PickedAsset } from "./toAgoFile";

// Hooks
export { useAgo } from "../react/hooks/useAgo";
export type { UseAgoOptions, UseAgoResult } from "../react/hooks/useAgo";

export { useChat } from "../react/hooks/useChat";
export type { UseChatOptions, UseChatResult } from "../react/hooks/useChat";

export { useMessages } from "../react/hooks/useMessages";
export type { UseMessagesOptions, UseMessagesResult } from "../react/hooks/useMessages";

export { useConversation } from "../react/hooks/useConversation";
export type {
  UseConversationOptions,
  UseConversationResult,
} from "../react/hooks/useConversation";

export { useFeedback } from "../react/hooks/useFeedback";
export type { UseFeedbackOptions, UseFeedbackResult } from "../react/hooks/useFeedback";

export {
  useAgoFunction,
  useAgoNavigation,
  useAgoPageState,
} from "../react/hooks/useAgoFunction";
export type { UseAgoFunctionOptions, AgoRoute } from "../react/hooks/useAgoFunction";
export type { AgoNavigationOptions } from "../functions/navigation";
export type {
  AgoStateControl,
  AgoPageStateOptions,
  AgoPageDataSource,
} from "../functions/types";

export { useAgoAutoContinueAfterNavigation } from "../react/hooks/useAgoAutoContinue";
export type { AgoAutoContinueOptions } from "../react/hooks/useAgoAutoContinue";

export { useAgoActivity } from "../react/hooks/useAgoActivity";
export type {
  AgoActivityItem,
  AgoActivityKind,
  AgoActivityStatus,
  UseAgoActivityOptions,
  UseAgoActivityResult,
} from "../react/hooks/useAgoActivity";

export { useAgoActivityLog } from "../react/hooks/useAgoActivityLog";
export type {
  UseAgoActivityLogOptions,
  UseAgoActivityLogResult,
} from "../react/hooks/useAgoActivityLog";

export { useAgoContext } from "../react/hooks/useAgoContext";
export { useAgoStore } from "../react/hooks/useAgoStore";

export { useFormCollector } from "../react/hooks/useFormCollector";
export type { UseFormCollectorResult } from "../react/hooks/useFormCollector";

// Core types
export type {
  AgoAgent,
  AgoAttachment,
  AgoConfig,
  AgoFetch,
  AgoMessage,
  AgoNativeFile,
  AgoSource,
  AgoUploadFile,
  Conversation,
  FeedbackDetails,
  FeedbackRating,
  FeedbackReason,
  PaginatedResult,
  ToolCallData,
} from "../client/types";
export { FEEDBACK_REASONS } from "../client/types";
export type { StorageLike } from "../state/createStore";
