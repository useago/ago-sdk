# AGO SDK skill: plain JavaScript / TypeScript

You are integrating the AGO SDK (`@useago/sdk`) into a plain JS/TS app (no React,
Vue, or Angular), a Node service, or a web component. AGO is a chat agent that can
answer questions, run functions in the user's browser, and navigate your app. The
core `AgoClient` documented here is what every framework binding wraps. This file
is everything you need. Follow it exactly.

## Endpoints

Use the live demo for anything runnable so it answers with zero setup:

```
baseUrl: https://playground.api.useago.com
agent:   generic-guide
```

When the project has its own tenant, swap to `https://YOUR-DOMAIN.api.useago.com`
and the project's own agent slug. Read `baseUrl` from an env var, never hardcode a
real tenant URL.

## Install

```bash
npm install @useago/sdk
```

## 1. Create a client

```ts
import { AgoClient } from "@useago/sdk";

const ago = new AgoClient({
  baseUrl: "https://playground.api.useago.com", // required
  agent: "generic-guide",                        // optional default agent
  userEmail: "jane@acme.com",                    // optional end-user identity
  debug: true,                                   // optional verbose logging
});
```

If the page already exposes config (a `window.AGO` object, `<meta name="ago-base-url">`
tags, or `data-ago-*` attributes), let the SDK find it with `createAgo()` (throws
if it can't resolve a `baseUrl`).

## 2. Send a message and stream the reply

`sendMessage` resolves with the final assistant message, but the text arrives
incrementally through events. Subscribe BEFORE you send.

```ts
const outputEl = document.getElementById("output");

ago.on("message:start", ({ messageId }) => console.log("New message", messageId));
ago.on("message:chunk", ({ content }) => { outputEl.textContent += content; }); // token-by-token
ago.on("message:complete", (message) => console.log("sources:", message.sources));
ago.on("message:error", ({ error }) => console.error(error));

const reply = await ago.sendMessage("How do I reset my password?");
```

Continue a conversation by reusing `conversationId`:

```ts
const first = await ago.sendMessage("Hi");
await ago.sendMessage("Tell me more", { conversationId: first.conversationId });
```

Attach files (`File[]`, sent as multipart) and override the agent per message:

```ts
await ago.sendMessage("Summarise this", { files: [fileInput.files[0]], conversationId });
await ago.sendMessage("Escalate this", { agentId: "human-handoff" });
```

## 3. Conversations

```ts
const conversations = await ago.getConversations();          // [{ id, title, lastMessageDate }]
const thread = await ago.getConversation(conversations[0].id); // includes messages
const messages = await ago.getMessages(conversations[0].id);
```

## 4. Let the agent run code in the browser

```ts
ago.registerFunction({
  name: "lookupOrder",
  description: "Look up an order by its ID",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "Order ID" } },
    required: ["id"],
  },
  handler: async (args) => fetchOrder(args.id as string),
});
```

Rules for functions:
- Every parameter property needs a `description`. The agent reads it to decide
  what to pass.
- `required` lists only the params the function truly needs.
- The handler must return serializable data (no DOM nodes, no circular refs).

Navigation is a built-in convenience:

```ts
ago.registerNavigationFunction((path) => (window.location.href = path), [
  { name: "pricing", path: "/pricing", description: "Pricing page" },
  { name: "docs", path: "/docs", description: "Documentation" },
]);
```

## 5. Give the agent context

```ts
ago.setContext("order-page", {
  name: "Order detail",
  description: "User is viewing an order",
  data: { orderId: "123", status: "shipped" },
});

// Re-evaluated on every send, great for live state:
ago.addDynamicContext("cart", () => ({ name: "Cart", data: { itemCount: cart.length } }));

// Attach the current URL + page title:
ago.enableAutoPageContext();
```

Hold shared state both the agent's functions and your UI mutate with
`createStore` (a tiny `get` / `set` / `subscribe` holder):

```ts
import { createStore } from "@useago/sdk";

const store = createStore({ items: [] as string[] });
store.subscribe((state) => render(state));
ago.addDynamicContext("cart", () => ({ name: "Cart", data: store.get() }));
store.set({ items: [...store.get().items, "SKU-1"] });
```

Pass `{ key: "cart" }` as a second arg to persist across reloads (localStorage by
default; pass `storage: sessionStorage` to swap).

## 6. Drop-in chat panel: `mountChatWidget`

A complete chat panel (header, streaming messages, input) you mount into any DOM
element, no framework. Supports conversational forms and clickable suggested
replies, same as the React `<ChatWidget>`.

```ts
import { mountChatWidget } from "@useago/sdk/widget";

const widget = mountChatWidget("#chat", {
  config: { baseUrl: "https://playground.api.useago.com", agent: "generic-guide" },
  title: "Ask me anything",
  welcomeMessage: "Hi! How can I help?",
});

widget.sendMessage("Hello");
widget.destroy(); // removes listeners, uninstalls forms, clears the DOM
```

Set `placement: "left"` or `"right"` for a fixed full-height side panel with a
launcher button. Set `persistConversation: true` to resume the visitor's last
thread across reloads. Theme it with the `theme` option or `--ago-*` CSS variables
on `.ago-chat-widget`. Message text renders as GitHub-flavored markdown and is
HTML-escaped before it touches the DOM.

For a fully custom UI, build from `sendMessage` + the `message:chunk` event (see
section 2); `renderMarkdown(source)` is exported if you want the same markdown
rendering.

## 7. Tool calls, feedback, lifecycle

```ts
await ago.submitToolCallForm(toolCallId, { quantity: 3 });
await ago.confirmToolCall(toolCallId);
await ago.rejectToolCall(toolCallId);
await ago.submitFeedback(messageId, "positive");
ago.updateConfig({ userJwt: token });   // e.g. after login
ago.destroy();                           // clean up listeners, functions, context
```

## Key events

`message:start`, `message:chunk` (`{ content }` per token), `message:complete`
(`AgoMessage`), `message:error`, `conversation:loaded`, `context:changed`,
`toolCall:received`, `function:invoke`, `function:result`, `connection:status`.
Use `on` / `off` / `once`, or `await ago.waitFor("message:complete", { timeout })`.

## Key types

```ts
interface AgoMessage {
  id: string;
  conversationId: string;
  content: string;
  role: "user" | "assistant";
  status: "IN_PROGRESS" | "DONE" | "ERROR" | "TODO" | "CANCELED";
  sources?: AgoSource[];          // knowledge-base citations { id, title, url? }
  toolCalls?: ToolCallData[];
  followUpReplies?: string[];     // suggested next questions
  createdAt: Date;
}
```

All types are exported from `@useago/sdk`.

## Checklist before you finish

1. Event subscriptions are added BEFORE the first `sendMessage`.
2. `baseUrl` comes from an env var, not a hardcoded tenant URL.
3. Every registered function's parameters have descriptions and the handler
   returns serializable data.
4. `ago.destroy()` runs when the client is no longer needed.
5. Run the project's typecheck and lint.
