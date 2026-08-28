# Dev panel

`initDevPanel()` mounts a small in-browser overlay that helps you debug a
client-side integration: it lists the registered functions, renders the client's
live context snapshot as JSON (including every installed form collector's state),
and logs every `function:invoke` / `function:result` event as it happens, plus a
line each time a conversation is hydrated on reload. A second, separate "SSE event
log" panel records every raw message off the stream, so the high-volume stream
stays out of the main panel while you inspect the exact wire payload behind each reply.

> **Signature:** the panel reads everything from the client
> (`client.getContextSnapshot()`). It takes **no `store` option**: pass only
> `{ client }`. (Earlier drafts showed `initDevPanel({ store, client })`; a `store`
> argument is now ignored.)

It ships from a dedicated subpath so the DOM and CSS it carries are only pulled
into your bundle when you import it:

```ts
import { initDevPanel } from "@useago/sdk/devtools";
```

---

## Basic usage

Gate it behind a dev flag so it never ships to production:

```ts
import { AgoClient } from "@useago/sdk";
import { initDevPanel } from "@useago/sdk/devtools";

const client = new AgoClient({ /* … */ });
// Any form collectors you install on the client appear in the panel automatically.

const DEV = new URLSearchParams(location.search).has("dev");
if (DEV) initDevPanel({ client });
```

The panel mounts a fixed-position overlay (top-right by default). The JSON pane shows the
client's live context snapshot (including every installed form collector's state) and
re-renders after each function the agent calls; it also appends a log line for each
`function:invoke` and its result, and a `⟳ hydrated …` line whenever a conversation is
restored on reload. A second panel (pinned bottom-right) is the "SSE event log": it
appends one line per raw stream message (a leading tag plus the verbatim JSON) and
collapses independently of the main panel. Each panel's collapsed/expanded state is
remembered in `localStorage`.

### Cleanup

`initDevPanel` returns an idempotent disposer that removes its panels and
unsubscribes all event handlers. In a React effect, return it directly so
Strict Mode's simulated unmount/remount leaves exactly one connected panel:

```tsx
useEffect(() => {
  if (!new URLSearchParams(location.search).has("dev")) return;
  return initDevPanel({ client, enableFunctionRunner: true });
}, [client]);
```

Without the disposer, Strict Mode's first-mount cleanup destroys the
internally-created client (clearing its listeners), so the panel stays in the
DOM but stops receiving events. The second mount creates a new panel on the
live client while the disconnected ghost remains visible.

Calling the disposer outside React works the same way:

```ts
const dispose = initDevPanel({ client });
// later:
dispose(); // removes panels, unsubscribes events
```

### Reading the JSON pane

The pane renders the **whole** dynamic context, not just one form: every entry the
agent receives, keyed by name. A form collector created with `name: "credit"` registers
under `form:credit`, so its collected values are **nested**, not at the top level:

```jsonc
{
  "form:credit": {
    "name": "Form: credit",
    "data": {
      "values": { "locataire": "1" },  // ← the form's store lives here
      "missing": ["revenu"],
      "complete": false,
      "submitted": false
    }
  },
  // …any other context entries (cart, user, etc.) sit alongside it
}
```

So to inspect a form's store, drill into `form:<name>.data.values`.

---

## Options

```ts
interface DevPanelOptions {
  /**
   * The client to debug. Lists its registered functions, logs its function events,
   * and renders its live context snapshot, including every installed form
   * collector's state.
   */
  client: Pick<AgoClient, "on" | "off" | "getRegisteredFunctions" | "getContextSnapshot"> & {
    executeClientFunction?: AgoClient["executeClientFunction"];
  };
  /** Where to mount: a CSS selector, an Element, or document.body (default). */
  target?: string | Element;
  /** Which edge to pin to: "right" (default) or "left". Panels on the same side stack beside each other. */
  side?: "left" | "right";
  /** Caption shown in the header. Use it to tell panels apart when a page has several. */
  label?: string;
  /** Mount a local function runner (see below). Requires executeClientFunction on the client. */
  enableFunctionRunner?: boolean;
}
```

`client` is typed structurally, so a mock client from `@useago/sdk/testing`
works too. `executeClientFunction` is only required when `enableFunctionRunner`
is `true`; omit it for the default panel.

```ts
// Mount inside a specific container instead of document.body
initDevPanel({ client, target: "#debug-slot" });
```

---

## Local function runner

Pass `enableFunctionRunner: true` to add a runner section to the panel. It
executes registered client functions locally via `client.executeClientFunction`
and displays the result. Calls stay in the browser; nothing is submitted to the
agent backend.

```ts
if (DEV) initDevPanel({ client, enableFunctionRunner: true });
```

The runner shows a dropdown of registered functions, the selected function's
JSON Schema, a textarea for arguments (initialized to `{}`), and a Run button.
After execution it displays the result JSON, the UTF-8 byte count, and any
error. The function list refreshes on `context:changed`, `function:invoke`,
`function:result`, runner completion, and an explicit Refresh button, so it
tracks route changes when the page registers different functions per route
(e.g. different `setPageState` controls).

Parse and shape errors (non-object, non-JSON) are shown without calling the
function. The Run button disables while the call is pending to prevent double
submission.

The "JSON object" and "Function calls" diagnostic sections are independently
collapsible. The panel body scrolls within the viewport so the runner stays
reachable on smaller screens.

---

## With the vanilla widget

[`mountChatWidget`](widget.md) installs its form collectors on its own client, so they appear in
the panel automatically; just hand it the widget's `client`:

```ts
import { mountChatWidget } from "@useago/sdk/widget";
import { initDevPanel } from "@useago/sdk/devtools";

const widget = mountChatWidget("#chat", {
  config: { baseUrl: "https://YOUR-DOMAIN.useago.com" },
  forms: [{ name: "order", description: "…", schema: orderSchema }],
});

const DEV = new URLSearchParams(location.search).has("dev");
if (DEV) initDevPanel({ client: widget.client });
```

---

## Multiple widgets on one page

Call `initDevPanel` once per client. Each call gets its own panel. Pass a `label` to tell
them apart, and a `side` to dock each panel next to its widget:

```ts
const a = mountChatWidget("#chat-a", { config: { agent: "sales" } });
const b = mountChatWidget("#chat-b", { config: { agent: "support" } });

const DEV = new URLSearchParams(location.search).has("dev");
if (DEV) {
  initDevPanel({ client: a.client, label: "sales", side: "left" });
  initDevPanel({ client: b.client, label: "support", side: "right" });
}
```

If two panels land on the same side, the second one shifts over so they do not overlap.
Each panel tracks only its own client (state, function calls, SSE log) and remembers its
collapsed state separately.
