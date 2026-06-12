# Vue 3

Idiomatic Vue composables backed by the same `AgoClient`. Install the plugin
once, then call composables from any component.

```bash
npm install @useago/sdk vue
```

```ts
import { AgoPlugin, useChat, useAgoFunction } from "@useago/sdk/vue";
```

> Vue (`>=3.3`) is an optional peer dependency. Composables use the Composition
> API and must be called from `setup` / `<script setup>`.

---

## 1. Install the plugin

`AgoPlugin` creates one `AgoClient` and provides it to the whole app via
`inject`/`provide`.

```ts
import { createApp } from "vue";
import { AgoPlugin } from "@useago/sdk/vue";
import App from "./App.vue";

createApp(App)
  .use(AgoPlugin, {
    baseUrl: "https://YOUR-DOMAIN.useago.com",
    agent: "support-bot",
  })
  .mount("#app");
```

Prefer not to use the plugin? Every composable accepts an explicit client, or
you can create one standalone:

```ts
import { useAgo } from "@useago/sdk/vue";

const client = useAgo();                                  // from plugin
const standalone = useAgo({ baseUrl: "https://…" });      // no plugin needed
```

---

## 2. Build a chat with `useChat`

All-in-one reactive state (messages + conversations).

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useChat } from "@useago/sdk/vue";

const { messages, sendMessage, isLoading, error } = useChat();
const draft = ref("");

async function onSend() {
  if (!draft.value.trim()) return;
  const text = draft.value;
  draft.value = "";
  await sendMessage(text);
}
</script>

<template>
  <div v-for="m in messages" :key="m.id">
    <b>{{ m.role }}:</b> {{ m.content }}
  </div>
  <form @submit.prevent="onSend">
    <input v-model="draft" :disabled="isLoading" placeholder="Ask anything…" />
    <button :disabled="isLoading">Send</button>
  </form>
  <p v-if="error" role="alert">{{ error.message }}</p>
</template>
```

Everything returned is a `ref`/`computed`, so it stays reactive. `messages`
updates token-by-token as the reply streams.

### Composables

| Composable | Returns (refs) |
| --- | --- |
| `useMessages({ conversationId? })` | `messages`, `isLoading`, `error`, `conversationId`, `sendMessage`, `clearMessages` |
| `useConversation({ autoLoad? })` | `conversations`, `currentConversation`, `isLoading`, `error`, `selectConversation`, `startNewConversation`, `refreshConversations` |
| `useChat(options)` | both combined |

Each composable accepts `{ client }` to override the injected client.

---

## 3. Let the agent call your code: `useAgoFunction`

Registers on mount, unregisters on unmount.

```vue
<script setup lang="ts">
import { useAgoFunction } from "@useago/sdk/vue";

useAgoFunction("lookupOrder", {
  description: "Look up an order by ID",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "Order ID" } },
    required: ["id"],
  },
  handler: async (args) => fetchOrder(args.id as string),
});
</script>
```

See [Client-side functions](../general/functions-and-context.md#client-side-functions) for
schema details and the pre-built helper catalogue.

---

## 4. Let the agent navigate: `useAgoNavigation`

Works with `vue-router`.

```vue
<script setup lang="ts">
import { useRouter } from "vue-router";
import { useAgoNavigation } from "@useago/sdk/vue";

const router = useRouter();
useAgoNavigation((path) => router.push(path), [
  { name: "dashboard", path: "/dashboard", description: "Main dashboard" },
  { name: "settings", path: "/settings", description: "User settings" },
]);
</script>
```

---

## 5. Subscribe to events: `useAgoEvents`

Auto-cleans up on unmount.

```vue
<script setup lang="ts">
import { useAgoEvents } from "@useago/sdk/vue";

useAgoEvents("message:complete", (msg) => {
  console.log("Got reply:", msg.content);
});
</script>
```

---

## 6. Client context

There is no dedicated Vue composable for context: use the core client API,
which is fully reactive-friendly:

```vue
<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useAgo } from "@useago/sdk/vue";

const client = useAgo();

onMounted(() => {
  // Dynamic: re-evaluated on every send, so it always reflects current state
  client.addDynamicContext("cart", () => ({
    name: "Cart",
    data: { itemCount: cart.value.length },
  }));
});
onUnmounted(() => client.removeDynamicContext("cart"));
</script>
```

See [Client context](../general/functions-and-context.md#client-context) for the full API.

---

## 7. Reactive external state: `useAgoStore`

Hold shared UI/request state in a core [`createStore`](../general/core.md#hold-live-state-with-createstore)
(useful when client-side functions and your components mutate the same value)
and `useAgoStore` exposes it as a reactive ref. The ref's `.value` updates on
every `store.set`, with auto-cleanup when the component is disposed.

```vue
<script setup lang="ts">
import { createStore } from "@useago/sdk";
import { useAgoStore } from "@useago/sdk/vue";

const cart = createStore({ items: [] as string[] });
const state = useAgoStore(cart);

// Mutate through the store, from anywhere, including a registered AGO function:
function add(sku: string) {
  cart.set({ items: [...cart.get().items, sku] });
}
</script>

<template>
  <span>{{ state.items.length }}</span>
</template>
```

---

## Full example

A runnable Vue example lives in [`examples/simple-vue`](../examples/simple-vue)
(see also `examples/simple-vue/src/components/ChatPanel.vue`).

---

## Exports cheat-sheet (`@useago/sdk/vue`)

- **Setup:** `AgoPlugin`, `useAgo`, `AGO_CLIENT_KEY`
- **Composables:** `useChat`, `useMessages`, `useConversation`,
  `useAgoFunction`, `useAgoNavigation`, `useAgoEvents`, `useAgoStore`
- **Types:** `AgoConfig`, `AgoMessage`, `Conversation`, `AgoAgent`,
  `AgoSource`, `ToolCallData`, `AgoPluginOptions`

> The polished `<ChatWidget>` component is React-only. In Vue, build your UI
> from `useChat` (see the example); it's a handful of lines.

See also: [Client functions & context](../general/functions-and-context.md) ·
[Testing](../general/testing.md) · [Configuration](../general/configuration.md)
