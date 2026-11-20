import { describe, expect, it, vi } from "vitest";
import { AgoConversation, type ConversationHost } from "../src/client/AgoConversation";
import type { AgoMessage } from "../src/client/types";

function setup() {
  let running = false;
  const response: AgoMessage = {
    id: "answer", conversationId: "c1", role: "assistant", content: "ok",
    status: "DONE", createdAt: new Date(),
  };
  const host: ConversationHost = {
    runSend: vi.fn(async () => response),
    stopConversation: vi.fn(async () => null),
    hasTurn: () => running,
    isActive: () => true,
    userSent: vi.fn(),
    getConversation: vi.fn(async () => ({ id: "c1", title: "", lastMessageDate: new Date() })),
    fetchConversation: vi.fn(async () => ({ id: "c1", title: "", lastMessageDate: new Date() })),
    stopPolledMessage: vi.fn(),
    rekeyed: vi.fn(), retain: vi.fn(), release: vi.fn(),
    generatingChanged: vi.fn(),
    fetchObservationResponse: vi.fn(),
    emitMessageUpdate: vi.fn(), emitInteractionUpdate: vi.fn(),
    emitObservedCompletion: vi.fn(), reportConnectionStatus: vi.fn(),
  };
  const conversation = new AgoConversation(host, "c1", false);
  return { host, conversation, setRunning: (value: boolean) => { running = value; } };
}

describe("background conversation input", () => {
  it("rejects known busy input before adding a message and does not stop it", async () => {
    const { conversation, host } = setup();
    conversation._applyBackgroundSnapshot({ interaction: { canSendMessage: false, blockingMessageId: "m1" }, message: { id: "m1", conversationId: "c1", role: "assistant", content: "", status: "IN_PROGRESS", createdAt: new Date() } });
    await expect(conversation.sendMessage("hello")).rejects.toMatchObject({ code: "conversation_busy" });
    expect(conversation.getMessages().some((message) => message.role === "user")).toBe(false);
    expect(await conversation.stop()).toBeNull();
    expect(host.stopConversation).not.toHaveBeenCalled();
  });

  it("rechecks a queued send after background work is identified", async () => {
    const { conversation, host, setRunning } = setup();
    setRunning(true);
    const queued = conversation.sendMessage("queued");
    conversation._applyBackgroundSnapshot({ interaction: { canSendMessage: false, blockingMessageId: "m1" }, message: { id: "m1", conversationId: "c1", role: "assistant", content: "", status: "IN_PROGRESS", createdAt: new Date() } });
    setRunning(false);
    conversation._turnEnded();
    await expect(queued).rejects.toMatchObject({ code: "conversation_busy" });
    expect(conversation.getMessages().some((message) => message.role === "user")).toBe(false);
    expect(host.runSend).not.toHaveBeenCalled();
  });
});
