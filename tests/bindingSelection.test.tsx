import { afterEach, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { createApp, defineComponent, h } from "vue";
import { AgoClient } from "../src/client/AgoClient";
import { useConversation as useReactConversation } from "../src/react/hooks/useConversation";
import { useChat as useReactChat } from "../src/react/hooks/useChat";
import { useConversation as useVueConversation } from "../src/vue/composables/useConversation";
import { useChat as useVueChat } from "../src/vue/composables/useChat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

function deferredClient() {
  let release!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
  const client = new AgoClient({ baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
  return { client, fetcher, finish: () => release(new Response(JSON.stringify({ id: "selected", messages: [], title: "Selected" }))) };
}

it("React conversation clears loading and error when new conversation supersedes a pending selection", async () => {
  const { client, fetcher, finish } = deferredClient();
  let state!: ReturnType<typeof useReactConversation>;
  function Harness() { state = useReactConversation({ client, autoLoad: false }); return null; }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  let selection!: Promise<void>;
  await act(async () => { selection = state.selectConversation("selected"); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled()); });
  expect(state.isLoading).toBe(true);
  await act(async () => state.startNewConversation());
  expect(state.isLoading).toBe(false); expect(state.error).toBeNull();
  await act(async () => { finish(); await selection; });
  expect(state.currentConversation).toBeNull(); expect(state.isLoading).toBe(false);
  await act(async () => root.unmount()); client.destroy();
});

it("Vue conversation clears loading and error when new conversation supersedes a pending selection", async () => {
  const { client, fetcher, finish } = deferredClient();
  let state!: ReturnType<typeof useVueConversation>;
  const app = createApp(defineComponent({ setup() { state = useVueConversation({ client, autoLoad: false }); return () => h("span"); } }));
  app.mount(document.createElement("div"));
  const selection = state.selectConversation("selected"); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(state.isLoading.value).toBe(true); state.startNewConversation();
  expect(state.isLoading.value).toBe(false); expect(state.error.value).toBeNull();
  finish(); await selection;
  expect(state.currentConversation.value).toBeNull(); expect(state.isLoading.value).toBe(false);
  app.unmount(); client.destroy();
});

it("React conversation settles its loading state after another binding takes ownership", async () => {
  const { client, fetcher, finish } = deferredClient();
  let state!: ReturnType<typeof useReactConversation>;
  let other!: ReturnType<typeof useReactConversation>;
  function Harness() {
    state = useReactConversation({ client, autoLoad: false });
    other = useReactConversation({ client, autoLoad: false });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  let selection!: Promise<void>;
  await act(async () => {
    selection = state.selectConversation("selected");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  });
  expect(state.isLoading).toBe(true);
  await act(async () => other.startNewConversation());
  await act(async () => { finish(); await selection; });
  expect(state.isLoading).toBe(false);
  expect(state.currentConversation).toBeNull();
  expect(client.getActiveConversation()).toBeNull();
  await act(async () => root.unmount());
  client.destroy();
});

it("Vue conversation settles its loading state after another binding takes ownership", async () => {
  const { client, fetcher, finish } = deferredClient();
  let state!: ReturnType<typeof useVueConversation>;
  let other!: ReturnType<typeof useVueConversation>;
  const app = createApp(defineComponent({
    setup() {
      state = useVueConversation({ client, autoLoad: false });
      other = useVueConversation({ client, autoLoad: false });
      return () => h("span");
    },
  }));
  app.mount(document.createElement("div"));
  const selection = state.selectConversation("selected");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(state.isLoading.value).toBe(true);
  other.startNewConversation();
  finish();
  await selection;
  expect(state.isLoading.value).toBe(false);
  expect(state.currentConversation.value).toBeNull();
  expect(client.getActiveConversation()).toBeNull();
  app.unmount();
  client.destroy();
});

it("React useChat exposes loading while selected history is pending", async () => {
  const { client, fetcher, finish } = deferredClient();
  let state!: ReturnType<typeof useReactChat>;
  function Harness() { state = useReactChat({ client, autoLoad: false }); return null; }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  let selection!: Promise<void>;
  await act(async () => { selection = state.selectConversation("selected"); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled()); });
  expect(state.isConversationsLoading).toBe(true);
  await act(async () => { finish(); await selection; });
  expect(state.isConversationsLoading).toBe(false); expect(state.currentConversation?.id).toBe("selected");
  await act(async () => root.unmount()); client.destroy();
});

it("Vue useChat exposes loading while selected history is pending", async () => {
  const { client, fetcher, finish } = deferredClient();
  let state!: ReturnType<typeof useVueChat>;
  const app = createApp(defineComponent({ setup() { state = useVueChat({ client, autoLoad: false }); return () => h("span"); } }));
  app.mount(document.createElement("div"));
  const selection = state.selectConversation("selected"); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(state.isConversationsLoading.value).toBe(true); finish(); await selection;
  expect(state.isConversationsLoading.value).toBe(false); expect(state.currentConversation.value?.id).toBe("selected");
  app.unmount(); client.destroy();
});
