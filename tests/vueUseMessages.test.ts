import { describe, it, expect } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import { AgoClient } from "../src/client/AgoClient";
import { useMessages } from "../src/vue/composables/useMessages";

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
});
