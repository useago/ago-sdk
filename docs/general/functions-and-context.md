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

### Result size limit

Everything a handler returns goes into the LLM context, so the SDK caps the
serialized result at 50 KB by default. Over the cap, the agent receives a
flagged preview instead of the full payload:

```json
{ "truncated": true, "originalBytes": 412031, "maxBytes": 50000, "preview": "...", "hint": "..." }
```

A console warning fires at 20 KB (with `debug: true`) so you catch it in dev.
Tune the cap globally with `maxFunctionResultBytes` on the client config, or
per function:

```ts
defineFunction({
  name: "exportReport",
  maxResultBytes: 200_000, // this one is allowed to be big (Infinity disables)
  // ...
});
```

If you hit the cap, the fix is usually in the handler: return only the fields
the agent needs, add `limit`/filter parameters to the schema, or push the data
to the UI (page state) and return a short summary like `{ displayed: 25, total: 1200 }`.

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

### Keep the number of functions low

You can send up to **30** client functions with a message. Above that, the
request is rejected.

Stay well under the limit whenever you can. The more functions the agent has to
choose from, the harder it becomes to pick the right one: past **10** functions
in a single message, expect the agent to call the wrong function or miss the
right one more often. Register only the functions relevant to the current page
or state, and unregister the ones that no longer apply.

### Navigation shortcut

A common case (letting the agent move the user around) has a dedicated helper
that builds the function for you:

```ts
client.registerNavigationFunction(
  (path) => router.push(path),   // your navigate fn
  [
    { name: "pricing", path: "/pricing", description: "Pricing page" },
    { name: "docs", path: "/docs", description: "Documentation" },
    { name: "orderDetail", path: "/orders/:id", description: "One order's detail page" },
  ],
);
```

This registers a `navigateToPage` function whose `page` parameter is an enum of
your route names. React/Vue offer `useAgoNavigation(navigate, routes)` with
lifecycle cleanup.

Paths can contain `:param` placeholders. Each placeholder becomes an explicit
top-level argument of `navigateToPage` (`{ page: "orderDetail", id: "42" }`
navigates to `/orders/42`), so one route covers every detail page of an entity.
Values are URL-encoded. A call that misses a required param navigates nowhere
and returns an error telling the agent what to retry with. Placeholders cannot
be named `page` (that argument selects the route).

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

By default, the handler validates each field, applies it via `set()`, and
returns the result as an envelope:

```jsonc
{
  "success": false,
  "applied":   ["temperature"],   // field names that were changed
  "unchanged": ["status"],        // fields already holding that value
  "rejected":  { "model": "\"gpt-5\" is not an allowed value. Allowed values: ..." }
}
```

`applied` and `unchanged` are always present (as arrays of field names).
`rejected` is omitted when empty. `success` is `false` when any field is
rejected, `true` otherwise. Placeholders (`null`, `undefined`, and `""` on
non-clearable controls) are silently dropped and appear in no bucket.

Before calling `set()`, the SDK validates the declared type and enum. Unknown
control names are rejected with the list of available controls. A value that
matches the current `get()` value is skipped without calling `set()` and
reported as `unchanged`.

React/Vue offer `useAgoPageState(controls, opts?)` with lifecycle cleanup;
Angular exposes `agoService.registerPageStateFunction(...)`.

#### Clearing a string field

By default, `""` is treated as filler and dropped. To let the agent clear a
string field, mark it `clearable`:

```ts
{
  name: "searchQuery",
  description: "Free-text search filter",
  schema: { type: "string" },
  clearable: true,
  get: () => query,
  set: (v) => setQuery(v as string),
}
```

The SDK adds `Pass "" to clear it.` to the control's description for the agent,
and on enum controls adds `""` to the allowed values. `clearable` only affects
string controls; on other types it has no effect.

#### Tagged setter outcomes

A `set()` function can return a tagged result to reject a value or signal that
the field is already in the requested state:

```ts
set: (v) => {
  const match = availableModels.find((m) => m.name === v);
  if (!match) return { result: "rejected", reason: `No model named "${v}".` };
  if (match.id === currentModelId) return { result: "unchanged" };
  setModelId(match.id);
},
```

`{ result: "rejected", reason }` puts the field in `rejected` with the given
reason. `{ result: "unchanged" }` puts it in `unchanged` without calling the
React state setter. Returning nothing (void) means the value was applied. A
thrown or rejected promise remains a function execution error; it is not
converted into a per-field rejection.

### Return what the page displays

The envelope on its own tells the agent what happened to its arguments, not what
appeared on screen. Ask it to "find the user dupont" and it applies the filter
but cannot say who it found: the rows only reach it on the next message, as
context.

Add a `data` source and the rows come back as the result of the agent's own
call, in the same turn:

```ts
const { data: users, isFetching } = useQuery({
  queryKey: ["users", filters],
  queryFn: fetchUsers,
});

useAgoPageState(controls, {
  data: {
    description: "The users matching the current filters.",
    get: () => users ?? [],
    isLoading: () => isFetching,
  },
});
```

`setPageState` now returns `{ success, applied, unchanged, rejected?, data }`, and a second function
`readPageData` is registered: no parameters, changes nothing, returns `{ data }`.
That one answers "what's on screen?" without touching the page. Both disappear
when you unregister.

#### Telling the SDK when the work is done

A control change kicks off work, and the SDK has to wait for it. There are two
ways to say when it finished. They are not equivalent.

**Return a promise from `get()`.** You own the await, so the SDK is exact: it
resolves when your work resolves. No polling, no timing assumption. With
TanStack Query, `ensureQueryData` hands you that promise and shares the single
in-flight request with the UI, so the data is not fetched twice:

```ts
useAgoPageState(controls, {
  data: {
    description: "The users matching the current filters.",
    get: () => queryClient.ensureQueryData({
      queryKey: ["users", filters],
      queryFn: fetchUsers,
    }),
  },
});
```

**Or declare `isLoading`**, for data you cannot get a promise for. The SDK polls
it every 50 ms and treats two consecutive `false` readings as settled. That is a
heuristic: the flag has to be up within ~100 ms of the change, or the SDK
concludes the page settled and reads the previous rows. A query library that
flips `isFetching` during render makes it in time; a **debounced** fetch does
not, and the agent then answers with the previous search's results, silently.

If you do use it, pass `isFetching`, not `isLoading`: TanStack Query's
`isLoading` is only true on the very first load, so a background refetch would
look idle.

Both forms are bounded by `settleTimeoutMs` (10 s by default). On timeout the
SDK returns what the page has rather than holding the turn open. If `get()`
rejects, the agent is told the read failed instead of being handed an empty
page.

Two things to keep in mind:

- **Size.** The snapshot lands in the model's context. Over
  `maxResultBytes` (the client's `maxFunctionResultBytes`, 50 000 by default)
  the SDK keeps the first whole items that fit and adds a `truncation` field
  (`{ truncated, returnedItems, totalItems, hint }`) next to them. The counts
  are nested rather than merged into your snapshot so they can never overwrite
  a field of your own called `totalItems`. The verdict fields (`success`,
  `applied`, `unchanged`, `rejected`) always survive intact. Return the columns
  the agent needs, not your whole row objects.
- **Pause mode only.** The result travels back inside the turn only when
  `clientFunctionsMode` is `"pause"` (the default). In `"placeholder"` mode the
  turn is already over by then, so the agent will not see the data during the
  call that produced it; the SDK warns once if you declare `data` anyway.

The snapshot deliberately stays out of the `page-state:` context entry, which
keeps carrying control values only. Putting 200 rows in every message would cost
a lot for nothing: the data travels only when the agent asks for it.

The SDK also tells the agent **what changed**: on each message it diffs the page
state against the previous message and adds a `state:delta` entry listing the
fields that changed. A navigation (a different page) resets the baseline instead
of reporting a diff, so a page switch never shows up as a spurious change.

### Navigate then change the page in one go

A request like "open the invoices page and show only the overdue ones" needs two
steps: the agent navigates, then changes the new page's state. But the
destination page only registers its `setPageState` (and current state) once it
mounts, so the agent can't do both in a single turn.

`useAgoAutoContinueAfterNavigation()` closes the gap. Mount it once inside
`AgoProvider`:

```tsx
function AppShell() {
  useAgoNavigation(navigate, routes);
  useAgoPageState(controls);            // on each pilotable page
  useAgoAutoContinueAfterNavigation();  // once, near the provider
}
```

Outside React, the same behavior ships as a framework-agnostic helper. Attach it
once per client; it returns a detach function:

```ts
import { attachAutoContinueAfterNavigation } from "@useago/sdk";

const detach = attachAutoContinueAfterNavigation(client);
```

Angular wraps it as `agoService.enableAutoContinueAfterNavigation(options?)`,
which also returns the disable function (call it in `ngOnDestroy`).

How the gap is bridged depends on the client-functions mode:

- **Pause mode** (the default, `clientFunctionsMode: "pause"` —
  needs a backend with pause/resume support): the backend pauses the turn on the
  navigation call. The SDK submits the function result and resumes the SAME turn
  via `POST /messages/{id}/continue`; the hook only delays that resume until the
  destination's `useAgoPageState` registered. No extra prompt, no second turn,
  and the agent sees the real function results.

- **Placeholder mode** (legacy, `clientFunctionsMode: "placeholder"`, also what
  older backends without pause/resume support fall back to): when the navigating turn ends, the hook
  waits for the destination page to register, then sends a continuation message
  with `{ hidden: true }` — kept in the model's context, never displayed
  (`useMessages` and `ChatWidget` filter hidden messages). Without backend
  support for `hidden` the mechanism still works but the nudge shows as a message.

A paused turn also survives a full page reload: after `getConversation(...)`,
call `client.resumePendingClientFunctions(conversation)` to re-run the waiting
functions, submit their results, and resume the turn (opt-in, re-running a
navigation on reload navigates again). A call gated by the approval policy (see
below) is not re-run on reload either: `resumePendingClientFunctions` holds it
for `approveFunction` / `rejectFunction` and keeps the turn paused, exactly as on
the live stream.

### Observe invocations

```ts
client.on("function:invoke", ({ functionName, arguments: args }) =>
  console.log("Agent called", functionName, args),
);
client.on("function:result", ({ result, error }) =>
  console.log("Returned", result, error),
);
```

### Approval gate (ask before running)

In pause mode you can hold a client function call until the user approves it.
Set `approvalPolicy` on the config to gate calls by name (or anything on the
invocation), or mark a single function with `requiresApproval: true`. The two OR
together.

```ts
const client = new AgoClient({
  baseUrl: "https://playground.api.useago.com",
  agent: "your-agent",
  // Return true for calls the user must approve first.
  approvalPolicy: (inv) => inv.functionName === "deleteAccount",
});

client.on("function:awaiting-approval", ({ invocationId, functionName }) => {
  // Show your UI, then decide:
  if (userSaidYes) client.approveFunction(invocationId); // runs it, resumes the turn
  else client.rejectFunction(invocationId); // submits a rejection, agent sees the decline
});
```

A gated call stays at `WAITING_CLIENT`: the handler does not run and nothing is
submitted until `approveFunction(invocationId)`. `rejectFunction(invocationId)`
submits `{ approved: false, reason: "user_rejected" }` so the agent knows the
user declined, then lets the turn resume. This is a no-op in placeholder mode
(there is no paused turn to hold onto), so the call runs normally.

In React, `useAgoActivity` surfaces awaiting items with ready-made `approve` /
`reject` controls (see the [React guide](../frameworks/react.md)).

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
  stable?: boolean;     // constant for the whole conversation (see below)
}
```

### Stable context (prompt caching)

By default an entry is re-sent next to every new user message, which is right
for data that changes as the user acts (a cart, the current page). If an
entry's content never changes during a conversation (a schema, a capability
list, static instructions), mark it `stable: true`: the backend pins it right
after the system prompt, where LLM providers cache it across turns instead of
re-processing it on every message.

```ts
client.setContext("catalog", {
  name: "Product catalog",
  description: "The products the agent can talk about",
  data: { products: PRODUCTS },
  stable: true, // content is identical on every message
});
```

Only mark an entry stable when its content is byte-identical on every message.
A "stable" entry that changes between messages invalidates the provider's
cache for the whole conversation history, which costs more than leaving the
flag off. Form collectors do this automatically: the form's schema is
registered as a stable entry and only the live values/missing state is sent
per message.

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

### Activity ledger

Tell the agent what the user (or the agent) just did, so it can reason about
recent actions. Call `recordActivity` for meaningful user actions; the agent's
own client-function calls (navigation, page-state changes, custom functions) are
recorded automatically.

```ts
client.recordActivity({
  name: "order.shipped",
  summary: 'User changed order #123 from "Pending" to "Shipped"',
});
```

The recent window (last 10 by default, oldest dropped first) rides along as the
`activity:recent` context entry. Change the size with `maxActivityEntries` in the
config. `actor` defaults to `"user"`; keep `summary` short and high-signal (no raw
payloads or secrets). Each entry's `data` is size-clamped before it is stored (long
strings truncated with a `…[truncated N chars]` marker, large arrays capped), so one
event can't bloat the context. Read or clear the log with
`client.getRecentActivity()` / `client.clearActivity()`, observe it via
`client.on("activity:recorded", …)`, or use the React `useAgoActivityLog()` hook.

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
