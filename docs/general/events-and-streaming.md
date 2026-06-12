# Events & streaming

`AgoClient` streams responses over Server-Sent Events and re-emits them as typed
events. You can consume them three ways, from lowest to highest level:

1. Raw events: `client.on(event, handler)`
2. Callback helpers: `onMessage`, `onMessageChunk`, …
3. An async generator: `createMessageStream`

All three are framework-agnostic and live in `@useago/sdk`.

---

## 1. Raw events

```ts
client.on("message:chunk", ({ content }) => append(content)); // append: your own render fn
client.off("message:chunk", handler);
client.once("message:complete", (m) => console.log(m.content));

const final = await client.waitFor("message:complete", { timeout: 10_000 });
```

| Event | Payload |
| --- | --- |
| `message:start` | `{ conversationId, messageId }` |
| `message:chunk` | `{ content, conversationId, messageId }` |
| `message:answer-complete` | `AgoMessage`: the main answer text is done, but follow-up replies may still be pending; fires once, before `message:complete` |
| `message:complete` | `AgoMessage` |
| `message:empty` | `{ conversationId, messageId }`: the reply completed as `DONE` with no content, tool calls, or follow-ups (usually an unknown `agent` slug). Fires after `message:complete` AND after `sendMessage` resolves, so subscribing right after the `await` still catches it. Both ids are `""` when the stream carried no message data at all. See [Empty replies](configuration.md#empty-replies). |
| `message:error` | `{ error, code?, conversationId?, messageId? }`: `code` is the stable [error code](configuration.md#error-codes) when the failure was an `AgoError` |
| `conversation:loaded` | `Conversation`: a full conversation was loaded from the server (e.g. after a page reload), with messages and persisted tool calls |
| `context:changed` | `ContextSnapshot \| null`: the client-side context changed (entry added/removed, or a stateful helper updated its store) |
| `toolCall:received` | `ToolCallData` |
| `toolCall:form` | `ToolCallData` (only when the tool call is a form) |
| `function:invoke` | `{ invocationId, functionName, arguments, conversationId }` |
| `function:result` | `{ invocationId, result, error? }` |
| `connection:status` | `{ connected }` |

`waitFor` rejects if the optional `timeout` (ms) elapses first.

---

## 2. Callback helpers

Thin wrappers that return an **unsubscribe** function, handy when you don't want
to keep a reference to the handler.

```ts
import {
  onMessage,
  onMessageChunk,
  onMessageStart,
  onMessageError,
  onToolCall,
  onFunctionInvoke,
} from "@useago/sdk";

const unsub = onMessageChunk(client, ({ content }) => {
  outputEl.textContent += content;
});
// later
unsub();

onMessage(client, (msg) => console.log("complete:", msg.content));
```

| Helper | Subscribes to |
| --- | --- |
| `onMessage(client, cb)` | `message:complete` |
| `onMessageChunk(client, cb)` | `message:chunk` |
| `onMessageStart(client, cb)` | `message:start` |
| `onMessageError(client, cb)` | `message:error` |
| `onToolCall(client, cb)` | `toolCall:received` |
| `onFunctionInvoke(client, cb)` | `function:invoke` |

---

## 3. Async generator

`createMessageStream` fires a message and yields a typed event for each step:
no manual subscribe/unsubscribe, just `for await`.

```ts
import { createMessageStream } from "@useago/sdk";

for await (const ev of createMessageStream(client, "Hello!", { conversationId })) {
  switch (ev.type) {
    case "start":    console.log("started", ev.data.messageId); break;
    case "chunk":    process.stdout.write(ev.data.content); break;
    case "toolCall": console.log("tool call", ev.data); break;
    case "complete": console.log("\ndone:", ev.data.content); break;
    case "error":    console.error(ev.data.error); break;
  }
}
```

Options: `{ conversationId?, agentId?, files? }`. The generator cleans up its
listeners automatically when the loop ends.

---

## Tool calls

When the agent needs structured input (a form), a confirmation, or shows a
status/progress indicator, it emits a tool call. Listen and respond:

```ts
client.on("toolCall:form", async (toolCall) => {
  // toolCall.formSchema describes the fields to render
  const values = await renderFormSomehow(toolCall.formSchema); // render your own form UI here
  await client.submitToolCallForm(toolCall.id, values);
});

client.on("toolCall:received", async (toolCall) => {
  if (toolCall.type === "confirmation_input") {
    const ok = window.confirm(toolCall.message ?? "Confirm?");
    ok ? await client.confirmToolCall(toolCall.id)
       : await client.rejectToolCall(toolCall.id);
  }
});
```

`ToolCallType` is one of: `form`, `confirmation_input`, `status_message`,
`progress_indicator`, `client_function`, `reasoning`, `mcp_ui_resource`.

---

## Framework equivalents

| Framework | How to subscribe |
| --- | --- |
| Core | `client.on(...)` or the helpers above |
| React | `client.on(...)` in `useEffect` (get the client via `useAgoClient()`), or rely on `useChat`/`useMessages` which manage this for you |
| Vue | `useAgoEvents(event, handler)` (auto-cleanup) |
| Angular | `messages$`, `chunks$`, `errors$`, `messageStart$` Observables, or `ago.on(...)` |

---

See also: [Core API](core.md) · [Functions & context](functions-and-context.md)
