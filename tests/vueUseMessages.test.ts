import { afterEach, describe, it, expect, vi } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import { AgoClient } from "../src/client/AgoClient";
import { useMessages } from "../src/vue/composables/useMessages";
import { createFakeServer } from "./helpers/sseServer";

function emit(client: AgoClient, event: string, payload: unknown) {
  (
    client as unknown as { eventEmitter: { emit: (e: string, p: unknown) => void } }
  ).eventEmitter.emit(event, payload);
}

describe("Vue useMessages", () => {
  it("ignores events of a conversation that is not its own", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let state!: ReturnType<typeof useMessages>;
    const app = createApp(
      defineComponent({
        setup() {
          state = useMessages({ client, conversationId: "mine" });
          return () => h("span");
        },
      }),
    );
    app.mount(document.createElement("div"));

    emit(client, "message:start", { conversationId: "other", messageId: "x1" });
    emit(client, "message:complete", {
      id: "x1",
      conversationId: "other",
      content: "leak",
      role: "assistant",
      status: "DONE",
      createdAt: new Date(),
    });
    emit(client, "message:error", { error: "boom", conversationId: "other" });
    await nextTick();

    expect(state.messages.value).toEqual([]);
    expect(state.error.value).toBeNull();

    emit(client, "message:complete", {
      id: "m1",
      conversationId: "mine",
      content: "mine",
      role: "assistant",
      status: "DONE",
      createdAt: new Date(),
    });
    expect(state.messages.value.map((m) => m.content)).toEqual(["mine"]);
    app.unmount();
  });

  describe("stop", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("stops only its own new conversation, before the server named it", async () => {
      const server = createFakeServer();
      vi.stubGlobal("fetch", server.fetch);
      const client = new AgoClient({ baseUrl: "https://example.test" });
      let state!: ReturnType<typeof useMessages>;
      const app = createApp(
        defineComponent({
          setup() {
            state = useMessages({ client });
            return () => h("span");
          },
        }),
      );
      app.mount(document.createElement("div"));

      void client.conversation("other").sendMessage("Summarize last week");
      await vi.waitFor(() => expect(server.streams).toHaveLength(1));
      const sent = state.sendMessage("Hello");
      await vi.waitFor(() => expect(server.streams).toHaveLength(2));

      await state.stop();
      await sent;

      expect(server.streams[1].signal?.aborted).toBe(true);
      expect(server.streams[0].signal?.aborted).toBe(false);
      expect(client.isGenerating("other")).toBe(true);
      app.unmount();
    });
  });
});
