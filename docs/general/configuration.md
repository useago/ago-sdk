# Configuration & auth

Every entry point ultimately builds an `AgoClient` from an `AgoConfig`. This
page documents each option, how it maps to request headers, runtime updates,
auto-detection, and error handling.

---

## `AgoConfig`

```ts
interface AgoConfig {
  baseUrl: string;          // required, e.g. https://YOUR-DOMAIN.useago.com
  widgetId?: string;        // X-User-Anon-Id header; auto-generated + persisted if omitted
  agent?: string;           // default agent (id or slug) for new conversations
  defaultAgentId?: string;  // same as `agent`; `agent` is preferred
  permission?: string;      // X-Widget-Permission header
  language?: string | null; // Host interface locale, sent as Accept-Language
  userEmail?: string;       // X-User-Email header, identify the end user
  userJwt?: string;         // Authorization: Bearer <jwt>, authenticated users
  metadata?: Record<string, unknown> | null; // Message body, for user/ticket enrichment
  debug?: boolean;          // enable verbose console logging
  warnOnEmptyReply?: boolean; // default true; see "Empty replies" below
  clientFunctionsMode?: "placeholder" | "pause"; // default "pause"
  maxFunctionResultBytes?: number; // default 50000; cap on client function results
  errorWatcher?: boolean | ErrorWatcherOptions; // default off; send recent JS errors as context
}
```

| Option | Required | Maps to | Notes |
| --- | :---: | --- | --- |
| `baseUrl` | ✅ | request URL | Trailing slash is trimmed automatically. Missing/empty throws `config_missing_base_url` at construct time. `/path` values (same-origin proxy) are allowed. |
| `widgetId` | — | `X-User-Anon-Id` | Per-visitor anonymous id. If omitted, a UUID is generated and cached in `localStorage` (`ago_widget_id`) so a returning visitor keeps the same id. |
| `agent` / `defaultAgentId` | — | `agent_id` in the body | Per-message `agentId` overrides it. `agent` wins if both are set. |
| `permission` | — | `X-Widget-Permission` | Mirrors the widget's `window.AGO.permission`. |
| `language` | No | `Accept-Language` | Pass your interface locale, such as `fr` or `pt-BR`. `null` clears the override. |
| `userEmail` | — | `X-User-Email` | Identifies the user to AGO. |
| `userJwt` | — | `Authorization: Bearer …` | For authenticated sessions. |
| `metadata` | — | `metadata` in the body | JSON-serializable user/ticket context. Per-message overrides replace defaults; `null` omits the field. |
| `debug` | — | — | Turns on the SDK's logger. |
| `warnOnEmptyReply` | — | — | Default `true`: warn on the console (once per conversation) when a reply completes empty, usually an unknown `agent` slug. The [`message:empty` event](events-and-streaming.md#events) fires regardless. |
| `clientFunctionsMode` | — | `client_functions_mode` in the body | Default `"pause"`: the agent stops on client function call(s) and resumes the SAME turn once the results are submitted (the SDK submits and resumes automatically; see the [`message:waiting-client` event](events-and-streaming.md#events)). Needs a backend with pause/resume support; older backends ignore the flag and fall back to placeholder behavior. Legacy `"placeholder"`: the turn continues on a placeholder and results are only visible on later turns. Per-message override via `sendMessage(..., { clientFunctionsMode })`. |
| `maxFunctionResultBytes` | — | — | Default `50000`. Client function results larger than this (serialized) are replaced with a truncated preview before reaching the LLM. Override per function with `maxResultBytes`; see [result size limit](functions-and-context.md#result-size-limit). |
| `errorWatcher` | — | `errors:recent` in `client_context` | Off by default. `true` (or options) captures the page's JavaScript errors (uncaught exceptions, unhandled rejections, `console.error`, `reportError`) and sends the recent ones with every message. See [JavaScript errors](functions-and-context.md#javascript-errors). |

---

## Debug logging

`debug: true` turns on the SDK's internal logger. While enabled, the client
writes verbose messages to the browser console, each prefixed with `[AGO SDK]`:
client init, HTTP/stream requests, and registered functions/context. Examples:

```
[AGO SDK] AgoClient initialized
[AGO SDK] POST (stream) https://acme.useago.com/api/sdk/v1/messages {…}
[AGO SDK] ClientContext set: order-page
```

- **Default is `false`**: all of those messages are silent.
- **Errors are always logged** (`console.error`), whether `debug` is on or off.
- Use it in development; **leave it off in production** to keep users' consoles
  clean.
- Toggle it at runtime with `client.updateConfig({ debug: true })` (or `false`).

```ts
const ago = new AgoClient({ baseUrl: "https://acme.useago.com", debug: true });

// Or detect config from the DOM and only override `debug`:
import { createAgo } from "@useago/sdk";
const ago2 = createAgo({ debug: true });
```

---

## Examples per framework

```ts
// Core
const ago = new AgoClient({ baseUrl: "https://acme.useago.com", agent: "support" });
```

```tsx
// React
<AgoProvider baseUrl="https://acme.useago.com" agent="support" />
```

```ts
// Vue
app.use(AgoPlugin, { baseUrl: "https://acme.useago.com", agent: "support" });
```

```ts
// Angular
provideAgo({ baseUrl: "https://acme.useago.com", agent: "support" });
```

---

## Zero-config auto-detection

`createAgo()` and `autoDetectConfig()` resolve config from the page, in priority
order:

1. **`window.AGO`** (the widget config object): `basepath`, `widgetId`,
   `agent`/`defaultAgent`, `permission`, `email`, `jwt`, `metadata`.
2. **`<meta>` tags**: `ago-base-url`, `ago-widget-id`, `ago-agent`
   (or `ago-agent-id`), `ago-permission`, `ago-user-email`.
3. **`data-ago-*` attributes** on `<body>` or a `<script>` tag:
   `data-ago-base-url`, `data-ago-widget-id`, `data-ago-agent`
   (or `data-ago-agent-id`), `data-ago-permission`, `data-ago-user-email`.
4. **Explicit overrides** passed to the function.

```html
<meta name="ago-base-url" content="https://acme.useago.com" />
<meta name="ago-agent" content="support" />
```

```ts
import { createAgo, autoDetectConfig } from "@useago/sdk";

const client = createAgo();              // throws if no baseUrl found
const client2 = createAgo({ debug: true }); // detect + override

const config = autoDetectConfig();       // → AgoConfig | null (no throw)
```

---

## Updating config at runtime

Common after login (attaching a JWT) or switching agents:

```ts
client.updateConfig({ userJwt: token, userEmail: "jane@acme.com" });
```

Changing `permission` to a falsy value removes the header. In React, the
`useAgo` hook re-applies `agent`, `permission`, `language`, `userEmail`, `userJwt`,
`metadata`, `debug` and `warnOnEmptyReply` automatically when those props
change (changing `baseUrl`/`widgetId` recreates the client).

`updateConfig` validates the merged result: omitting a key (or passing it as
`undefined`) keeps the current value; an explicit empty or non-string `baseUrl`
throws `config_missing_base_url` and leaves the client unchanged.

### Language

```ts
const client = new AgoClient({
  baseUrl: "https://playground.api.useago.com",
  agent: "generic-guide",
  language: "fr",
});
const answer = await client.sendMessage("What can you help me with?");

// Run this when your application's language picker changes.
client.updateConfig({ language: "de" });
await client.sendMessage("And now?", { conversationId: answer.conversationId });
```

Pass your application's current locale to `language`. The SDK sends it in the
`Accept-Language` header on its requests. AGO uses the resolved language to select
existing knowledge translations and source titles, falling back to the original
content when a translation is unavailable. Region tags are preserved in the header
(`pt-BR`); underscores are accepted (`fr_FR` becomes `fr-FR`). The backend may resolve
a regional tag to its base language. If translations are stored under a base
language such as `pt`, pass that code when the backend does not fall back from
`pt-BR`. Source URLs remain the document's configured URLs.
If a Django language cookie is sent with the
request, it takes precedence over this header.

In React, bind the same locale your interface uses:

```tsx
<AgoProvider baseUrl="https://playground.api.useago.com" language={i18n.language}>
  <App />
</AgoProvider>
```

Changing the prop updates subsequent requests without recreating the client or
losing the conversation. Omit the React prop or call
`client.updateConfig({ language: null })` to clear the override. With no override,
the browser supplies its own language header. Each client has its own setting;
the SDK does not read or change your
page's language, global variables, or saved language preferences.

To refresh knowledge source titles already on screen, reload the conversation
after changing the language. Existing answer text stays unchanged:

```ts
client.updateConfig({ language: "fr" });
const conversation = await client.getConversation(answer.conversationId);
const sources = conversation.messages?.flatMap((message) => message.sources ?? []);
```

`createAgo({ language: "fr" })` also accepts an explicit locale when your API
configuration is detected from the page.

This header does not force the agent's reply language or translate your UI text.
Continue passing translated labels, placeholders and welcome text from your
application's translations.

### User and ticket metadata

Pass JSON-serializable data in `config.metadata` to include it in every new
message request (JSON and multipart uploads). `sendMessage(text, { metadata })`
replaces those defaults for that message; it does not merge objects. `null`
omits metadata. `updateConfig({ metadata: null })` stops sending defaults; it
does not erase data already stored by the server.

```ts
client.updateConfig({ metadata: { brevo: { clientid: 11970100, planCategory: "Free" } } });
await client.sendMessage("I need help");
```

The AGO API stores this data as widget metadata on the user. Configure metadata
field mappings in AGO to include selected fields in tickets. This does not
populate a separately hosted Zendesk form. Use `setContext` as well when the
agent needs these values in its prompt. Metadata supplied by the browser is
untrusted context, not an authentication credential or permission grant.

---

## Errors

All SDK errors extend `AgoError` (`code`, optional `statusCode`). Catch and
branch on the subclass:

```ts
import {
  AgoError,
  AgoApiError,      // non-2xx HTTP response (has type, statusCode, param, docUrl)
  AgoNetworkError,  // fetch failed / offline (has originalError)
  AgoStreamError,   // SSE stream failure
  AgoFunctionError, // a client-side function handler threw (has functionName)
} from "@useago/sdk";

try {
  await client.sendMessage("hi");
} catch (err) {
  if (err instanceof AgoApiError) {
    console.error(`API ${err.statusCode}: ${err.message} (${err.code})`);
  } else if (err instanceof AgoNetworkError) {
    console.error("Network problem", err.originalError);
  } else if (err instanceof AgoError) {
    console.error(err.code, err.message);
  }
}
```

`isStreamNetworkError(err)` is exported for detecting recoverable stream drops.

### Error codes

`code` is the compatibility surface: match on it, never on message text, which
may be reworded in any release.

| Code | Thrown by | Meaning | Fix |
| --- | --- | --- | --- |
| `config_missing_base_url` | `AgoError` | `baseUrl` missing, empty, or not a string (also from `createAgo()` and `mountChatWidget`) | Pass `baseUrl`, e.g. `https://YOUR-DOMAIN.api.useago.com` (the public demo account `https://playground.api.useago.com` works without a tenant) |
| `config_invalid_language` | `AgoError` | `language` is not a valid language tag | Use a tag such as `fr` or `pt-BR`, or `null` to clear the override. Invalid updates leave the client unchanged. |
| `config_suspect_base_url` | console warning only | `baseUrl` has no protocol and is not a `/path` | Add `https://`, or use a `/path` for a same-origin proxy |
| `network_error` | `AgoNetworkError` | fetch failed (offline, DNS, unreachable host) | Check `baseUrl` is reachable and includes the protocol |
| `http_error` | `AgoApiError` | non-2xx without a structured error body | 401/403: check `userJwt`. 404: check `baseUrl` points at the API root |
| `stream_no_body` | `AgoStreamError` | the endpoint returned no streamable body | Check `baseUrl` targets an AGO API and no proxy/mock strips the SSE stream |
| `stream_error` | `AgoStreamError` | the stream failed mid-flight | Usually a dropped connection; retry the message |
| `function_invalid_registration` | `AgoError` | `registerFunction` called without a handler or schema | Use `registerFunction({ name, parameters, handler })` |
| `function_error` | `AgoFunctionError` | a registered client function threw | Inspect `functionName` and `originalError` |
| `feedback_no_message` | `AgoError` | `submitConversationFeedback` on a conversation with no answer to attach the report to | Send a message first, or pass `details.lastMessageId` |
| `missing_client` | `AgoError` | a React hook was used without a client | Pass `options.client` or wrap the app in `<AgoProvider>` |

Server-supplied errors (`AgoApiError` with a structured body) keep the
backend's own `code` and, when provided, link their docs in the message
(`docUrl`).

### Empty replies

The backend currently answers an unknown `agent` slug with an empty 200, which
would otherwise fail silently (an empty bubble, nothing thrown). When a reply
completes as `DONE` with no content, no tool calls, no client-function
invocations and no follow-up replies, the SDK:

1. emits [`message:empty`](events-and-streaming.md#events) (always), and
2. warns on the console, once per conversation, unless
   `warnOnEmptyReply: false`.

Listen for `message:empty` to handle it in your UI. This client-side detection
is temporary: it goes away once the backend returns an explicit error for
unknown agents.

---

See also: [Core API](core.md) · [Events & streaming](events-and-streaming.md) · [Custom domain (reverse proxy)](custom-domain.md)
