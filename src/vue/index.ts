import { enableBrowserRemoteAssist } from "../remoteAssist/browserKit";

// Browser entry: remote assistance gets its consent UI and screenshots. Kept by
// bundlers through package.json `sideEffects`; `@useago/sdk/native` never calls it.
enableBrowserRemoteAssist();

export { AgoPlugin } from "./plugin";
export type { AgoPluginOptions } from "./plugin";
export { useAgo } from "./composables/useAgo";
export { useChat } from "./composables/useChat";
export { useMessages } from "./composables/useMessages";
export { useConversation } from "./composables/useConversation";
export { useFeedback } from "./composables/useFeedback";
export type { UseFeedbackOptions } from "./composables/useFeedback";
export { useAgoFunction, useAgoNavigation, useAgoPageState } from "./composables/useAgoFunction";
export type { AgoRoute } from "./composables/useAgoFunction";
export type { AgoNavigationOptions } from "../functions/navigation";
export type {
  AgoStateControl,
  AgoPageStateOptions,
  AgoPageDataSource,
} from "../functions/types";
export { useAgoEvents } from "./composables/useAgoEvents";
export { useAgoStore } from "./composables/useAgoStore";
export { useProactiveNudge } from "./composables/useProactiveNudge";
export { useHandoff } from "./composables/useHandoff";
export { useRemoteAssist } from "./composables/useRemoteAssist";
export type { UseProactiveNudgeResult } from "./composables/useProactiveNudge";
export { AGO_CLIENT_KEY } from "./symbols";

// Re-export core types for convenience
export type {
  AgoConfig,
  AgoMessage,
  Conversation,
  FeedbackDetails,
  FeedbackRating,
  FeedbackReason,
  AgoAgent,
  AgoSource,
  ConversationMarker,
  HandoffState,
  MessageRole,
  ToolCallData,
} from "../client/types";
export type {
  RemoteAssistApprovalRequest,
  RemoteAssistCall,
  RemoteAssistCallEvent,
  RemoteAssistOptions,
  RemoteAssistSession,
  RemoteAssistSnapshot,
  RemoteAssistState,
} from "../remoteAssist/types";
export { FEEDBACK_REASONS } from "../client/types";
export type {
  NudgeAction,
  ProactiveController,
  ProactiveNudgeInstance,
  ProactiveOptions,
  ProactiveTrigger,
} from "../proactive/types";
