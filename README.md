# @useago/sdk

[![npm version](https://img.shields.io/npm/v/@useago/sdk.svg)](https://www.npmjs.com/package/@useago/sdk)
[![types](https://img.shields.io/npm/types/@useago/sdk.svg)](https://www.npmjs.com/package/@useago/sdk)

**The agent layer for your frontend stack.** AGO's agents plug into React, Vue,
Angular or plain TypeScript like any other dependency: send a message, stream
the reply, and let the agent call **your** code and navigate **your** UI.

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
npm install @useago/sdk
```

The SDK has no framework dependency of its own. The React bindings need `react`
and `react-dom` (>=17): already there in an existing React app, otherwise
install them too.

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
watch the reply stream in. That's a complete integration. (`generic-guide` is a
public demo agent; swap `baseUrl` and `agent` for your own once you have a tenant.)

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
    { name: "settings", path: "/settings", description: "Account, billing and team settings" },
  ]);

  return <Outlet />; // your existing routes render as before
}
```

Each route needs a `name`, its existing `path`, and a `description` the agent
uses to pick the right page. It calls **your** `navigate` function, so route
guards, auth and layouts keep working exactly as they do today.
`react-router-dom` here is *your* router, not an SDK dependency:
`useAgoNavigation` accepts any `(path: string) => void` function.

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

The examples ship pre-configured against the demo backend, so they answer
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
