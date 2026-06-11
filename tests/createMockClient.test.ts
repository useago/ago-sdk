import { describe, it, expect, vi } from "vitest";
import { createMockClient } from "../src/testing";

describe("createMockClient", () => {
  it("should create a client with default methods", async () => {
    const mock = createMockClient();

    const msg = await mock.sendMessage("hello");
    expect(msg.content).toBe("Mock response");
    expect(msg.role).toBe("assistant");
  });

  it("should record method calls", async () => {
    const mock = createMockClient();

    await mock.sendMessage("hello");
    await mock.sendMessage("world");

    expect(mock.__calls).toHaveLength(2);
    expect(mock.__callsFor("sendMessage")).toHaveLength(2);
    expect(mock.__callsFor("sendMessage")[0].args[0]).toBe("hello");
  });

  it("should accept overrides", async () => {
    const mock = createMockClient({
      overrides: {
        sendMessage: async () => ({
          id: "custom",
          content: "Custom response",
          role: "assistant" as const,
          status: "DONE" as const,
          conversationId: "c1",
          createdAt: new Date(),
        }),
      },
    });

    const msg = await mock.sendMessage("test");
    expect(msg.content).toBe("Custom response");
  });

  it("should emit events via __emitEvent", () => {
    const mock = createMockClient();
    const handler = vi.fn();

    mock.on("message:complete", handler);
    mock.__emitEvent("message:complete", {
      id: "1",
      conversationId: "c1",
      content: "test",
      role: "assistant",
      status: "DONE",
      createdAt: new Date(),
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should support once via __emitEvent", () => {
    const mock = createMockClient();
    const handler = vi.fn();

    mock.once("message:complete", handler);
    const msg = {
      id: "1",
      conversationId: "c1",
      content: "test",
      role: "assistant" as const,
      status: "DONE" as const,
      createdAt: new Date(),
    };
    mock.__emitEvent("message:complete", msg);
    mock.__emitEvent("message:complete", msg);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should support waitFor via __emitEvent", async () => {
    const mock = createMockClient();

    const promise = mock.waitFor("message:complete");
    const msg = {
      id: "1",
      conversationId: "c1",
      content: "waited",
      role: "assistant" as const,
      status: "DONE" as const,
      createdAt: new Date(),
    };
    mock.__emitEvent("message:complete", msg);

    const result = await promise;
    expect(result.content).toBe("waited");
  });
});
