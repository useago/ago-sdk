# Testing

`createMockClient()` returns a fake `AgoClient` you can use in unit tests for any
framework. It records every method call, lets you simulate server-pushed events,
and never makes a network request.

```ts
import { createMockClient } from "@useago/sdk/testing";
// also re-exported from "@useago/sdk" and "@useago/sdk/react"
```

---

## Basic usage

```ts
import { createMockClient } from "@useago/sdk/testing";

const mock = createMockClient();

await mock.sendMessage("hello");

// Assert what was called
expect(mock.__callsFor("sendMessage")).toHaveLength(1);
expect(mock.__callsFor("sendMessage")[0].args[0]).toBe("hello");
```

Defaults return harmless stand-ins (`sendMessage` resolves to a mock assistant
message, `getConversations` to one mock conversation, etc.), so code under test
runs without setup.

---

## Override behaviour

```ts
const mock = createMockClient({
  overrides: {
    sendMessage: async (content: string) => ({
      id: "m1",
      conversationId: "c1",
      content: `echo: ${content}`,
      role: "assistant",
      status: "DONE",
      createdAt: new Date(),
    }),
    getConversations: async () => [],
  },
});
```

---

## Simulate server events

Drive the event system to test streaming UIs:

```ts
const received: string[] = [];
mock.on("message:chunk", ({ content }) => received.push(content));

mock.__emitEvent("message:chunk", {
  content: "Hel", conversationId: "c1", messageId: "m1",
});
mock.__emitEvent("message:chunk", {
  content: "lo", conversationId: "c1", messageId: "m1",
});

expect(received.join("")).toBe("Hello");
```

`__emitEvent` works with every event in [the events table](events-and-streaming.md#1-raw-events),
and `on` / `off` / `once` / `waitFor` behave like the real client.

---

## Test helpers

| Member | Purpose |
| --- | --- |
| `mock.__calls` | `Array<{ method, args }>`: every recorded call, in order |
| `mock.__callsFor(method)` | calls for one method |
| `mock.__emitEvent(event, data)` | fire an event to subscribers |

---

## With React

Inject the mock through the provider:

```tsx
import { render } from "@testing-library/react";
import { AgoProvider } from "@useago/sdk/react";
import { createMockClient } from "@useago/sdk/testing";

const mock = createMockClient();

render(
  <AgoProvider client={mock}>
    <ChatScreen />
  </AgoProvider>,
);

// e.g. simulate a streamed completion
mock.__emitEvent("message:complete", {
  id: "m1", conversationId: "c1", content: "Hi!",
  role: "assistant", status: "DONE", createdAt: new Date(),
});
```

For Vue, pass `{ client: mock }` to any composable; for Angular, construct
`new AgoService(...)` against the mock or provide it via `provideAgo`-style
`{ provide: AgoService, useValue }`.

---

See also: [Core API](core.md) · [Events & streaming](events-and-streaming.md)
