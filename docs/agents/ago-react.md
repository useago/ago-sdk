# AGO SDK skill: React

You are integrating the AGO SDK (`@useago/sdk`) into a React app. AGO is a chat
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
real tenant URL. React `>=17` is an optional peer dependency of the SDK; the app
already provides it.

## Install

```bash
npm install @useago/sdk
```

## 1. Wrap the app in `<AgoProvider>`

The provider creates one `AgoClient` and shares it with every hook and component.

```tsx
import { AgoProvider } from "@useago/sdk/react";

function Root() {
  return (
    <AgoProvider baseUrl="https://playground.api.useago.com" agent="generic-guide">
      <App />
    </AgoProvider>
  );
}
```

It can also wire app-wide tools, pre-built helpers, and page context:

```tsx
<AgoProvider
  baseUrl={import.meta.env.VITE_AGO_BASE_URL}
  tools={[lookupOrder, cancelOrder]}        // registered app-wide
  helpers={{ copyToClipboard: true, showToast: (a) => toast(a.message) }}
  pageContext="auto"                         // auto-capture URL + title
>
  <App />
</AgoProvider>
```

Pass `client={myClient}` to bring your own client (handy in tests).

## 2. Fastest UI: `<ChatWidget>`

A complete, styled chat panel. Drop it anywhere under the provider.

```tsx
import { ChatWidget } from "@useago/sdk/react";

function Support() {
  return (
    <ChatWidget
      title="Support"
      welcomeMessage="Hi! How can I help?"
      placeholder="Ask anything..."
      height={600}
      allowFiles
    />
  );
}
```

Common props: `title`, `welcomeMessage`, `placeholder`, `allowFiles`, `height`,
`logoUrl`, `showAgentName`, `forms`, `onMessageSent`, `onMessageReceived`,
`onFollowUpClick`, `className`. When the agent returns follow-up suggestions the
widget renders them as clickable buttons (clicking sends the reply by default).

`ChatWidget` is a high-level component. For a custom interface, use `useChat`.

## 3. Custom UI with `useChat`

All-in-one state for a custom chat interface (composes `useMessages` +
`useConversation`).

```tsx
import { useChat } from "@useago/sdk/react";

function Chat() {
  const { messages, sendMessage, isLoading, error } = useChat();

  return (
    <div>
      {messages.map((m) => (
        <p key={m.id}><b>{m.role}:</b> {m.content}</p>
      ))}
      <button onClick={() => sendMessage("Hello!")} disabled={isLoading}>Send</button>
      {error && <p role="alert">{error.message}</p>}
    </div>
  );
}
```

`messages` updates token-by-token as the reply streams (the optimistic user
message is included). `sendMessage(content, files?)` resolves with the final
message or `null` on error.

Show the knowledge sources the agent retrieved via `m.sources` (an `AgoSource[]`,
each `{ id, title, url? }`):

```tsx
{m.sources?.map((s) => (
  <a key={s.id} href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a>
))}
```

Finer-grained hooks: `useMessages({ conversationId? })`,
`useConversation({ autoLoad? })`. All hooks read the client from context; pass
`{ client }` to override. Get the raw client with `useAgoClient()` (throws
outside a provider) or `useOptionalAgoClient()`.

## 4. Let the agent call your code: `useAgoFunction`

Registers a client-side function on mount, cleans it up on unmount.

```tsx
import { useAgoFunction } from "@useago/sdk/react";

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
```

Rules for functions:
- Every parameter property needs a `description`. The agent reads it to decide
  what to pass.
- `required` lists only the params the function truly needs.
- The handler must return serializable data (no DOM nodes, no circular refs).

Reuse a definition made with `defineFunction` from `@useago/sdk`:

```tsx
const lookupOrder = defineFunction({ name: "lookupOrder", /* ... */ });
useAgoFunction(lookupOrder);
```

## 5. Let the agent navigate: `useAgoNavigation`

Wire AGO into your router. The agent calls your `navigate`, so guards, auth
redirects, and lazy loading keep working.

Define each route once. React Router's `<Route>` has no `description` prop, so
keep one route table and read both the router and `useAgoNavigation` off it
instead of duplicating paths.

```tsx
import { Routes, Route, useNavigate } from "react-router-dom";
import { useAgoNavigation } from "@useago/sdk/react";

const ROUTES = {
  dashboard: { name: "dashboard", path: "/dashboard", description: "KPIs and recent activity" },
  invoices: { name: "invoices", path: "/invoices", description: "List and download invoices" },
} as const;

function AppShell() {
  const navigate = useNavigate();
  useAgoNavigation(navigate, Object.values(ROUTES)); // agent reads paths + descriptions

  return (
    <Routes>
      <Route path={ROUTES.dashboard.path} element={<Dashboard />} />
      <Route path={ROUTES.invoices.path} element={<Invoices />} />
    </Routes>
  );
}
```

The `description` is what the agent reads to pick a page. Write it like you'd
explain the page to a colleague. For a `/invoices/:id` detail page, keep the
`:id` route for rendering only and feed the agent concrete paths derived from your
data (`/invoices/123`).

## 6. Give the agent context: `useAgoContext`

Expose what the user is looking at, sent with every message.

```tsx
// Static, captured from props/state
useAgoContext({
  name: "Order detail",
  description: "The user is viewing a specific order",
  data: { orderId: order.id, status: order.status },
});

// Dynamic, re-evaluated on every send (fresh data from a store)
useAgoContext(() => ({ name: "App shell", data: { userId: store.getState().auth.userId } }));
```

## 7. Reactive external state: `useAgoStore`

If shared state lives in a core `createStore`, `useAgoStore` reads it reactively
(re-renders on every `store.set`). It is SSR-safe.

```tsx
import { createStore } from "@useago/sdk";
import { useAgoStore } from "@useago/sdk/react";

const cart = createStore({ items: [] as string[] });

function CartBadge() {
  const { items } = useAgoStore(cart);
  return <span>{items.length}</span>;
}
```

## 8. Events

Use the client from `useAgoClient()` with `on` / `off` in an effect:

```tsx
useEffect(() => {
  const handler = (m) => toast(`AGO: ${m.content}`);
  client.on("message:complete", handler);
  return () => client.off("message:complete", handler);
}, [client]);
```

Key events: `message:start`, `message:chunk` (`{ content }` per token),
`message:complete` (`AgoMessage`), `message:error`, `toolCall:received`,
`function:invoke`, `function:result`.

## Exports cheat-sheet (`@useago/sdk/react`)

- Provider/context: `AgoProvider`, `useAgoClient`, `useOptionalAgoClient`
- Hooks: `useAgo`, `useChat`, `useMessages`, `useConversation`, `useAgoFunction`,
  `useAgoNavigation`, `useAgoContext`, `useAgoStore`, `useFormCollector`
- Components: `ChatWidget`, `Message`, `ChatInput`, `Markdown`
- Forms: `createFormCollector`
- Testing: `createMockClient`
- Types: `AgoConfig`, `AgoMessage`, `Conversation`, `AgoAgent`, `AgoSource`,
  `ToolCallData`

## Checklist before you finish

1. `AgoProvider` wraps the component tree.
2. `baseUrl` comes from an env var, not a hardcoded tenant URL.
3. Every registered function's parameters have descriptions and the handler
   returns serializable data.
4. Run `npm run typecheck` and `npm run lint` (or the project's equivalents).
