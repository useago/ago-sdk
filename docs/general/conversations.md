# Several conversations at once

Each conversation is an object with its own messages, answer and Stop. An
answer keeps streaming in its conversation while the user reads or writes in
another one, and nothing leaks between them.

```ts
import { AgoClient } from "@useago/sdk";

// Swap for https://YOUR-DOMAIN.api.useago.com once you have a tenant.
const ago = new AgoClient({ baseUrl: "https://playground.api.useago.com" });

const a = ago.conversation(); // a new conversation
const b = ago.conversation(); // another one

a.subscribe(() => console.log("A:", a.getSnapshot().messages.at(-1)?.content));
b.subscribe(() => console.log("B:", b.getSnapshot().messages.at(-1)?.content));

void a.sendMessage("Write a long story about a lighthouse");
void b.sendMessage("What is 2 + 2?"); // answers while A is still writing

await b.stop(); // stops B only; A keeps going
```

`ago.conversation(id)` opens an existing conversation (its history loads on the
first `subscribe`). `ago.conversation()` starts a new one: it gets a local
`draft-…` id, then its server id from its first answer, announced by the `"id"`
event.

## React

```tsx
import { useConversationChat } from "@useago/sdk/react";

function Chat({ conversationId }: { conversationId?: string }) {
  const { messages, isGenerating, sendMessage, stop } = useConversationChat(conversationId);
  return (
    <>
      {messages.map((m) => <p key={m.id}>{m.content}</p>)}
      {isGenerating ? <button onClick={stop}>Stop</button> : null}
      <button onClick={() => sendMessage("Hello")}>Send</button>
    </>
  );
}
```

Switching `conversationId` shows the other conversation; the answer of the one
you left keeps running and is whole when you come back. Unmounting never stops
an answer.

## The conversation on screen

The client tracks it for you: it is the conversation the user last sent a
message in, opened with `ago.getConversation(id)`, or shows with
`useConversationChat`. To name it yourself (this turns the tracking off):

```ts
ago.setActiveConversation(conversationId); // null refuses nothing
```

A conversation that is not on screen never runs your client functions (no
navigation, no page changes). The agent gets the call back as "not performed"
with the reason, so it tells the user what it was about to do and offers to do
it later. A refused call fires no `function:invoke`, only a `function:result`
whose `result.code` is `"conversation_not_active"`.

While the active conversation's last answer is still running after a page
reload (no stream is open for it), the conversation polls the server every 2
seconds until it finishes, for at most 5 minutes. A message sent meanwhile does
not wait for it: the client stops polling and sends at once.

## Details

- **One answer at a time per conversation.** Sending while the conversation
  answers shows the message at once and sends it when the answer ends.
- **Live activity.** Each assistant message has `toolCalls` (server tools) and
  `functionCalls` (your client functions, with `status` `running`,
  `awaiting_approval`, `done`, `error` or `rejected`). Both carry
  `contentOffset`, the text length when the call started, to place it between
  the text before and after.
- **Stop.** `conversation.stop()` or `ago.stop(conversationId)` stops one
  conversation; `ago.stop()` stops the active one (all of them when none is
  active). `ago.isGenerating(conversationId)` answers for one,
  `ago.isGenerating()` for the active one (any when none is active).
- **A spinner per conversation.** `ago.onGeneratingChanged(listener)` fires when
  any conversation starts or stops answering.
- **Lifetime.** An object lives while it is the active conversation, answers,
  or has subscribers. After that it is dropped, and opening it again reloads it
  from the server.
- **Events of one conversation.** `conversation.on("message:chunk", handler)`
  only receives that conversation's events and returns the unsubscribe function.

`ago.sendMessage(content, { conversationId })`, `useMessages` and `useChat` keep
working and use the same objects underneath.
