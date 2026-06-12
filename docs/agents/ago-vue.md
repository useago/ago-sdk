# AGO SDK skill: Vue 3

You are integrating the AGO SDK (`@useago/sdk`) into a Vue 3 app. AGO is a chat
agent that can answer questions, run functions in the user's browser, and
navigate your app's routes. This file is everything you need. Follow it exactly.

## Endpoints

Use the live demo for anything runnable so it answers with zero setup:

```
baseUrl: https://playground.api.useago.com
agent:   generic-guide
```

When the project has its own tenant, swap to `https://YOUR-DOMAIN.api.useago.com`
and the project's own agent slug. Read `baseUrl` from an env var, never hardcode a
real tenant URL. Vue `>=3.3` is an optional peer dependency. Composables use the
Composition API and must be called from `setup` / `<script setup>`.

## Install

```bash
npm install @useago/sdk
```

## 1. Install the plugin

`AgoPlugin` creates one `AgoClient` and provides it to the whole app.

```ts
import { createApp } from "vue";
import { AgoPlugin } from "@useago/sdk/vue";
import App from "./App.vue";

createApp(App)
  .use(AgoPlugin, {
    baseUrl: "https://playground.api.useago.com",
    agent: "generic-guide",
  })
  .mount("#app");
```

Prefer no plugin? Every composable accepts an explicit client, or create one
standalone with `useAgo`:

```ts
import { useAgo } from "@useago/sdk/vue";

const client = useAgo();                              // from plugin
const standalone = useAgo({ baseUrl: "https://..." }); // no plugin needed
```

There is no polished `<ChatWidget>` component in Vue (it is React-only). Build the
UI from `useChat`; it is a handful of lines, shown below.

## 2. Build a chat with `useChat`

All-in-one reactive state (messages + conversations). Everything returned is a
`ref`/`computed`, so it stays reactive. `messages` updates token-by-token.

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
    <input v-model="draft" :disabled="isLoading" placeholder="Ask anything..." />
    <button :disabled="isLoading">Send</button>
  </form>
  <p v-if="error" role="alert">{{ error.message }}</p>
</template>
```

Each assistant message carries the knowledge sources it used in `m.sources` (an
`AgoSource[]`, each `{ id, title, url? }`). Render them as links.

Finer-grained composables: `useMessages({ conversationId? })`,
`useConversation({ autoLoad? })`. Each accepts `{ client }` to override the
injected client.

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

Rules for functions:
- Every parameter property needs a `description`. The agent reads it to decide
  what to pass.
- `required` lists only the params the function truly needs.
- The handler must return serializable data (no DOM nodes, no circular refs).

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

The `description` is what the agent reads to pick a page. Write it like you'd
explain the page to a colleague.

## 5. Subscribe to events: `useAgoEvents`

Auto-cleans up on unmount.

```vue
<script setup lang="ts">
import { useAgoEvents } from "@useago/sdk/vue";

useAgoEvents("message:complete", (msg) => console.log("Got reply:", msg.content));
</script>
```

Key events: `message:start`, `message:chunk` (`{ content }` per token),
`message:complete` (`AgoMessage`), `message:error`.

## 6. Client context

There is no dedicated Vue composable for context. Use the core client API, which
is reactive-friendly:

```vue
<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useAgo } from "@useago/sdk/vue";

const client = useAgo();

onMounted(() => {
  // Re-evaluated on every send, so it always reflects current state
  client.addDynamicContext("cart", () => ({ name: "Cart", data: { itemCount: cart.value.length } }));
});
onUnmounted(() => client.removeDynamicContext("cart"));
</script>
```

For a static snapshot use `client.setContext(key, entry)`. Attach the current URL
+ title with `client.enableAutoPageContext()`.

## 7. Reactive external state: `useAgoStore`

Hold shared state in a core `createStore` and expose it as a reactive ref.

```vue
<script setup lang="ts">
import { createStore } from "@useago/sdk";
import { useAgoStore } from "@useago/sdk/vue";

const cart = createStore({ items: [] as string[] });
const state = useAgoStore(cart);
</script>

<template><span>{{ state.items.length }}</span></template>
```

## Exports cheat-sheet (`@useago/sdk/vue`)

- Setup: `AgoPlugin`, `useAgo`, `AGO_CLIENT_KEY`
- Composables: `useChat`, `useMessages`, `useConversation`, `useAgoFunction`,
  `useAgoNavigation`, `useAgoEvents`, `useAgoStore`
- Types: `AgoConfig`, `AgoMessage`, `Conversation`, `AgoAgent`, `AgoSource`,
  `ToolCallData`, `AgoPluginOptions`

## Checklist before you finish

1. `AgoPlugin` is installed on the app (or a client is passed explicitly).
2. `baseUrl` comes from an env var, not a hardcoded tenant URL.
3. Every registered function's parameters have descriptions and the handler
   returns serializable data.
4. Run `npm run typecheck` and `npm run lint` (or the project's equivalents).
