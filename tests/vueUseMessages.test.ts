import { afterEach, describe, it, expect, vi } from "vitest";
import { createApp, defineComponent, h } from "vue";
import { AgoClient } from "../src/client/AgoClient";
import { useMessages } from "../src/vue/composables/useMessages";
import { useChat } from "../src/vue/composables/useChat";
import { createFakeServer } from "./helpers/sseServer";

describe("Vue useMessages", () => {
  it("shows only the selected conversation's answer", async () => {
    const server = createFakeServer(); vi.stubGlobal("fetch", server.fetch);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let state!: ReturnType<typeof useMessages>;
    const app = createApp(defineComponent({ setup() { state = useMessages({ client, conversationId: "mine" }); return () => h("span"); } }));
    app.mount(document.createElement("div"));
    void client.conversation("mine").sendMessage("mine");
    void client.conversation("other").sendMessage("other");
    await vi.waitFor(() => expect(server.streams).toHaveLength(2));
    server.streams[0].push({ message_id: "m", thread: { id: "mine" }, content: "visible" });
    server.streams[1].push({ message_id: "o", thread: { id: "other" }, content: "hidden" });
    await vi.waitFor(() => expect(state.messages.value.map((m) => m.content)).toEqual(["mine", "visible"]));
    server.streams.forEach((stream) => stream.end());
    app.unmount(); vi.unstubAllGlobals();
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

it("clears the selected conversation on logout", async () => {
  const server = createFakeServer(); vi.stubGlobal("fetch", server.fetch);
  server.onConversation = (id) => ({ id, title: "private", messages: [{ id: "m", role: "assistant", content: "private", status: "DONE" }] });
  const client = new AgoClient({ baseUrl: "https://example.test", userJwt: "old" });
  let state!: ReturnType<typeof useMessages>;
  const app = createApp(defineComponent({ setup() { state = useMessages({ client, conversationId: "a" }); return () => h("span"); } }));
  app.mount(document.createElement("div"));
  await vi.waitFor(() => expect(state.messages.value.map((m) => m.content)).toEqual(["private"]));
  client.updateConfig({ userJwt: null });
  expect(state.messages.value).toEqual([]);
  expect(state.conversationId.value).toBeUndefined();
  app.unmount(); vi.unstubAllGlobals();
});

it("projects redacted approval history without exposing review actions", async () => {
  const { readFileSync } = await import("node:fs");
  const history = readFileSync("tests/fixtures/background-sdk/history-approval-redacted.json", "utf8");
  const fetcher = vi.fn(async () => new Response(history));
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  let state!: ReturnType<typeof useMessages>;
  const app = createApp(defineComponent({ setup() { state = useMessages({ client, conversationId: "11111111-1111-4111-8111-111111111111" }); return () => h("span"); } }));
  app.mount(document.createElement("div"));
  await vi.waitFor(() => expect(state.messages.value.some((m) => m.role === "assistant")).toBe(true));
  expect(state.messages.value.find((m) => m.role === "assistant")?.approval?.actions).toEqual([]);
  expect(JSON.stringify(state.messages.value)).not.toContain("record-42");
  app.unmount(); client.destroy();
});

it("follows its own fork before the initial send finishes", async () => {
  const server = createFakeServer(); vi.stubGlobal("fetch", server.fetch);
  const client = new AgoClient({ baseUrl: "https://example.test" });
  let state!: ReturnType<typeof useMessages>;
  const app = createApp(defineComponent({ setup() { state = useMessages({ client, conversationId: "original" }); return () => h("span"); } }));
  app.mount(document.createElement("div"));
  const sent = state.sendMessage("fork");
  await vi.waitFor(() => expect(server.streams).toHaveLength(1));
  server.streams[0].push({ thread: { id: "fork" }, message_id: "answer", content: "fork answer" });
  await vi.waitFor(() => expect(state.conversationId.value).toBe("fork"));
  expect(state.messages.value.map((m) => m.content)).toEqual(["fork", "fork answer"]);
  server.streams[0].push({ thread: { id: "fork" }, message_id: "answer", status: "DONE" }); server.streams[0].end(); await sent;
  app.unmount(); vi.unstubAllGlobals();
});

it("keeps a newer selection when a previous send forks late", async () => {
  const server = createFakeServer(); vi.stubGlobal("fetch", server.fetch);
  const client = new AgoClient({ baseUrl: "https://example.test" });
  let state!: ReturnType<typeof useChat>;
  const app = createApp(defineComponent({ setup() { state = useChat({ client, conversationId: "original", autoLoad: false }); return () => h("span"); } }));
  app.mount(document.createElement("div"));
  const sent = state.sendMessage("fork");
  await vi.waitFor(() => expect(server.streams).toHaveLength(1));
  await state.selectConversation("newer");
  server.streams[0].push({ thread: { id: "fork" }, message_id: "answer", content: "late" }); server.streams[0].end(); await sent;
  expect(state.conversationId.value).toBe("newer");
  expect(state.messages.value).toEqual([]);
  app.unmount(); vi.unstubAllGlobals();
});
