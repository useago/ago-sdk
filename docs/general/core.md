# Core SDK (plain JavaScript / TypeScript)

The framework-agnostic heart of the SDK. Everything else (React, Vue, Angular)
is a thin layer over the `AgoClient` documented here. Use this directly in a
vanilla web app, a Node service, a web component, or any framework not covered
by a dedicated binding.

```bash
npm install @useago/sdk
```

```ts
import { AgoClient } from "@useago/sdk";
```

---

## 1. Create a client

```ts
const ago = new AgoClient({
  baseUrl: "https://YOUR-DOMAIN.useago.com", // required
  agent: "support-bot", // optional default agent (id or slug)
  userEmail: "jane@acme.com", // optional end-user identity
  debug: true, // optional verbose logging
});
```

`baseUrl` is the only required option. See
[Configuration & auth](configuration.md) for every option and the request
headers they map to.

### Zero-config

If your page already exposes config (a `window.AGO` object, `<meta name="ago-base-url">`
tags, or `data-ago-*` attributes), let the SDK find it:

```ts
import { createAgo } from "@useago/sdk";

const ago = createAgo(); // auto-detects from the DOM
const ago2 = createAgo({ debug: true }); // detect, then override a few keys
```

`createAgo()` throws if it can't find a `baseUrl`. Use
`autoDetectConfig()` if you want the resolved config object (or `null`) without
constructing a client.

---

## 2. Send a message and stream the reply

`sendMessage` resolves with the final assistant message, but the text arrives
incrementally through events. Subscribe **before** you send.

```ts
ago.on("message:start", ({ conversationId, messageId }) => {
  console.log("New message", messageId, "in", conversationId);
});

const outputEl = document.getElementById("output"); // any element on your page

ago.on("message:chunk", ({ content }) => {
  outputEl.textContent += content; // token-by-token streaming
});

ago.on("message:complete", (message) => {
  console.log("Final:", message.content, "sources:", message.sources);
});

ago.on("message:error", ({ error }) => console.error(error));

const reply = await ago.sendMessage("How do I reset my password?");
```

### Continue a conversation

`sendMessage` returns the message, whose `conversationId` you reuse to keep the
thread going:

```ts
const first = await ago.sendMessage("Hi");
await ago.sendMessage("Tell me more", { conversationId: first.conversationId });
```

### File attachments

```ts
await ago.sendMessage("Summarise this", {
  files: [fileInput.files[0]], // File[], sent as multipart/form-data
  conversationId,
});
```

### Override the agent per message

```ts
await ago.sendMessage("Escalate this", { agentId: "human-handoff" });
```

---

## 3. Conversations

```ts
const conversations = await ago.getConversations();
// → [{ id, title, lastMessageDate }]

const thread = await ago.getConversation(conversations[0].id);
// → { id, title, lastMessageDate, messages: AgoMessage[] }

const messages = await ago.getMessages(conversations[0].id);
```

---

## 4. Let the agent run code in the browser

Register client-side functions and the agent can call them mid-conversation.
This is the SDK's superpower; full guide in
[Client-side functions & context](functions-and-context.md).

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

Navigation is a built-in convenience:

```ts
ago.registerNavigationFunction(
  (path) => (window.location.href = path),
  [
    { name: "pricing", path: "/pricing", description: "Pricing page" },
    { name: "docs", path: "/docs", description: "Documentation" },
  ],
);
```

---

## 5. Give the agent context

Tell the agent what the user is currently doing so it answers in context. Sent
with every message:

```ts
ago.setContext("order-page", {
  name: "Order detail",
  description: "User is viewing an order",
  data: { orderId: "123", status: "shipped" },
});

// Re-evaluated on every send, great for live stores
// (cart / cartTotal() come from your outer scope or store):
ago.addDynamicContext("cart", () => ({
  name: "Cart",
  data: { itemCount: cart.length, total: cartTotal() },
}));

// One-liner to attach the current URL + page title:
ago.enableAutoPageContext();
```

Full details in [Client context](functions-and-context.md#client-context).

### Hold live state with `createStore`

Dynamic context and client-side functions usually need to read and update some
shared state (a form being filled in, a draft request, the current selection).
`createStore` is a tiny observable holder (`get` / `set` / `subscribe`) so the
agent's functions and your UI react to the same source of truth.

```ts
import { createStore } from "@useago/sdk";

const store = createStore({ items: [] as string[] });

// Push to your UI / analytics on every change:
store.subscribe((state) => render(state));

// Feed it to the agent, re-read on every send:
ago.addDynamicContext("cart", () => ({ name: "Cart", data: store.get() }));

// A registered function can mutate it; subscribers fire synchronously:
store.set({ items: [...store.get().items, "SKU-1"] });
```

#### Persist across reloads

Pass a `persist` option with a storage `key` and the store hydrates from
storage on creation and writes back on every `set`: no manual `subscribe`
plumbing. It defaults to `localStorage`; unavailable storage degrades to an
in-memory store, and a malformed saved snapshot falls back to the initial value.

```ts
const store = createStore({ items: [] as string[] }, { key: "cart" });
```

Pass a `storage` backend (anything with `getItem` / `setItem`) to swap
`localStorage`, e.g. `sessionStorage` or a test double:

```ts
const store = createStore(initial, { key: "request", storage: sessionStorage });
```

In React and Vue, read the same store reactively with `useAgoStore`
([React](../frameworks/react.md#7-reactive-external-state-useagostore) ·
[Vue](../frameworks/vue.md#7-reactive-external-state-useagostore)).

### Resume the visitor's last thread with `createConversationSession`

A returning visitor is identified by a single, stable **widget id**: the same id the
HTTP client sends as `X-User-Anon-Id`. This mirrors the frontend's `getOrGenerateWidgetId`:
one id, generated once and reused forever. Alongside it, the session caches the **last
active thread** (its id + the time of its last message) so resuming on reload is a pure
**front-side** decision: no backend call just to check whether the thread is still fresh.

```ts
import { createConversationSession } from "@useago/sdk";

const session = createConversationSession();

// Resume on load: front-only, no request (null when none / stale / undated):
const conversationId = session.getLastActiveThread() ?? undefined;
const reply = await ago.sendMessage(text, { conversationId });

// Record the thread once a turn completes (drives the sliding TTL):
session.setActiveThread(reply.conversationId, reply.createdAt);

session.clear();          // forget it, e.g. a "new chat" button
console.log(session.widgetId); // exposed for debugging / correlation
```

The widget id is read from (or written to) `ago_widget_id`, generating a UUID on first
use, **no per-agent key**. The cached thread lives under `ago_last_thread` and is only
resumed when its last message is within `ttlMs` (default **2h**, sliding); a thread that
is older (**or has no recorded last-message time**) is treated as stale and
`getLastActiveThread` returns `null`. Like `createStore` it defaults to `localStorage`
and is storage-injectable: pass `sessionStorage` for a tab-scoped session.

| Option      | Default            | Purpose                                                   |
| ----------- | ------------------ | --------------------------------------------------------- |
| `storage`   | `localStorage`     | Any `{ getItem, setItem }`; e.g. `sessionStorage`.        |
| `key`       | `"ago_widget_id"`  | Storage key for the widget id (shared with the HTTP client). |
| `widgetId`  | —                  | Adopt (and persist) an explicit visitor id.               |
| `threadKey` | `"ago_last_thread"`| Storage key for the cached last active thread.            |
| `ttlMs`     | `7200000` (2h)     | Max idle age (vs the recorded last-message time) to still resume, checked on the front. `Infinity` = never. |

> The vanilla widget wires this up for you: set `persistConversation` on
> [`mountChatWidget`](widget.md) and it resumes the last active thread automatically.

---

## 6. Tool calls, feedback and lifecycle

```ts
// Tool calls the agent surfaces (forms, confirmations); see events below
await ago.submitToolCallForm(toolCallId, { quantity: 3 });
await ago.confirmToolCall(toolCallId);
await ago.rejectToolCall(toolCallId);

// Thumbs up / down on an assistant message
await ago.submitFeedback(messageId, "positive");

// Change config at runtime (e.g. after login)
ago.updateConfig({ userJwt: token });

// Clean up listeners, functions and context
ago.destroy();
```

---

## 7. Events

`AgoClient` is an event emitter. Subscribe with `on`, drop with `off`, and use
`once` / `waitFor` for one-shot needs.

```ts
ago.once("message:complete", (m) => console.log("first reply", m.content));

const msg = await ago.waitFor("message:complete", { timeout: 10_000 });
```

| Event               | Payload                                                     |
| ------------------- | ----------------------------------------------------------- |
| `message:start`     | `{ conversationId, messageId }`                             |
| `message:chunk`     | `{ content, conversationId, messageId }`                    |
| `message:answer-complete` | `AgoMessage`: main answer done, follow-up replies may still be pending; fires before `message:complete` |
| `message:complete`  | `AgoMessage`                                                |
| `message:error`     | `{ error, conversationId?, messageId? }`                    |
| `conversation:loaded` | `Conversation`: full conversation loaded from the server (e.g. after a page reload) |
| `context:changed`   | `ContextSnapshot \| null`: client-side context changed     |
| `toolCall:received` | `ToolCallData`                                              |
| `toolCall:form`     | `ToolCallData` (only when `type === "form"`)                |
| `function:invoke`   | `{ invocationId, functionName, arguments, conversationId }` |
| `function:result`   | `{ invocationId, result, error? }`                          |
| `connection:status` | `{ connected }`                                             |

Prefer callbacks over raw events? See the
[streaming helpers and async generator](events-and-streaming.md).

---

## `AgoClient` API reference

### Messaging

- `sendMessage(content, options?)` → `Promise<AgoMessage>`
  - `options.conversationId?` · `options.agentId?` · `options.files?: File[]`

### Conversations

- `getConversations()` → `Promise<Conversation[]>`
- `getConversation(id)` → `Promise<Conversation>` (includes `messages`)
- `getMessages(conversationId)` → `Promise<AgoMessage[]>`

### Functions

- `registerFunction(definition)` / `registerFunction(name, handler, schema)`
- `register(definitionOrArray)`: short alias, accepts an array
- `unregisterFunction(name)` → `boolean`
- `getRegisteredFunctions()` → `ClientFunctionSchema[]`
- `registerNavigationFunction(navigate, routes)`

### Context

- `setContext(key, entry)` · `removeContext(key)`
- `addDynamicContext(key, provider)` · `removeDynamicContext(key)`
- `enableAutoPageContext()`
- `getContextSnapshot()` → `ContextSnapshot | null`
- `notifyContextChanged()`: re-emit `context:changed` with a fresh snapshot
  (for stateful helpers that mutate their own store)

### Tool calls & feedback

- `submitToolCallForm(toolCallId, formData)`
- `confirmToolCall(toolCallId)` · `rejectToolCall(toolCallId)`
- `submitFormCollector(destination, values)` → `Promise<unknown>`: relay form
  values through the backend to a named destination tool (used by
  `createFormCollector` in `{ via: "backend" }` mode)
- `submitFeedback(messageId, "positive" | "negative")`

### Events

- `on(event, handler)` · `off(event, handler)` · `once(event, handler)`
- `waitFor(event, { timeout? })` → `Promise<payload>`

### Lifecycle

- `updateConfig(partialConfig)`
- `destroy()`

---

## Key types

```ts
interface AgoMessage {
  id: string;
  conversationId: string;
  content: string;
  role: "user" | "assistant";
  status: "IN_PROGRESS" | "DONE" | "ERROR" | "TODO" | "CANCELED";
  agent?: AgoAgent;
  sources?: AgoSource[]; // knowledge-base citations
  toolCalls?: ToolCallData[];
  followUpReplies?: string[]; // suggested next questions
  createdAt: Date;
}

interface Conversation {
  id: string;
  title: string;
  lastMessageDate: Date;
  messages?: AgoMessage[];
}
```

All types are exported from `@useago/sdk`.

---

## Conversational forms

`createFormCollector(options)` builds a framework-agnostic form collector: it
registers `update_<name>` / `submit_<name>` client functions so the agent can
fill a form field-by-field during the conversation.

```ts
import { createFormCollector } from "@useago/sdk";

const collector = createFormCollector({
  name: "contact", // becomes update_contact / submit_contact
  description: "Collect the visitor's contact details",
  schema: {
    properties: {
      email: { type: "string", description: "Work email" },
      company: { type: "string" },
    },
    required: ["email"],
  },
  submit: { via: "backend", destination: "crm-webhook" }, // optional; default: collect only
  initialValues: { company: "ACME" },
});

collector.install(ago); // register functions + context on a client
```

- `submit` accepts `{ via: "client", url }` (a bare string is shorthand),
  `{ via: "backend", destination }` (the browser never sees the destination
  URL; the client calls `ago.submitFormCollector()`), or `false`/omitted to
  only collect values.
- Fields can declare `requiredWhen` conditions; requirements are re-evaluated
  as values change.
- `deriveFormStatus(schema, values)` → `FormCollectorStatus` computes which
  required fields are still missing, useful for custom UIs.
- React users: see `useFormCollector` in the [React guide](../frameworks/react.md).

---

## Advanced exports

These are exported from `@useago/sdk` for advanced integrations; most apps
never need them directly:

- `FunctionRegistry`: the registry behind `registerFunction`; useful to manage
  a function set outside of a client instance.
- `ClientContextRegistry`: the registry behind the context API
  (`setContext`, dynamic providers, snapshots).
- `EventEmitter`: the minimal typed emitter `AgoClient` extends.
- `logger`: the SDK's internal logger (silent unless enabled via
  `logger.enable()`; errors always log).

---

## Next steps

- [Client-side functions & context](functions-and-context.md)
- [Events & streaming](events-and-streaming.md)
- [Configuration & auth](configuration.md)
- [Testing](testing.md)
