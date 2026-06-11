# @useago/sdk

[![npm version](https://img.shields.io/npm/v/@useago/sdk.svg)](https://www.npmjs.com/package/@useago/sdk)
[![types](https://img.shields.io/npm/types/@useago/sdk.svg)](https://www.npmjs.com/package/@useago/sdk)

Official JavaScript/TypeScript SDK for [AGO](https://useago.com) — embed AGO's AI
agents directly inside your own app. Stream answers, let the agent call **your**
client-side functions, navigate users around your UI, and feed it live context
about what the user is doing.

Works with **plain JS/TS, React, Vue and Angular**. The core is framework-agnostic;
each framework gets idiomatic bindings (hooks, composables, services) on top of the
same `AgoClient`.

```bash
npm install @useago/sdk
```

📚 **Full documentation:** [ago.mintlify.app](https://ago.mintlify.app/) · the
framework guides below are also published there.

---

## Quick start

Pick your stack — each guide is self-contained.

| Stack | Guide |
| --- | --- |
| Plain JavaScript / TypeScript | [docs/general/core.md](docs/general/core.md) |
| React | [docs/frameworks/react.md](docs/frameworks/react.md) |
| Vue 3 | [docs/frameworks/vue.md](docs/frameworks/vue.md) |
| Angular | [docs/frameworks/angular.md](docs/frameworks/angular.md) |
| Embeddable widget (`<script>`) | [docs/general/widget.md](docs/general/widget.md) |

Cross-cutting topics (apply to every framework):

- [**Client-side functions & helpers**](docs/general/functions-and-context.md#client-side-functions) — let the agent run code in the browser
- [**Client context**](docs/general/functions-and-context.md#client-context) — tell the agent what the user is looking at
- [**Events & streaming**](docs/general/events-and-streaming.md) — low-level hooks into the message stream
- [**Testing**](docs/general/testing.md) — a mock client for unit tests
- [**Configuration & auth**](docs/general/configuration.md) — every `AgoConfig` option, headers, errors

The 30-second version (vanilla):

```ts
import { AgoClient } from "@useago/sdk";

const ago = new AgoClient({ baseUrl: "https://YOUR-DOMAIN.useago.com" });

ago.on("message:chunk", ({ content }) => process.stdout.write(content));

const reply = await ago.sendMessage("What can you do?");
console.log("\nDone:", reply.status);
```

---

## Feature matrix

What ships out of the box for each entry point. The **core** (`@useago/sdk`)
APIs are usable from *any* framework — the framework columns mark where a more
idiomatic binding (hook / composable / service / component) is also provided.

| Feature | Core (vanilla) | React | Vue | Angular |
| --- | :---: | :---: | :---: | :---: |
| Create client | `new AgoClient()` | `useAgo` / `<AgoProvider>` | `AgoPlugin` / `useAgo` | `provideAgo` / `AgoService` |
| Zero-config auto-detect | ✅ `createAgo()` | ✅ | ✅ | ✅ |
| Send message (streaming) | ✅ | ✅ `useChat`/`useMessages` | ✅ `useChat`/`useMessages` | ✅ `AgoService.sendMessage` |
| File attachments | ✅ | ✅ | ✅ | ✅ |
| List / load conversations | ✅ | ✅ `useConversation` | ✅ `useConversation` | ✅ `AgoService` |
| All-in-one chat state | — | ✅ `useChat` | ✅ `useChat` | ➖ compose manually |
| Pre-built `<ChatWidget>` UI | — | ✅ | ➖ see example | — |
| Markdown / `<Message>` / `<ChatInput>` | — | ✅ | — | — |
| Client-side functions | ✅ `registerFunction` | ✅ `useAgoFunction` | ✅ `useAgoFunction` | ✅ `AgoService` |
| `defineFunction` / `withHandler` | ✅ | ✅ | ✅ | ✅ |
| Pre-built helpers (`showToast`, …) | ✅ | ✅ `helpers` prop | ✅ | ✅ |
| Navigation function | ✅ `registerNavigationFunction` | ✅ `useAgoNavigation` | ✅ `useAgoNavigation` | ✅ `AgoService` |
| Client context | ✅ `setContext` / `addDynamicContext` | ✅ `useAgoContext` | ✅ core API | ✅ core API |
| Auto page context | ✅ `enableAutoPageContext()` | ✅ `pageContext="auto"` | ✅ core API | ✅ core API |
| Events (`on`/`off`/`once`/`waitFor`) | ✅ | ✅ (via client) | ✅ `useAgoEvents` | ✅ `messages$` Observables |
| Streaming helpers / async generator | ✅ | ✅ | ✅ | ✅ |
| Tool calls (form/confirm/reject) | ✅ | ✅ | ✅ | ✅ `AgoService` |
| Message feedback | ✅ `submitFeedback` | ✅ | ✅ | ✅ `AgoService` |
| Observable store | ✅ `createStore` | ✅ `useAgoStore` | ✅ `useAgoStore` | ➖ core API |
| Dev panel / devtools | ✅ `initDevPanel` (`/devtools`) | ✅ | ✅ | ✅ |
| Testing mock client | ✅ `createMockClient` | ✅ | ✅ | ✅ |

Legend: ✅ first-class binding · ➖ supported via the core API, no dedicated sugar · — not applicable.

---

## Package entry points

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
| `@useago/sdk/devtools` | `initDevPanel` — in-browser debug overlay (DOM/CSS) |
| `@useago/sdk/testing` | `createMockClient` — mock client for tests |

ESM and CJS builds are both shipped, with full TypeScript declarations.

---

## Requirements

- A modern browser environment (uses `fetch` + `ReadableStream` for SSE) or Node 18+.
- `react` / `react-dom` `>=17` for the React bindings (peer dependency, optional).
- `vue` `>=3.3` for the Vue bindings (peer dependency, optional).
- Angular bindings have **no** hard Angular dependency — they work with any DI container.

## License

[Apache 2.0](./LICENSE) · [Documentation](https://ago.mintlify.app/) · [Website](https://useago.com)
