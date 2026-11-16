import {
  createMockClient as createBase,
  type MockAgoClientOptions,
} from "../src/testing/createMockClient";

import type { AgoConversation } from "../src/client/AgoConversation";

export function createMockClient(options?: MockAgoClientOptions) {
  const client = createBase(options);
  client.conversation = (id) => ({ load: () => client.getConversation(id ?? "") }) as AgoConversation;
  return client;
}
