import {
  createMockClient as createBase,
  type MockAgoClientOptions,
} from "../src/testing/createMockClient";

import { registerBindingPrincipalCapture } from "../src/client/bindingOwnership";

export function createMockClient(options?: MockAgoClientOptions) {
  const client = createBase(options);
  registerBindingPrincipalCapture(client, () => async (effect) => effect());
  client.setActiveConversation = async (id) =>
    id ? client.getConversation(id) : null;
  return client;
}
