# Getting started

The fastest path from `npm install` to a working AGO chat. In about five minutes
you'll: **(1)** send a message and stream a real reply, **(2)** plug the agent
into your existing routes so it can change pages, and **(3)** understand what
else the SDK can do.

Every snippet below points at a live, ready-to-use endpoint and demo agent so
you can copy, paste, and run without setting anything up:

```
baseUrl: https://playground.api.useago.com
agent:   generic-guide
```

> Swap these for your own `https://YOUR-DOMAIN.api.useago.com` and agent slug
> once you have a tenant. They're the only values you ever need to change.

```bash
npm install @useago/sdk
```

---

## 1. Send a message, see a response

This is the whole SDK in one screen. The reply streams in token-by-token through
events; `sendMessage` resolves with the finished message.

```ts
import { AgoClient } from "@useago/sdk";

const ago = new AgoClient({
  baseUrl: "https://playground.api.useago.com",
  agent: "generic-guide",
});

// Stream the answer as it arrives (Node; in the browser use e.g.
// outputEl.textContent += content, see the core guide)
ago.on("message:chunk", ({ content }) => process.stdout.write(content));

const reply = await ago.sendMessage("What can you do?");
console.log("\n\nDone:", reply.status);
```

Run it and watch the answer print out live. That's a complete integration.

**Keep the conversation going** by reusing the `conversationId`:

```ts
const first = await ago.sendMessage("Hi");
await ago.sendMessage("Tell me more", { conversationId: first.conversationId });
```

Prefer not to import a framework? The same three lines work in the browser, in
Node 18+, or in a `<script>` tag. → Full reference: [Core SDK](core.md).

### The zero-build version (just a `<script>`)

No bundler, no `npm install`. Drop a styled chat panel onto any page:

```html
<div id="chat"></div>
<script type="module">
  import { mountChatWidget } from "https://esm.sh/@useago/sdk@1/widget";

  mountChatWidget("#chat", {
    config: { baseUrl: "https://playground.api.useago.com", agent: "generic-guide" },
    title: "Ask me anything",
    welcomeMessage: "Hi! How can I help?",
  });
</script>
```

→ Full reference: [Embeddable widget](widget.md).

---

## 2. Plug it into your existing routes: pages that change

The agent's superpower is that it can drive **your** app. You already have a
router and pages; describe them to the agent and a message like *"show me my
invoices"* actually navigates the user there.

### In an app you already have

`npm install @useago/sdk` is the only new dependency: the React bindings use
the `react` you already have (>=17), and your router stays yours; the SDK never
depends on `react-router-dom`.

Nothing to restructure. Find the layout component that already calls
`useNavigate` (or add the hook to it) and list your existing routes:

```tsx
import { Outlet, useNavigate } from "react-router-dom";
import { useAgoNavigation } from "@useago/sdk/react";

// Your existing layout. Only the useAgoNavigation call is new.
function AppLayout() {
  const navigate = useNavigate();

  useAgoNavigation(navigate, [
    { name: "dashboard", path: "/dashboard", description: "KPIs and recent activity" },
    { name: "invoices", path: "/invoices", description: "List, search and download invoices" },
    { name: "customers", path: "/customers", description: "Customer directory and detail pages" },
    { name: "settings", path: "/settings", description: "Account, billing and team settings" },
  ]);

  return <Outlet />; // your existing routes render as before
}
```

Three things to know:

- The `description` is what the agent reads to pick the right page, so write it
  for the agent the way you'd explain the page to a colleague.
- The agent calls **your** `navigate` function. Route guards, auth redirects,
  lazy loading and nested layouts keep working exactly as they do today.
- `useAgoNavigation` registers on mount and cleans up on unmount, so scoping it
  to a section of your app (e.g. only the logged-in area) is just a matter of
  where you call it.

Same idea in other stacks: pass `router.push` in
[Vue](../frameworks/vue.md), `Router.navigate` in
[Angular](../frameworks/angular.md), or any `(path) => void` function with
[`registerNavigationFunction`](core.md#4-let-the-agent-run-code-in-the-browser)
in plain TypeScript.

### Full runnable version (new app)

Starting from scratch instead? Here is the complete app. (`react`, `react-dom`
and `react-router-dom` are your app's dependencies, not the SDK's; the SDK only
needs them installed to use its React bindings.)

```bash
npm install @useago/sdk react react-dom react-router-dom
```

```tsx
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { AgoProvider, ChatWidget, useAgoNavigation } from "@useago/sdk/react";
import About from "./pages/About";
import Features from "./pages/Features";

// Tell the agent which routes exist and what each one is for.
const ROUTES = [
  { name: "home", path: "/", description: "Home page" },
  { name: "about", path: "/about", description: "About us, mission and values" },
  { name: "features", path: "/features", description: "List of product features" },
];

function Shell() {
  const navigate = useNavigate();

  // One line: the agent can now move the user between pages.
  useAgoNavigation(navigate, ROUTES);

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <ChatWidget
        title="AGO Assistant"
        welcomeMessage='Try: "take me to the features page"'
        height={500}
      />
      <div>
        <nav style={{ display: "flex", gap: 12 }}>
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/about">About</NavLink>
          <NavLink to="/features">Features</NavLink>
        </nav>
        <Routes>
          <Route path="/" element={<p>Welcome home.</p>} />
          <Route path="/about" element={<About />} />
          <Route path="/features" element={<Features />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AgoProvider baseUrl="https://playground.api.useago.com" agent="generic-guide">
        <Shell />
      </AgoProvider>
    </BrowserRouter>
  );
}
```

Type *"take me to the features page"* in the chat and the route changes. Ask
*"what's this app about?"* and the agent reads your route descriptions to answer
or navigate. `useAgoNavigation` auto-registers on mount and cleans up on unmount.

### Or clone a running example

The repo ships runnable examples pre-configured against the demo backend
(`https://playground.api.useago.com`, agent `generic-guide`), so they answer
immediately:

```bash
git clone https://github.com/useago/ago-sdk.git
cd ago-sdk && npm install && npm run build   # build the SDK once
cd examples/simple-react
npm install && npm run dev
```

[`examples/simple-react`](../../examples/simple-react) is the full version of
this page: router navigation, custom functions, a live function-call log panel,
and a conversational form. There is one example per stack in
[`examples/`](../../examples/): React, Vue, Angular, plain TypeScript, and
no-build HTML.

→ Full reference: [React bindings](../frameworks/react.md).

---

## 3. What you can do: the map

You've now seen the two ends of the SDK: **send a message** and **let the agent
act on your app**. Everything else builds on those two ideas.

### Talk to the agent

| Want to… | Use | Guide |
| --- | --- | --- |
| Send a message & stream the reply | `sendMessage` + `message:chunk` | [Core](core.md#2-send-a-message-and-stream-the-reply) |
| Drop in a ready-made chat UI (React) | `<ChatWidget>` | [React](../frameworks/react.md#2-the-fastest-ui-chatwidget) |
| Drop in a chat UI with no build step | `mountChatWidget` | [Widget](widget.md) |
| Build a fully custom UI | `useChat` / `useMessages` | [React](../frameworks/react.md#3-custom-ui-with-usechat) |
| List & resume past conversations | `getConversations` / `conversationId` | [Core](core.md#3-conversations) |
| Attach files | `sendMessage(text, { files })` | [Core](core.md#file-attachments) |

### Let the agent act on your app

| Want the agent to… | Use | Guide |
| --- | --- | --- |
| Run your code in the browser | `registerFunction` / `useAgoFunction` | [Functions & context](functions-and-context.md#client-side-functions) |
| Navigate the user around | `registerNavigationFunction` / `useAgoNavigation` | [React](../frameworks/react.md#5-let-the-agent-navigate-useagonavigation) |
| Know what the user is looking at | `setContext` / `useAgoContext` | [Functions & context](functions-and-context.md#client-context) |
| Collect a form during the chat | `createFormCollector` / `forms` prop | [Core](core.md#conversational-forms) |
| Use pre-built actions (toast, copy…) | `helpers` | [Functions & context](functions-and-context.md#client-side-functions) |

### Tools for building & shipping

| Want to… | Use | Guide |
| --- | --- | --- |
| Subscribe to the raw message stream | `on` / `waitFor` / async generator | [Events & streaming](events-and-streaming.md) |
| Unit-test without a backend | `createMockClient` | [Testing](testing.md) |
| Debug DOM/CSS in the browser | `initDevPanel` | [Dev tools](devtools.md) |
| Set auth, identity, headers | `AgoConfig` | [Configuration & auth](configuration.md) |

### Pick your stack

The core is framework-agnostic; each framework adds idiomatic bindings over the
same `AgoClient`.

| Stack | Guide |
| --- | --- |
| Plain JavaScript / TypeScript | [Core](core.md) |
| React | [React](../frameworks/react.md) |
| Vue 3 | [Vue](../frameworks/vue.md) |
| Angular | [Angular](../frameworks/angular.md) |
| Embeddable `<script>` widget | [Widget](widget.md) |

---

## Next steps

1. **Point it at your tenant.** Replace `https://playground.api.useago.com` with your
   own `baseUrl` and (optionally) set a default `agent`. See [Configuration](configuration.md).
2. **Give the agent powers.** Register a function or two so it can act, not just
   answer. See [Functions & context](functions-and-context.md).
3. **Ship a UI.** `<ChatWidget>` for React, `mountChatWidget` for anything else.
