# Angular

An injectable `AgoService` that wraps `AgoClient` and exposes streaming events
as RxJS-style Observables, plus Promise-based methods for everything else.

```bash
npm install @useago/sdk
```

```ts
import { provideAgo, AgoService } from "@useago/sdk/angular";
```

> The Angular bindings have **no hard dependency on Angular**: they ship a
> minimal Observable shape compatible with RxJS, so the package stays
> framework-light. You can also use `AgoService` outside Angular entirely.

---

## 1. Provide the service

Standalone bootstrap:

```ts
import { bootstrapApplication } from "@angular/platform-browser";
import { provideAgo } from "@useago/sdk/angular";
import { AppComponent } from "./app.component";

bootstrapApplication(AppComponent, {
  providers: [
    provideAgo({
      baseUrl: "https://YOUR-DOMAIN.useago.com",
      agent: "support-bot",
    }),
  ],
});
```

`provideAgo(config)` returns `{ provide: AgoService, useValue: <singleton> }`,
which Angular's injector accepts directly. Or in an `NgModule`, add it to the
`providers` array the same way.

No DI at all? Just construct it:

```ts
const ago = new AgoService({ baseUrl: "https://YOUR-DOMAIN.useago.com" });
```

---

## 2. Inject and use

```ts
import { Component, inject, OnDestroy } from "@angular/core";
import { AgoService } from "@useago/sdk/angular";
import type { AgoMessage } from "@useago/sdk/angular";

@Component({
  selector: "app-chat",
  standalone: true,
  template: `
    <div *ngFor="let m of messages">
      <b>{{ m.role }}:</b> {{ m.content }}
    </div>
    <form (submit)="send(input.value); input.value = ''">
      <input #input placeholder="Ask anything…" />
      <button>Send</button>
    </form>
  `,
})
export class ChatComponent implements OnDestroy {
  private ago = inject(AgoService);
  messages: AgoMessage[] = [];
  private streaming?: AgoMessage;

  private subs = [
    // A new assistant message starts → push a placeholder we'll stream into
    this.ago.messageStart$.subscribe(({ messageId }) => {
      this.streaming = {
        id: messageId, conversationId: "", content: "",
        role: "assistant", status: "IN_PROGRESS", createdAt: new Date(),
      };
      this.messages = [...this.messages, this.streaming];
    }),
    // Append streamed tokens
    this.ago.chunks$.subscribe(({ content, messageId }) => {
      this.messages = this.messages.map((m) =>
        m.id === messageId ? { ...m, content: m.content + content } : m,
      );
    }),
    // Final message replaces the placeholder
    this.ago.messages$.subscribe((msg) => {
      this.messages = this.messages.map((m) => (m.id === msg.id ? msg : m));
    }),
    this.ago.errors$.subscribe(({ error }) => console.error(error)),
  ];

  async send(content: string) {
    if (!content.trim()) return;
    this.messages = [...this.messages, {
      id: `u-${Date.now()}`, conversationId: "", content,
      role: "user", status: "DONE", createdAt: new Date(),
    }];
    await this.ago.sendMessage(content);
  }

  ngOnDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
    this.ago.destroy();
  }
}
```

---

## 3. Observables

| Observable | Emits |
| --- | --- |
| `messageStart$` | `{ conversationId, messageId }` when a reply begins |
| `chunks$` | `{ content, conversationId, messageId }` for each streamed token |
| `messages$` | the final `AgoMessage` on completion |
| `errors$` | `{ error, conversationId?, messageId? }` |

Each `subscribe()` returns an object with `unsubscribe()`. They're the
Observable equivalents of the client's `message:start`, `message:chunk`,
`message:complete` and `message:error` events. For any other event, use
`ago.on(event, handler)` / `ago.off(event, handler)`.

---

## 4. Methods

`AgoService` forwards the full client surface:

```ts
ago.sendMessage(content, options?)             // Promise<AgoMessage>
ago.getConversations()                          // Promise<Conversation[]>
ago.getConversation(id)                         // Promise<Conversation>
ago.getMessages(conversationId)                 // Promise<AgoMessage[]>

ago.registerFunction(definition)                // or (name, handler, schema)
ago.unregisterFunction(name)
ago.registerNavigationFunction(navigate, routes)
ago.enableAutoContinueAfterNavigation(options?)  // returns a disable fn

ago.submitToolCallForm(toolCallId, formData)
ago.confirmToolCall(toolCallId)
ago.rejectToolCall(toolCallId)
ago.submitFeedback(messageId, "positive" | "negative")

ago.on(event, handler)  /  ago.off(event, handler)
ago.updateConfig(partialConfig)
ago.getClient()                                 // underlying AgoClient
ago.destroy()
```

---

## 5. Functions, navigation & context

These come from the underlying client. Register a client-side function the agent
can call:

```ts
this.ago.registerFunction({
  name: "lookupOrder",
  description: "Look up an order by ID",
  parameters: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  handler: async (args) => this.orders.fetch(args.id as string),
});
```

Register navigation (works with Angular's `Router`):

```ts
const router = inject(Router);
this.ago.registerNavigationFunction((path) => router.navigateByUrl(path), [
  { name: "dashboard", path: "/dashboard", description: "Main dashboard" },
]);
```

To let a request like "open the invoices page and show only the overdue ones"
complete in one go, enable auto-continue after navigation once (e.g. in your
root component). It waits for the destination page to register its page state,
then lets the agent apply the change. It returns a disable function for
teardown:

```ts
export class AppComponent implements OnDestroy {
  private ago = inject(AgoService);
  private stopAutoContinue = this.ago.enableAutoContinueAfterNavigation();

  ngOnDestroy() {
    this.stopAutoContinue();
  }
}
```

Options (`AgoAutoContinueOptions`: custom navigation function names, timeouts,
prompt override) and the pause vs placeholder mechanics are described in
[Client functions & context](../general/functions-and-context.md#navigate-then-change-the-page-in-one-go).

Register page state, the mirror of navigation: let the agent change the current
page's state (filters, sort, view mode…) and read it back. Each control becomes
one optional property of a single synthesized `setPageState` function, and every
control's `get()` value is sent as context.

```ts
this.ago.registerPageStateFunction([
  {
    name: "statusFilter",
    description: "Filter the list by status",
    schema: { type: "string", enum: ["all", "paid", "overdue"] },
    get: () => this.status,
    set: (v) => { this.status = v as string; },
  },
]);
// on teardown: this.ago.unregisterPageStateFunction();
```

For client context, reach the client via `getClient()`:

```ts
this.ago.getClient().enableAutoPageContext();
this.ago.getClient().setContext("order", { name: "Order", data: { id } });
```

See [Client functions & context](../general/functions-and-context.md) for full details.

---

## Full example

A runnable Angular example lives in
[`examples/simple-angular`](../examples/simple-angular).

---

## Exports cheat-sheet (`@useago/sdk/angular`)

- `AgoService`, `provideAgo`, `AgoProvideOptions`
- Types: `AgoConfig`, `AgoMessage`, `Conversation`, `AgoAgent`, `AgoSource`,
  `ToolCallData`, `AgoClientEvents`, `AgoEventName`, `AgoStateControl`,
  `AgoPageStateOptions`, `AgoAutoContinueOptions`

See also: [Client functions & context](../general/functions-and-context.md) ·
[Testing](../general/testing.md) · [Configuration](../general/configuration.md)
