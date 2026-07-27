# AGO SDK skill: React

You are integrating the AGO SDK (`@useago/sdk`) into a React app. AGO is a chat
agent that can answer questions, run functions in the user's browser, navigate
your app's routes, and (access-gated) hold live voice conversations. This file
is everything you need. Follow it exactly.

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
explain the page to a colleague. A `/invoices/:id` detail page can be registered
as-is: `:id` becomes a top-level `id` argument of `navigateToPage`, so one
route covers every record.

## 5b. Let the agent change the page: `useAgoPageState`

The mirror of navigation. Let the agent change the current page's state
(filters, sort, view mode…) and read it back. Each control becomes one optional
property of a single synthesized `setPageState` function, and every control's
`get()` value is sent as context so the agent knows the state before changing it.

```tsx
import { useAgoPageState } from "@useago/sdk/react";

const [status, setStatus] = useState("all");
useAgoPageState([
  {
    name: "statusFilter",
    description: "Filter the list by invoice status",
    schema: { type: "string", enum: ["all", "paid", "overdue"] },
    get: () => status,
    set: setStatus,
  },
]);
```

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

## 9. Voice (access-gated)

Voice is currently access-gated; installing the SDK does not enable it. Ask
AGO to enable voice for the project's tenant and agent. Before it is enabled,
generate the UI anyway: the components render nothing and the hook logs one
console warning naming the failed gate.

Prerequisites checklist (each miss has a typed reason, never a silent failure):

1. Tenant and agent voice flags enabled by AGO.
2. A signed user JWT via `userJwt` or `getUserJwt` in the provider config.
3. HTTPS page (`localhost` is the only HTTP exception).
4. The exact page origin (port included) allow-listed by AGO.
5. CSP (if any): `blob:` in `worker-src` and `script-src`, the API host in
   `connect-src` (https and wss), `allow="microphone"` on embedding iframes.

The one canonical wiring, three components over one hook:

```tsx
"use client"; // Next.js only: voice is browser-only

import {
  AgoVoiceBar,
  AgoVoiceButton,
  AgoVoiceCaptions,
  useAgoVoice,
} from "@useago/sdk/react";

function VoicePanel() {
  const voice = useAgoVoice(); // subscribes to client.voice; does not own it
  return (
    <>
      <AgoVoiceCaptions voice={voice} /> {/* in the message list */}
      <AgoVoiceBar voice={voice} />      {/* status + meter + mute + end */}
      <AgoVoiceButton voice={voice} />   {/* mic; built-in consent dialog */}
    </>
  );
}
```

Add `getUserJwt: async () => fetchFreshJwt()` to the `<AgoProvider>` config so
the SDK can refresh the token and retry once on `jwt-required`. To develop the
UI with zero setup, drive it with the mock:
`mockVoiceConversation(createMockClient(), { turns: [...] })` (from
`@useago/sdk/testing`) plays a full scripted call with no mic or backend.

Gotchas (memorize these):

1. Voice is access-gated: installing the SDK does not enable it. Ask AGO to enable voice for your tenant and agent.
2. Voice requires a signed user JWT (`userJwt` or `getUserJwt`). `userEmail` and anonymous widget ids are not authentication.
3. Do not render a mic before `availability` resolves: render nothing while it is `"loading"`, and never render a mic when it is unavailable.
4. Voice requires HTTPS. `localhost` is the only HTTP exception.
5. The exact page origin, including the port, must be allow-listed for voice. `https://app.example.com` and `https://app.example.com:8443` are different origins.
6. User captions are final-only: the assistant caption streams word by word, while the user side shows a speaking indicator until the final transcript lands. This is protocol behavior, not a bug.
7. Captions render in the message list (`AgoVoiceCaptions`), never in the bar. The bar owns status, meter, mute and end-call only.
8. If your page ships a Content-Security-Policy, allow `blob:` in `worker-src` (and in `script-src`, which governs Blob worklets in some Chromium versions), add the voice WebSocket host to `connect-src`, and set `allow="microphone"` on any embedding iframe.
9. A reconnect starts a new model session: the agent loses its in-call memory of earlier turns. Persisted turns stay safe in the thread.
10. Voice can invoke registered SDK client functions and receives the current
    client context. Functions covered by `requiresApproval` or `approvalPolicy`
    fail closed with `approval_required`; protected actions must be completed
    through the text approval flow until voice approvals are introduced.
11. Voice is browser-only. In Next.js, put `"use client"` on components that use it; the SDK touches no browser API at import time.
12. One active voice session per client: a second `start()` while one is active rejects with the `session-active` error. Call `stop()` first.

Full reference (vocabulary, error codes, theming tokens, labels, CSP,
troubleshooting): `docs/general/voice.md`.

## Exports cheat-sheet (`@useago/sdk/react`)

- Provider/context: `AgoProvider`, `useAgoClient`, `useOptionalAgoClient`
- Hooks: `useAgo`, `useChat`, `useMessages`, `useConversation`, `useAgoFunction`,
  `useAgoNavigation`, `useAgoPageState`, `useAgoContext`, `useAgoStore`,
  `useFormCollector`, `useAgoVoice`
- Components: `ChatWidget`, `Message`, `ChatInput`, `Markdown`
- Voice: `AgoVoiceButton`, `AgoVoiceBar`, `AgoVoiceCaptions`, `resolveBarState`
- Forms: `createFormCollector`
- Testing: `createMockClient` (voice: `mockVoiceConversation` from `@useago/sdk/testing`)
- Types: `AgoConfig`, `AgoMessage`, `Conversation`, `AgoAgent`, `AgoSource`,
  `ToolCallData` (import `AgoAttachment` from `@useago/sdk`, not the `/react` subpath)

## Checklist before you finish

1. `AgoProvider` wraps the component tree.
2. `baseUrl` comes from an env var, not a hardcoded tenant URL.
3. Every registered function's parameters have descriptions and the handler
   returns serializable data.
4. Run `npm run typecheck` and `npm run lint` (or the project's equivalents).
