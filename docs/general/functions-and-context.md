# Client-side functions & context

Two capabilities that turn AGO from a chatbot into an agent that acts inside
**your** app. Both work in every framework; this page is the canonical
reference, and the framework guides show the idiomatic wrappers.

- [Client-side functions](#client-side-functions): the agent runs code in the browser
- [Pre-built helpers](#pre-built-helpers): a catalogue of ready-made functions
- [Client context](#client-context): tell the agent what the user is doing

---

## Client-side functions

You expose functions (with a name, description and JSON-Schema parameters). The
SDK sends those schemas with each message; when the agent decides to call one,
the SDK runs your handler in the browser, then submits the result back so the
agent can continue. Great for: looking up data, mutating UI, navigation,
triggering app actions.

### Define a function

```ts
import { defineFunction } from "@useago/sdk";

export const lookupOrder = defineFunction({
  name: "lookupOrder",
  description: "Look up an order by its ID and return its status.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "The order ID" },
    },
    required: ["id"],
  },
  handler: async (args) => {
    // fetchOrder: your own API call
    const order = await fetchOrder(args.id as string);
    return { status: order.status, total: order.total }; // returned to the agent
  },
});
```

`defineFunction` is an identity helper: it just gives you typing and a reusable
object. The shape is:

```ts
interface ClientFunctionDefinition {
  name: string;        // unique
  description: string; // the LLM reads this to decide when to call it
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;            // "string" | "number" | "boolean" | "array" | ...
      description?: string;
      enum?: string[];
      default?: unknown;
    }>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}
```

> **Tip:** write descriptions for the model. A clear `description` (and per-field
> `description`) is what makes the agent call the function correctly. Return a
> small, structured object; it's fed straight back into the conversation.

### Register a function

```ts
// Single object (preferred)
client.registerFunction(lookupOrder);

// Short alias, also accepts an array
client.register([lookupOrder, cancelOrder]);

// Classic 3-arg form
client.registerFunction("lookupOrder", handler, { description, parameters });

// Remove it
client.unregisterFunction("lookupOrder");
```

Per framework:

| Framework | Idiomatic API |
| --- | --- |
| Core | `client.registerFunction(def)` / `client.register([...])` |
| React | `useAgoFunction(def)` (auto-cleanup) or `<AgoProvider tools={[…]}>` |
| Vue | `useAgoFunction(name, options)` (auto-cleanup) |
| Angular | `agoService.registerFunction(def)` |

### Navigation shortcut

A common case (letting the agent move the user around) has a dedicated helper
that builds the function for you:

```ts
client.registerNavigationFunction(
  (path) => router.push(path),   // your navigate fn
  [
    { name: "pricing", path: "/pricing", description: "Pricing page" },
    { name: "docs", path: "/docs", description: "Documentation" },
  ],
);
```

This registers a `navigateToPage` function whose `page` parameter is an enum of
your route names. React/Vue offer `useAgoNavigation(navigate, routes)` with
lifecycle cleanup.

It also registers a dynamic context entry ("Current page") that reports the page
the user is on (by route name, plus URL and title) on every message, so the agent
knows where it is after it navigates, not just how to navigate away. Call
`client.unregisterNavigationFunction()` to remove both the function and that
context.

### Page state shortcut

The mirror of navigation: instead of moving the user to another page, let the
agent change the state of the page they're on (filters, sort, view mode,
selection…) and read the current state back. One helper builds both halves.

```ts
client.registerPageStateFunction([
  {
    name: "statusFilter",
    description: "Filter the list by review status",
    schema: { type: "string", enum: ["all", "pending", "approved"] },
    get: () => filters.status,          // current value → context
    set: (v) => setFilters({ ...filters, status: v }), // apply the change
  },
  {
    name: "sort",
    description: "Sort order of the list",
    schema: { type: "string", enum: ["newest", "oldest"] },
    get: () => filters.sort,
    set: (v) => setFilters({ ...filters, sort: v }),
  },
]);

client.unregisterPageStateFunction(); // pass the functionName if you customised it
```

This does two things:

- Synthesizes **one** client function (`setPageState` by default; override with
  `{ functionName }`). Each control becomes one optional property, so the agent
  sets only the controls the user asked for and leaves the rest untouched.
- Registers a dynamic context entry ("Page state") reporting each control's
  current `get()` value, so the agent knows what to change. Controls without a
  `get()` are write-only and don't appear in context.

It's fire-and-forget: the handler applies each `set()` locally and returns
`{ success, applied }`. The new state reaches the agent through the context on
the next message. React/Vue offer `useAgoPageState(controls, opts?)` with
lifecycle cleanup; Angular exposes `agoService.registerPageStateFunction(...)`.

### Navigate then change the page in one go

A request like "open the invoices page and show only the overdue ones" needs two
steps: the agent navigates, then changes the new page's state. But the
destination page only registers its `setPageState` (and current state) once it
mounts, so the agent can't do both in a single turn.

`useAgoAutoContinueAfterNavigation()` closes the gap. Mount it once inside
`AgoProvider`. When the agent calls the navigation function and that turn ends,
it waits for the destination page's `useAgoPageState` to register, then sends a
hidden continuation message so the agent applies the state in a second turn. To
the user it is one gesture.

```tsx
function AppShell() {
  useAgoNavigation(navigate, routes);
  useAgoPageState(controls);            // on each pilotable page
  useAgoAutoContinueAfterNavigation();  // once, near the provider
  return <Outlet />;
}
```

The continuation is sent with `{ hidden: true }`: the backend keeps it in the
model's context but flags it so the UI never shows it (`useMessages` and
`ChatWidget` filter hidden messages). This needs backend support for the `hidden`
flag; without it the mechanism still works but the nudge shows as a message.

### Observe invocations

```ts
client.on("function:invoke", ({ functionName, arguments: args }) =>
  console.log("Agent called", functionName, args),
);
client.on("function:result", ({ result, error }) =>
  console.log("Returned", result, error),
);
```

---

## Pre-built helpers

The SDK ships a catalogue of common browser actions as ready-made function
definitions. Import them from `@useago/sdk` (or `@useago/sdk/helpers`), wire up a
handler where needed, and register.

| Helper | What it does | Handler needed? |
| --- | --- | --- |
| `showToast` | Show a toast notification | ✅ wire to your toast lib |
| `showNotification` | Browser `Notification` (asks permission) | built-in |
| `openUrl` | Open a URL in a new tab | built-in |
| `copyToClipboard` | Copy text to clipboard | built-in |
| `setTheme` | Set `data-theme` on `<html>` (light/dark/system) | built-in |
| `showConfirmDialog` | `window.confirm` and return the choice | built-in |
| `getUserLocation` | Geolocation (asks permission) | built-in |
| `scrollToElement` | Scroll to a CSS selector | built-in |
| `setLocalStorage` / `getLocalStorage` | Read/write `localStorage` | built-in |
| `highlightElement` | Outline an element (guided tours) | built-in |
| `submitForm` | Fill & submit an HTML form | built-in |
| `trackEvent` | Custom analytics event | ➖ logs to console by default |

### Wiring a handler

Some helpers ship a no-op/console default (`showToast`, `trackEvent`). Attach
your implementation without mutating the original with `withHandler`:

```ts
import { showToast, withHandler } from "@useago/sdk";

client.register(
  withHandler(showToast, (args) => {
    myToast(args.message as string); // myToast: your own toast handler
    return { shown: true };
  }),
);
```

In React you can wire helpers declaratively on the provider:

```tsx
<AgoProvider
  baseUrl="…"
  helpers={{
    copyToClipboard: true,                          // built-in handler
    showToast: (args) => toast(args.message as string), // custom
  }}
>
```

---

## Client context

Context is structured data describing the user's current situation. It's sent
with **every** message so the agent answers in context, without the user having
to explain where they are.

### Static context

```ts
client.setContext("order-page", {
  name: "Order detail",
  description: "User is viewing an order",
  data: { orderId: "123", status: "shipped" },
});

client.removeContext("order-page");
```

Shape:

```ts
interface ContextEntry {
  name?: string;        // human label, e.g. "Order detail"
  description?: string; // what this context represents
  data?: Record<string, unknown>; // structured data for the AI
}
```

### Dynamic context

A function evaluated on every send, perfect for data outside your render state
(global stores, refs, computed values). Return `null` to skip.

```ts
// cart / cartTotal(): a variable and helper from your outer scope or store
client.addDynamicContext("cart", () => ({
  name: "Cart",
  data: { itemCount: cart.length, total: cartTotal() },
}));

client.removeDynamicContext("cart");
```

### Auto page context

One call attaches the current URL + document title on every message:

```ts
client.enableAutoPageContext();
```

(In React, set `<AgoProvider pageContext="auto">`.)

### Per framework

| Framework | Idiomatic API |
| --- | --- |
| Core | `setContext` / `addDynamicContext` / `enableAutoPageContext` |
| React | `useAgoContext(entryOrFn, key?)` + `pageContext="auto"` |
| Vue | core API inside `onMounted` / `onUnmounted` |
| Angular | `agoService.getClient().setContext(…)` |

### Inspect what's being sent

```ts
const snapshot = client.getContextSnapshot();
// → { entries: { "order-page": { name, description, data }, … } } | null
```

---

See also: [Events & streaming](events-and-streaming.md) ·
[Core API](core.md) · [Testing](testing.md)
