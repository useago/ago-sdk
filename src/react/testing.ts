// Re-export core testing utilities for backward compat
export { createMockClient, mockVoiceConversation } from "../testing";
export type {
  MockAgoClient,
  MockAgoClientOptions,
  MockVoiceController,
  MockVoiceConversationHandle,
  MockVoiceConversationOptions,
  MockVoiceOptions,
  MockVoiceTurn,
} from "../testing";
