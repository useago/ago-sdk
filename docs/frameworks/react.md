# React

Idiomatic React bindings: a provider, hooks for chat/messages/conversations,
declarative helpers for functions, navigation and context, plus ready-made UI
components.

```bash
npm install @useago/sdk react react-dom
```

```ts
import {
  AgoProvider,
  useChat,
  useAgoFunction,
  ChatWidget,
} from "@useago/sdk/react";
```

> React (`>=17`) is an optional peer dependency. The `@useago/sdk/react` entry
> only loads if React is installed.

---

## 1. Wrap your app in `<AgoProvider>`

The provider creates one `AgoClient` and shares it with every hook/component below.

```tsx
import { AgoProvider } from "@useago/sdk/react";

function Root() {
  return (
    <AgoProvider baseUrl="https://YOUR-DOMAIN.useago.com" agent="support-bot">
      <App />
    </AgoProvider>
  );
}
```

### Declarative config

The provider can wire app-wide tools, pre-built helpers and page context for you:

```tsx
import { AgoProvider } from "@useago/sdk/react";
import { lookupOrder, cancelOrder } from "./agoFunctions";

<AgoProvider
  baseUrl="https://YOUR-DOMAIN.useago.com"
  tools={[lookupOrder, cancelOrder]}     // registered app-wide
  helpers={{
    copyToClipboard: true,               // use the built-in handler
    showToast: (args) => toast(args.message as string), // custom handler
  }}
  pageContext="auto"                      // auto-capture URL + title
>
  <App />
</AgoProvider>
```

### Bring your own client (e.g. tests)

```tsx
<AgoProvider client={myClient}>
  <App />
</AgoProvider>
```

---

## 2. The fastest UI: `<ChatWidget>`

A complete, styled chat panel. Drop it anywhere under the provider.

```tsx
import { ChatWidget } from "@useago/sdk/react";

function Support() {
  return (
    <ChatWidget
      title="Support"
      welcomeMessage="Hi! How can I help?"
      placeholder="Ask anything…"
      allowFiles
      height={600}
      logoUrl="/logo.svg"
      showAgentName
      onMessageSent={(text) => console.log("sent", text)}
      onMessageReceived={(m) => console.log("received", m.content)}
    />
  );
}
```

| Prop | Type | Default |
| --- | --- | --- |
| `client?` | `AgoClient` | from provider |
| `conversationId?` | `string` | — |
| `title?` | `string` | `"Chat"` |
| `welcomeMessage?` | `string` | greeting |
| `placeholder?` | `string` | `"Type a message..."` |
| `allowFiles?` | `boolean` | `false` |
| `height?` | `string \| number` | `500` |
| `logoUrl?` | `string` | — |
| `showAgentName?` | `boolean` | `false` |
| `forms?` | `Array<CreateFormCollectorOptions \| LoadFormCollectorOptions>` | — |
| `onFollowUpClick?` | `((reply) => void) \| false` | sends the reply |
| `className?` | `string` | `""` |
| `onMessageSent?` | `(content) => void` | — |
| `onMessageReceived?` | `({ id, content }) => void` | — |

### Suggested replies

When the agent returns follow-up suggestions, the widget renders them as
buttons below the message. By default clicking one sends it as the next user
message. Pass `onFollowUpClick` to handle clicks yourself, or
`onFollowUpClick={false}` to render them non-interactive.

### Conversational forms (form creator)

Pass `forms` to let the agent collect and submit a structured form during the
chat. Each entry is installed as a form collector (see `createFormCollector` /
`useFormCollector`): the agent gets `update_<name>` / `submit_<name>` functions
plus a dynamic context telling it that it is collecting information, carrying the
full form schema (including the `requiredWhen` conditions for conditional fields),
the data collected so far, and which required fields are still missing.

```tsx
<ChatWidget
  title="Book a demo"
  welcomeMessage="Hi! Tell me a bit about your team and I'll set up a demo."
  forms={[
    {
      name: "demo_request",
      description: "A request to book a product demo.",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          company: { type: "string" },
          teamSize: { type: "number" },
        },
        required: ["name", "email", "company"],
      },
      // Relay to a server-configured destination (URL + secret stay server-side):
      submit: { via: "backend", destination: "demo_webhook" },
    },
  ]}
/>
```

> Keep the `forms` array stable (declare it outside render or memoize it) — the
> collectors are reinstalled when a form's name, schema, description, or submit
> target changes. For full control over the live form state (e.g. a side panel
> that updates as fields fill in), use the `useFormCollector` hook directly
> instead of the `forms` prop.

To keep the schema in the backend instead of inline, pass an entry with just a
`name` (`{ name: "demo_request" }`): the widget fetches the definition via
`loadFormCollector`. The same works with the hook — `useFormCollector({ name })`
fetches the definition and exposes `loading` until it resolves.

Building your own UI? The widget is composed from exported building blocks you
can reuse: **`<Message>`** (accepts `onFollowUpClick`), **`<ChatInput>`** and
**`<Markdown content={...} />`** (GitHub-flavored markdown, zero external CSS).

---

## 3. Custom UI with `useChat`

All-in-one state for a custom chat interface — composes `useMessages` +
`useConversation`.

```tsx
import { useChat } from "@useago/sdk/react";

function Chat() {
  const {
    messages,
    sendMessage,
    isLoading,
    error,
    conversations,
    selectConversation,
    startNewConversation,
  } = useChat();

  return (
    <div>
      {messages.map((m) => (
        <p key={m.id}><b>{m.role}:</b> {m.content}</p>
      ))}
      <button onClick={() => sendMessage("Hello!")} disabled={isLoading}>
        Send
      </button>
      {error && <p role="alert">{error.message}</p>}
    </div>
  );
}
```

`messages` updates token-by-token as the reply streams in (optimistic user
message included). `sendMessage(content, files?)` returns the final message or
`null` on error.

### Finer-grained hooks

| Hook | Returns |
| --- | --- |
| `useMessages({ conversationId? })` | `{ messages, isLoading, error, sendMessage, clearMessages, conversationId }` |
| `useConversation({ autoLoad? })` | `{ conversations, currentConversation, isLoading, error, selectConversation, startNewConversation, refreshConversations }` |
| `useChat(options)` | both of the above combined |

All hooks read the client from context by default; pass `{ client }` to override.

### Need the raw client?

```tsx
import { useAgoClient } from "@useago/sdk/react";

const client = useAgoClient(); // throws if outside <AgoProvider>
// or useOptionalAgoClient() → AgoClient | null
```

---

## 4. Let the agent call your code: `useAgoFunction`

Registers a client-side function on mount and cleans it up on unmount.

```tsx
import { useAgoFunction } from "@useago/sdk/react";

function OrdersPanel() {
  useAgoFunction({
    name: "lookupOrder",
    description: "Look up an order by ID",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Order ID" } },
      required: ["id"],
    },
    handler: async (args) => fetchOrder(args.id as string),
  });

  return <OrdersTable />;
}
```

Reuse a definition created with `defineFunction`:

```tsx
import { defineFunction } from "@useago/sdk";

const lookupOrder = defineFunction({ name: "lookupOrder", /* … */ });
useAgoFunction(lookupOrder);
```

See [Client-side functions](../general/functions-and-context.md#client-side-functions) for
schema details and the catalogue of pre-built helpers.

---

## 5. Let the agent navigate: `useAgoNavigation`

Wire AGO into your router. Works great with `react-router`'s `useNavigate`.

```tsx
import { useAgoNavigation } from "@useago/sdk/react";
import { useNavigate } from "react-router-dom";

function AppShell() {
  const navigate = useNavigate();
  useAgoNavigation(navigate, [
    { name: "dashboard", path: "/dashboard", description: "Main dashboard" },
    { name: "settings", path: "/settings", description: "User settings" },
  ]);
  return <Outlet />;
}
```

---

## 6. Give the agent context: `useAgoContext`

Expose what the user is looking at — sent with every message. A unique key is
generated per component via `useId()`.

```tsx
import { useAgoContext } from "@useago/sdk/react";

// Static object — captured from props/state
function OrderPage({ order }) {
  useAgoContext({
    name: "Order detail",
    description: "The user is viewing a specific order",
    data: { orderId: order.id, status: order.status },
  });
  return <OrderView order={order} />;
}

// Dynamic function — evaluated on every send (fresh data from a store)
function App() {
  useAgoContext(() => ({
    name: "App shell",
    data: { userId: store.getState().auth.userId },
  }));
}

// Share/reference context with an explicit key
useAgoContext({ name: "Sidebar filter", data: { filter } }, "sidebar-filter");
```

---

## 7. Reactive external state: `useAgoStore`

If you hold shared UI/request state in a core [`createStore`](../general/core.md#hold-live-state-with-createstore)
(handy when client-side functions and your components mutate the same value),
`useAgoStore` reads it reactively — the component re-renders on every `store.set`.
It's a thin `useSyncExternalStore` wrapper, so it's SSR-safe and batches correctly.

```tsx
import { createStore } from "@useago/sdk";
import { useAgoStore } from "@useago/sdk/react";

const cart = createStore({ items: [] as string[] });

function CartBadge() {
  const { items } = useAgoStore(cart); // re-renders when the store changes
  return <span>{items.length}</span>;
}

// Mutate through the store — from anywhere, including a registered AGO function:
cart.set({ items: [...cart.get().items, "SKU-1"] });
```

---

## 8. Subscribe to events

Use the client directly from `useAgoClient()` and the standard
`on` / `off` API inside an effect:

```tsx
import { useEffect } from "react";
import { useAgoClient } from "@useago/sdk/react";

function Notifier() {
  const client = useAgoClient();
  useEffect(() => {
    const handler = (m) => toast(`AGO: ${m.content}`);
    client.on("message:complete", handler);
    return () => client.off("message:complete", handler);
  }, [client]);
  return null;
}
```

---

## Full example

A runnable React example lives in [`examples/simple-react`](../examples/simple-react).

---

## Exports cheat-sheet (`@useago/sdk/react`)

- **Provider/context:** `AgoProvider`, `useAgoClient`, `useOptionalAgoClient`
- **Hooks:** `useAgo`, `useChat`, `useMessages`, `useConversation`,
  `useAgoFunction`, `useAgoNavigation`, `useAgoContext`, `useAgoStore`,
  `useFormCollector`
- **Components:** `ChatWidget`, `Message`, `ChatInput`, `Markdown`
- **Forms:** `createFormCollector` (+ `CreateFormCollectorOptions`, `SubmitConfig`, …)
- **Testing:** `createMockClient`
- **Types:** `AgoConfig`, `AgoMessage`, `Conversation`, `AgoAgent`, `AgoSource`,
  `ToolCallData`, plus per-export prop/option types

See also: [Client functions & context](../general/functions-and-context.md) ·
[Testing](../general/testing.md) · [Configuration](../general/configuration.md)
