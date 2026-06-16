// Main SDK exports
export { AgoClient } from "./client/AgoClient";

// Types
export type {
  AgoAgent,
  AgoClientEvents,
  AgoConfig,
  AgoEventHandler,
  AgoEventName,
  AgoMessage,
  AgoSource,
  ClientFunction,
  ClientFunctionInvocation,
  Conversation,
  FormField,
  FormSchema,
  FunctionDefinition,
  FunctionSchema,
  MessageStatus,
  SendMessageOptions,
  SSEChunkData,
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

// Functions
export { defineFunction } from "./functions/defineFunction";
export { FunctionRegistry } from "./functions/FunctionRegistry";
export type {
  ClientFunctionDefinition,
  ClientFunctionHandler,
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
