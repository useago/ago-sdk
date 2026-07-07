import { describe, it, expect, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { attachAutoContinueAfterNavigation } from "../src/client/autoContinue";
import { AgoService } from "../src/angular/ago.service";
import type { AgoMessage } from "../src/client/types";

function emit(client: AgoClient, event: string, payload: unknown) {
  (
    client as unknown as { eventEmitter: { emit: (e: string, p: unknown) => void } }
  ).eventEmitter.emit(event, payload);
}

function navigate(client: AgoClient, conversationId = "c1") {
  emit(client, "function:invoke", {
    functionName: "navigateToPage",
    arguments: {},
    conversationId,
    invocationId: "inv1",
  });
}

function complete(client: AgoClient, conversationId = "c1") {
  emit(client, "message:complete", {
    id: "m1",
    conversationId,
    content: "",
    role: "assistant",
    status: "DONE",
    createdAt: new Date(),
  } satisfies AgoMessage);
}

function registerPageState(client: AgoClient) {
  client.registerPageStateFunction([
    { name: "flavorFilter", description: "Filter", schema: { type: "string" }, get: () => "all", set: () => {} },
  ]);
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("attachAutoContinueAfterNavigation (core)", () => {
  it("sends a hidden continuation once the destination registers page-state", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const send = vi.spyOn(client, "sendMessage").mockResolvedValue({} as AgoMessage);
    const detach = attachAutoContinueAfterNavigation(client, {
      settleMs: 0,
      readinessTimeoutMs: 200,
    });

    navigate(client);
    registerPageState(client);
    complete(client);
    await tick(30);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.any(String), {
      conversationId: "c1",
      hidden: true,
    });
    detach();
  });

  it("does not continue when the destination has no page-state (timeout)", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const send = vi.spyOn(client, "sendMessage").mockResolvedValue({} as AgoMessage);
    const detach = attachAutoContinueAfterNavigation(client, {
      settleMs: 0,
      readinessTimeoutMs: 20,
    });

    navigate(client);
    complete(client);
    await tick(60);

    expect(send).not.toHaveBeenCalled();
    detach();
  });

  it("stops reacting after detach", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const send = vi.spyOn(client, "sendMessage").mockResolvedValue({} as AgoMessage);
    const detach = attachAutoContinueAfterNavigation(client, {
      settleMs: 0,
      readinessTimeoutMs: 200,
    });
    detach();

    navigate(client);
    registerPageState(client);
    complete(client);
    await tick(30);

    expect(send).not.toHaveBeenCalled();
  });

  it("supports live options via a getter", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const send = vi.spyOn(client, "sendMessage").mockResolvedValue({} as AgoMessage);
    let enabled = false;
    const detach = attachAutoContinueAfterNavigation(client, () => ({
      enabled,
      settleMs: 0,
      readinessTimeoutMs: 200,
    }));

    navigate(client);
    registerPageState(client);
    complete(client);
    await tick(30);
    expect(send).not.toHaveBeenCalled();

    enabled = true; // no re-attach needed
    navigate(client);
    complete(client);
    await tick(30);
    expect(send).toHaveBeenCalledTimes(1);

    detach();
  });
});

describe("AgoService.enableAutoContinueAfterNavigation", () => {
  it("wires the auto-continue onto the underlying client and returns a disable fn", async () => {
    const service = new AgoService({ baseUrl: "https://example.test" });
    const client = service.getClient();
    const send = vi.spyOn(client, "sendMessage").mockResolvedValue({} as AgoMessage);
    const disable = service.enableAutoContinueAfterNavigation({
      settleMs: 0,
      readinessTimeoutMs: 200,
    });

    navigate(client);
    registerPageState(client);
    complete(client);
    await tick(30);
    expect(send).toHaveBeenCalledTimes(1);

    disable();
    navigate(client);
    complete(client);
    await tick(30);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
