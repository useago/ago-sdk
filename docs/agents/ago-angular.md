# AGO SDK skill: Angular

You are integrating the AGO SDK (`@useago/sdk`) into an Angular app. AGO is a chat
agent that can answer questions, run functions in the user's browser, and
navigate your app's routes. This file is everything you need. Follow it exactly.

## Endpoints

Use the live demo for anything runnable so it answers with zero setup:

```
baseUrl: https://playground.api.useago.com
agent:   generic-guide
```

When the project has its own tenant, swap to `https://YOUR-DOMAIN.api.useago.com`
and the project's own agent slug. Read `baseUrl` from the environment, never
hardcode a real tenant URL.

The Angular bindings have no hard dependency on Angular: they ship a minimal
Observable shape compatible with RxJS, so streaming events arrive as Observables.

## Install

```bash
npm install @useago/sdk
```

## 1. Provide the service

Standalone bootstrap:

```ts
import { bootstrapApplication } from "@angular/platform-browser";
import { provideAgo } from "@useago/sdk/angular";
import { AppComponent } from "./app.component";

bootstrapApplication(AppComponent, {
  providers: [
    provideAgo({
      baseUrl: "https://playground.api.useago.com",
      agent: "generic-guide",
    }),
  ],
});
```

`provideAgo(config)` returns `{ provide: AgoService, useValue: <singleton> }`,
which Angular's injector accepts directly. In an `NgModule`, add it to the
`providers` array the same way. With no DI, construct it:
`new AgoService({ baseUrl: "..." })`.

## 2. Inject and use

Subscribe to the streaming Observables to render messages token-by-token.

```ts
import { Component, inject, OnDestroy } from "@angular/core";
import { AgoService } from "@useago/sdk/angular";
import type { AgoMessage } from "@useago/sdk/angular";

@Component({
  selector: "app-chat",
  standalone: true,
  template: `
    <div *ngFor="let m of messages"><b>{{ m.role }}:</b> {{ m.content }}</div>
    <form (submit)="send(input.value); input.value = ''">
      <input #input placeholder="Ask anything..." />
      <button>Send</button>
    </form>
  `,
})
export class ChatComponent implements OnDestroy {
  private ago = inject(AgoService);
  messages: AgoMessage[] = [];
  private streaming?: AgoMessage;

  private subs = [
    // A new assistant message starts: push a placeholder to stream into
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
        m.id === messageId ? { ...m, content: m.content + content } : m);
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

## 3. Observables

| Observable      | Emits |
| --------------- | ----- |
| `messageStart$` | `{ conversationId, messageId }` when a reply begins |
| `chunks$`       | `{ content, conversationId, messageId }` per streamed token |
| `messages$`     | the final `AgoMessage` on completion |
| `errors$`       | `{ error, conversationId?, messageId? }` |

Each `subscribe()` returns an object with `unsubscribe()`. For any other event,
use `ago.on(event, handler)` / `ago.off(event, handler)`.

## 4. Methods

`AgoService` forwards the full client surface:

```ts
ago.sendMessage(content, options?)        // Promise<AgoMessage>
ago.getConversations()                     // Promise<Conversation[]>
ago.getConversation(id)
ago.getMessages(conversationId)

ago.registerFunction(definition)           // or (name, handler, schema)
ago.unregisterFunction(name)
ago.registerNavigationFunction(navigate, routes)

ago.submitToolCallForm(toolCallId, formData)
ago.confirmToolCall(toolCallId)
ago.rejectToolCall(toolCallId)
ago.submitFeedback(messageId, "positive" | "negative")

ago.on(event, handler) / ago.off(event, handler)
ago.updateConfig(partialConfig)
ago.getClient()                            // underlying AgoClient
ago.destroy()
```

## 5. Functions, navigation and context

Register a client-side function the agent can call:

```ts
this.ago.registerFunction({
  name: "lookupOrder",
  description: "Look up an order by ID",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "Order ID" } },
    required: ["id"],
  },
  handler: async (args) => this.orders.fetch(args.id as string),
});
```

Rules for functions:
- Every parameter property needs a `description`. The agent reads it to decide
  what to pass.
- `required` lists only the params the function truly needs.
- The handler must return serializable data (no DOM nodes, no circular refs).

Register navigation (works with Angular's `Router`):

```ts
const router = inject(Router);
this.ago.registerNavigationFunction((path) => router.navigateByUrl(path), [
  { name: "dashboard", path: "/dashboard", description: "Main dashboard" },
]);
```

For client context, reach the client via `getClient()`:

```ts
this.ago.getClient().enableAutoPageContext();
this.ago.getClient().setContext("order", { name: "Order", data: { id } });
```

## Exports cheat-sheet (`@useago/sdk/angular`)

- `AgoService`, `provideAgo`, `AgoProvideOptions`
- Types: `AgoConfig`, `AgoMessage`, `Conversation`, `AgoAgent`, `AgoSource`,
  `ToolCallData`, `AgoClientEvents`, `AgoEventName`

## Checklist before you finish

1. `provideAgo(...)` is registered (or `AgoService` constructed directly).
2. `baseUrl` comes from the environment, not a hardcoded tenant URL.
3. Every subscription is torn down in `ngOnDestroy`, and `ago.destroy()` is called.
4. Every registered function's parameters have descriptions and the handler
   returns serializable data.
5. Run the project's typecheck and lint.
