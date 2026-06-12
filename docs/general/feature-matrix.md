# Feature matrix

What ships out of the box for each entry point. The **core** (`@useago/sdk`)
APIs are usable from *any* framework; the framework columns mark where a more
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

## Guides per stack

| Stack | Guide |
| --- | --- |
| Plain JavaScript / TypeScript | [Core](core.md) |
| React | [React](../frameworks/react.md) |
| Vue 3 | [Vue](../frameworks/vue.md) |
| Angular | [Angular](../frameworks/angular.md) |
| Embeddable widget (`<script>`) | [Widget](widget.md) |
