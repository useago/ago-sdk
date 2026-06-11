export { AgoService } from "./ago.service";
export { provideAgo } from "./provide";
export type { AgoProvideOptions } from "./provide";

// Re-export core types for convenience
export type {
  AgoConfig,
  AgoMessage,
  Conversation,
  AgoAgent,
  AgoSource,
  ToolCallData,
  AgoClientEvents,
  AgoEventName,
} from "../client/types";
