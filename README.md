# @useago/sdk

[![npm version](https://img.shields.io/npm/v/@useago/sdk.svg)](https://www.npmjs.com/package/@useago/sdk)
[![types](https://img.shields.io/npm/types/@useago/sdk.svg)](https://www.npmjs.com/package/@useago/sdk)

**The customer-facing agent platform for your product.**

AGO embeds AI agents directly into your frontend stack: React, Vue, Angular or
plain TypeScript. Send messages, stream responses, expose frontend actions, and
let agents guide users, trigger workflows, or operate **your** UI.

Internal agent platforms help employees work faster. Customer-facing agents are
a different problem. They have to be reliable, safe, measurable, brand-aligned,
and integrated into the product experience.

AGO provides the operating layer behind the SDK: business and user context, tool
orchestration, evaluations, quality monitoring, security controls, human
fallback, and continuous improvement. Your team ships product-native agents that
resolve customer needs, without rebuilding the full customer-facing agent platform.

> [!TIP]
> **Using Claude Code, Codex, or Cursor?** You don't have to read these docs.
> The full documentation lives in a single file built for coding agents. Paste
> this into your agent and let it do the integration:
>
> ```text
> Install the AGO chat SDK in this app: npm install @useago/sdk
> Then read https://raw.githubusercontent.com/useago/ago-sdk/refs/heads/main/llms-full.txt
> and wire up a working chat against the public demo agent:
> baseUrl https://playground.api.useago.com, agent generic-guide.
> It answers straight away, with no signup and no API key.
> ```

In two minutes you'll have a working chat on your page and an agent that can
navigate your app. The quickstart below uses **React**; every other stack gets
the same two steps through its own guide:

| Stack | Guide |
| --- | --- |
| <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/react/react-original.svg" width="14" /> React | **you're reading it**, just scroll down |
| <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/vuejs/vuejs-original.svg" width="14" /> Vue 3 | [Vue guide](docs/frameworks/vue.md) |
| <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/angular/angular-original.svg" width="14" /> Angular | [Angular guide](docs/frameworks/angular.md) |
| <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/typescript/typescript-original.svg" width="14" /> Plain JavaScript / TypeScript | [Core guide](docs/general/core.md) |
| <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/html5/html5-original.svg" width="14" /> Any website, no build step (`<script>`) | [Widget guide](docs/general/widget.md) |

## <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/react/react-original.svg" width="22" /> Try it in 30 seconds

```bash
npm install @useago/sdk react react-dom
```

The SDK has no framework dependency of its own. The React bindings need `react`
and `react-dom` (>=17): already there in an existing React app, so you can drop
them from the command above.

```tsx
// App.tsx
import { AgoProvider, ChatWidget } from "@useago/sdk/react";

export default function App() {
  return (
    <AgoProvider baseUrl="https://playground.api.useago.com" agent="generic-guide">
      <ChatWidget title="AGO" welcomeMessage="Ask me anything!" height={500} />
    </AgoProvider>
  );
}
```

Start your dev server. A chat panel renders on the page; type a message and
watch the reply stream in. That's a complete integration. (This is the public
demo account: `https://playground.api.useago.com` with agent `generic-guide`. It
needs no signup and no API key. Swap `baseUrl` and `agent` for your own once you
have a tenant.)

`ChatWidget` is the high-level component to get started in minutes. Everything it
does is also exposed through hooks and APIs (`useChat`, `useMessages`, the raw
client, events), so when you outgrow the default panel you can drop down and build
the exact experience you want. The example below renders one piece of that.

## Let the agent drive your existing routes

This is the part existing apps care about. You already have a router and pages;
describe them to the agent and *"show me my invoices"* actually navigates there.
One hook in the layout you already have, nothing to restructure:

```tsx
import { Outlet, useNavigate } from "react-router-dom";
import { useAgoNavigation } from "@useago/sdk/react";

// Your existing layout component. Only the hook is new.
function AppLayout() {
  const navigate = useNavigate();

  useAgoNavigation(navigate, [
    { name: "dashboard", path: "/dashboard", description: "KPIs and recent activity" },
    { name: "invoices", path: "/invoices", description: "List, search and download invoices" },
    { name: "invoiceDetail", path: "/invoices/:id", description: "One invoice's detail page" },
    { name: "settings", path: "/settings", description: "Account, billing and team settings" },
  ]);

  return <Outlet />; // your existing routes render as before
}
```

Each route needs a `name`, its existing `path`, and a `description` the agent
uses to pick the right page. Paths can contain `:param` placeholders: the agent
fills them in (*"open invoice 42"* navigates to `/invoices/42`), so one route
covers every detail page. It calls **your** `navigate` function, so route
guards, auth and layouts keep working exactly as they do today.
`react-router-dom` here is *your* router, not an SDK dependency:
`useAgoNavigation` accepts any `(path: string) => void` function.

## Let the agent change the page

The mirror of navigation. Same idea, applied to the page the user is already on:
describe its editable state (filters, sort, view mode…) and *"show me only the
overdue ones, newest first"* actually updates the view. The agent also reads the
current state, so it knows what to change.

```tsx
import { useAgoPageState } from "@useago/sdk/react";

function InvoiceList() {
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("newest");

  useAgoPageState([
    {
      name: "statusFilter",
      description: "Filter invoices by status",
      schema: { type: "string", enum: ["all", "paid", "overdue"] },
      get: () => status,   // current value → the agent sees it
      set: setStatus,      // the agent changes it
    },
    {
      name: "sort",
      description: "Sort order of the list",
      schema: { type: "string", enum: ["newest", "oldest"] },
      get: () => sort,
      set: setSort,
    },
  ]);

  return /* your existing list, driven by status + sort */;
}
```

Each control becomes one optional property of a single `setPageState` function,
so the agent changes only what the user asked for. The current value from each
`get()` is sent with every message, so the agent knows the state before it
changes it. The SDK validates type and enum before calling `set()`, skips values
that match the current `get()`, and drops placeholders (`null`, `undefined`,
`""`). The result reports each field in `applied`, `unchanged`, or `rejected`.
Vue and Angular have the same helper. See
[Page state shortcut](docs/general/functions-and-context.md#page-state-shortcut)
for `clearable`, tagged setter outcomes, and the full result envelope.

Add a `data` source and the agent also gets back **what the page now shows**, as
the result of its own call, so it can answer "did you find dupont?" in the same
turn:

```tsx
const { data: invoices, isFetching } = useQuery({
  queryKey: ["invoices", status, sort],
  queryFn: fetchInvoices,
});

useAgoPageState(controls, {
  data: {
    description: "The invoices matching the current filters.",
    get: () => invoices ?? [],
    isLoading: () => isFetching,   // isFetching, not isLoading
  },
});
```

The SDK waits for `isLoading` to go false before reading, so the agent never
receives the previous search's rows, and it truncates a long list by whole rows
rather than sending a huge payload. Details in
[functions and context](docs/general/functions-and-context.md#return-what-the-page-displays).

## Turn a JavaScript function into an agent tool

Keep your application logic as a regular JavaScript function, then describe its
arguments with `defineFunction`. The description and JSON Schema tell the agent
when and how to call it:

```js
import { defineFunction } from "@useago/sdk";

async function getOrderStatus({ orderId }) {
  const response = await fetch(`/api/orders/${orderId}`);
  if (!response.ok) throw new Error("Order not found");

  const order = await response.json();

  return { orderId, status: order.status };
}

export const getOrderStatusTool = defineFunction({
  name: "getOrderStatus",
  description: "Get the current status of an order from its ID.",
  parameters: {
    type: "object",
    properties: {
      orderId: {
        type: "string",
        description: "The order ID shown to the user",
      },
    },
    required: ["orderId"],
  },
  handler: getOrderStatus,
});
```

Register the definition once to expose it to the agent. In React, pass it to
the provider:

```tsx
<AgoProvider
  baseUrl="https://api.example.com"
  agent="support-agent"
  tools={[getOrderStatusTool]}
>
  <ChatWidget />
</AgoProvider>
```

With the core client, use `client.registerFunction(getOrderStatusTool)`.
Whenever the agent calls the tool, the SDK runs your handler in the browser
with the generated arguments and sends its return value back to the agent. Keep
the return value small and structured so the agent can use it reliably.

## Let the user stop a long answer

`<ChatWidget>` already does this: while the agent answers, its send button turns
into a **Stop** button (pass `allowStop={false}` to opt out). In a custom UI, wire
the `stop` returned by `useChat` / `useMessages`:

```tsx
import { useChat } from "@useago/sdk/react";

function Chat() {
  const { messages, sendMessage, stop, isLoading } = useChat();

  return (
    <div>
      {messages.map((m) => (
        <p key={m.id}><b>{m.role}:</b> {m.content}</p>
      ))}
      {isLoading ? (
        <button onClick={() => void stop()}>Stop</button>
      ) : (
        <button onClick={() => sendMessage("Write me a long report")}>Send</button>
      )}
    </div>
  );
}
```

Stopping closes the stream **and** tells the backend to stop generating. Closing
the stream alone would not stop the agent: it would keep running and the full
answer would reappear on the next load. The text already produced stays on
screen, the message ends as `CANCELED`, and the pending `sendMessage` resolves
with that partial message instead of rejecting. Vue and Angular have the same
`stop`, and the vanilla `mountChatWidget` handle gained `stop()`. Details in
[Stop the answer](docs/general/core.md#stop-the-answer).

## Let the user say "this answer doesn't work"

Pass `feedback` and every finished answer gets a thumbs up / thumbs down. On a
thumbs-down, a panel asks what went wrong: four reason chips
(inaccurate, incomplete, information not found, technical issue) and a comment
box.

```tsx
<ChatWidget feedback />
```

```ts
// vanilla widget
mountChatWidget("#chat", { config, feedback: true });
```

The thumb is sent the moment it is clicked, so the signal survives a user who
ignores the panel. A bare rating is a reaction; a report with a reason or a
comment also lands in the AGO feedback dashboard, the analytics and the CSV
export, where someone can act on it.

Driving it yourself, from any framework:

```ts
await ago.submitFeedback(messageId, "negative", {
  reasons: ["inaccurate"],
  comment: "The price it quoted is from last year.",
});

// the whole chat, not one answer (attached to its last answer)
await ago.submitConversationFeedback(conversationId, "negative");
```

React and Vue have a `useFeedback()` hook/composable; React also exports the
`<MessageFeedback messageId={...} />` row for a custom message list. Details in
[Feedback](docs/general/widget.md#feedback).

## Show the source docs the agent retrieved

Each assistant message carries the knowledge sources it used in `m.sources`
(each one is `{ id, title, url? }`). Build your own chat with `useChat` and
render them as links to show the URL of every retrieved doc:

```tsx
import { useChat } from "@useago/sdk/react";

function Chat() {
  const { messages, sendMessage, isLoading } = useChat();

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          <p><b>{m.role}:</b> {m.content}</p>

          {m.sources?.length ? (
            <ul>
              {m.sources.map((s) => (
                <li key={s.id}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title || s.url}
                    </a>
                  ) : (
                    s.title
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
      <button onClick={() => sendMessage("Hello!")} disabled={isLoading}>
        Send
      </button>
    </div>
  );
}
```

**Next: the [Getting started guide](docs/general/getting-started.md)** has both
examples assembled into a running app, plus everything else the SDK can do, in
about 5 minutes.

## Or clone a running example

```bash
git clone https://github.com/useago/ago-sdk.git
cd ago-sdk && npm install && npm run build   # build the SDK once
cd examples/simple-react
npm install && npm run dev
```

The examples ship pre-configured against the demo account, so they answer
immediately. [`examples/`](examples/) has one per stack: React (with
react-router navigation), Vue, Angular, plain TypeScript, and no-build HTML.

---

## Docs

- [**Getting started**](docs/general/getting-started.md): send a message, wire the router, see the feature map
- [**Feature matrix**](docs/general/feature-matrix.md): everything that ships, per stack
- [**Functions & context**](docs/general/functions-and-context.md): let the agent run your code and see what the user sees
- [**Events & streaming**](docs/general/events-and-streaming.md): low-level hooks into the message stream
- [**Testing**](docs/general/testing.md): mock client for unit tests
- [**Configuration & auth**](docs/general/configuration.md): every `AgoConfig` option, headers, errors
- [**Custom domain (reverse proxy)**](docs/general/custom-domain.md): serve AGO from your own domain, same-origin

Full documentation: [ago.mintlify.app](https://ago.mintlify.app/)

---

<details>
<summary><strong>Package entry points</strong> (subpath exports)</summary>

The package is published with several subpath exports so bundlers only pull in
what you use:

| Import | Contents |
| --- | --- |
| `@useago/sdk` | Core client, types, functions, helpers, streaming, store, testing |
| `@useago/sdk/react` | React provider, hooks and components |
| `@useago/sdk/vue` | Vue plugin and composables |
| `@useago/sdk/angular` | Angular service and provider |
| `@useago/sdk/helpers` | Pre-built client functions only |
| `@useago/sdk/widget` | `window.AGO` widget config types |
| `@useago/sdk/devtools` | `initDevPanel`, an in-browser debug overlay (DOM/CSS) |
| `@useago/sdk/testing` | `createMockClient`, a mock client for tests |

ESM and CJS builds are both shipped, with full TypeScript declarations.

</details>

## Dependencies

The core SDK depends on nothing but the platform: `fetch` and `ReadableStream`,
so any modern browser or Node 18+. Framework packages are **optional peer
dependencies**; you only need the one whose bindings you import:

| You import | Needs | Notes |
| --- | --- | --- |
| `@useago/sdk` (core, widget, helpers, testing) | nothing | works everywhere |
| `@useago/sdk/react` | `react` + `react-dom` `>=17` | already present in any React app |
| `@useago/sdk/vue` | `vue` `>=3.3` | already present in any Vue 3 app |
| `@useago/sdk/angular` | nothing | no hard Angular dependency, works with any DI container |

Your router (`react-router-dom`, `vue-router`, Angular Router) is **never** an
SDK dependency: the navigation helpers just take your navigate function.

---

## License

[Apache 2.0](./LICENSE) · [Documentation](https://ago.mintlify.app/) · [Website](https://useago.com)
