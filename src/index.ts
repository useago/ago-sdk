// Main SDK exports
export { AgoClient } from "./client/AgoClient";
export type { ResumeGate } from "./client/AgoClient";

// Auto-continue after navigation (framework-agnostic; React/Angular wrap this)
export { attachAutoContinueAfterNavigation } from "./client/autoContinue";
export type { AgoAutoContinueOptions } from "./client/autoContinue";

// Types
export type {
  AgoAgent,
  AgoAttachment,
  AgoClientEvents,
  AgoConfig,
  AgoEventHandler,
  AgoEventName,
  AgoMessage,
  AgoSource,
  ClientFunction,
  ClientFunctionInvocation,
  ClientFunctionsMode,
  Conversation,
  FormField,
  FormSchema,
  FunctionDefinition,
  FunctionSchema,
  MessageStatus,
  PaginatedResult,
  SendMessageOptions,
  SSEChunkData,
  StopMessageResult,
  SubmitToolCallResult,
  ToolCallData,
  ToolCallType,
} from "./client/types";

// Errors
export {
  AgoApiError,
  AgoError,
  AgoFunctionError,
  AgoNetworkError,
  AgoStreamError,
} from "./client/errors";

// Config validation (shared by AgoClient, createAgo and the widget)
export { validateConfig } from "./client/validateConfig";

// Observable store
export { createStore } from "./state/createStore";
export type { Store, PersistOptions, StorageLike } from "./state/createStore";

// Conversation session (stable widget id + front-cached last active thread)
export { createConversationSession } from "./state/createConversationSession";
export type {
  ConversationSession,
  ConversationSessionOptions,
} from "./state/createConversationSession";

// Client Context
export { ClientContextRegistry } from "./state/ClientContextRegistry";
export type {
  ContextEntry,
  ContextSnapshot,
  DynamicContextProvider,
} from "./state/ClientContextRegistry";

export { ActivityLedger, DEFAULT_MAX_ACTIVITY_ENTRIES } from "./activity/ActivityLedger";
export type { ActivityEntry, ActivityInput } from "./activity/ActivityLedger";

// Functions
export { defineFunction } from "./functions/defineFunction";
export { FunctionRegistry } from "./functions/FunctionRegistry";
export type {
  AgoPageDataSource,
  AgoPageStateOptions,
  AgoStateControl,
  ClientFunctionDefinition,
  ClientFunctionHandler,
  ClientFunctionRegisterOptions,
  ClientFunctionSchema,
  RegisteredFunction,
} from "./functions/types";

// Form collector
export { createFormCollector, deriveFormStatus, loadFormCollector } from "./forms/createFormCollector";
export type {
  CreateFormCollectorOptions,
  FormCollector,
  FormCollectorDefinition,
  FormCollectorSchema,
  FormCollectorState,
  FormCollectorStatus,
  FormFieldCondition,
  FormFieldLeafCondition,
  FormFieldSchema,
  FormSubmitResult,
  LoadFormCollectorOptions,
  SubmitConfig,
} from "./forms/createFormCollector";

// Testing (also available via @useago/sdk/testing)
export { createMockClient } from "./testing";
export type { MockAgoClient, MockAgoClientOptions } from "./testing";

// Streaming
export { isStreamNetworkError, SSEHandler } from "./streaming/SSEHandler";

// Widget types (also available via @useago/sdk/widget)
export type { AgoWidgetColors, AgoWidgetConfig } from "./widget/types";

// Streaming helpers
export {
  createMessageStream,
  onFormError,
  onFormSubmitted,
  onFunctionInvoke,
  onMessage,
  onMessageChunk,
  onMessageError,
  onMessageStart,
  onToolCall,
} from "./streaming/helpers";

// Proactive mode (friction signals → declarative triggers → nudges)
export { createAgoProactive } from "./proactive/createAgoProactive";
export { matchesRoutePattern, matchesWhen, partialDeepMatch } from "./proactive/matchers";
export type {
  NudgeAction,
  ProactiveController,
  ProactiveEvaluateResponse,
  ProactiveNudgeInstance,
  ProactiveOptions,
  ProactiveTrackedEvent,
  ProactiveTrigger,
  ProactiveTriggerWhen,
} from "./proactive/types";

// Friction signal collection (used by the proactive mode; usable standalone)
export { SignalCollector } from "./signals/SignalCollector";
export type { SignalCollectorOptions } from "./signals/SignalCollector";
export type {
  Signal,
  SignalCollectorTuning,
  SignalsSnapshot,
  SignalType,
} from "./signals/types";

// Auto-config / zero-config
export { autoDetectConfig, createAgo } from "./auto/createAgo";

// Pre-built function helpers
export {
  copyToClipboard,
  getLocalStorage,
  getUserLocation,
  highlightElement,
  openUrl,
  scrollToElement,
  setLocalStorage,
  setTheme,
  showConfirmDialog,
  showNotification,
  showToast,
  submitForm,
  trackEvent,
} from "./helpers/functions";

// Helper factory
export { withHandler } from "./helpers/factory";

// Utils (for advanced usage)
export { EventEmitter } from "./utils/eventEmitter";
export { logger } from "./utils/logger";

// Attachment display helpers (for building a custom UI that shows uploads safely)
export {
  canInlineImage,
  formatFileSize,
  safeAttachmentUrl,
} from "./utils/attachments";
