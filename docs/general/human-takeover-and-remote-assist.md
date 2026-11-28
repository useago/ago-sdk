# Human takeover and remote assistance

```ts
import { mountChatWidget } from "@useago/sdk/widget";

mountChatWidget(document.body, {
  config: {
    baseUrl: "https://YOUR-DOMAIN.api.useago.com",
    agent: "support",
    remoteAssist: { screenshot: true, liveView: true, voice: true },
  },
  placement: "bubble",
});
```

```html
<!-- Never shown in a screenshot or the live view -->
<input name="iban" data-ago-mask />
<!-- A click from the agent in the live view runs this function -->
<button data-ago-action="addToCart" data-ago-args='{"sku":"A1"}'>Add</button>
```

With nothing else to configure, the widget:

- shows the support agent's replies with their name, and the takeover events
  ("Jane joined the conversation") as centered lines;
- shows "Waiting for an agent" or "You are talking with Jane" under the
  conversation;
- delivers the agent's replies live, and tells the agent when the visitor has
  read them;
- with `remoteAssist`, asks the visitor before an agent can see the page, call
  your functions, take a screenshot, or watch the page live and click in it.

## Human takeover

When the visitor asks for a person and an agent takes the conversation over in
AGO, the AI stops answering. Messages the visitor sends go to the agent. No
option is needed: the takeover works for every client.

### In your own chat UI

Messages carry two extra roles:

| `role` | What it is | How to render it |
| --- | --- | --- |
| `"staff"` | A reply from the human agent. `staffName` holds their name when known | A bubble, labelled with the name |
| `"system"` | A takeover event. `marker` holds it, parsed | A centered line, never a bubble. Ignore a system message without `marker` |

```tsx
import { useChat } from "@useago/sdk/react";

function Chat() {
  const { messages, sendMessage, handoff } = useChat();
  return (
    <>
      {messages.map((m) =>
        m.role === "system" ? (
          m.marker?.event === "handoff_accepted" ? (
            <p key={m.id} className="center">{m.marker.agentName ?? "An agent"} joined</p>
          ) : null
        ) : (
          <p key={m.id}>
            <b>{m.role === "staff" ? (m.staffName ?? "Support") : m.role}:</b> {m.content}
          </p>
        ),
      )}
      {handoff?.state === "waiting" && <p>Waiting for an agent</p>}
      {handoff?.state === "human" && <p>You are talking with {handoff.agentName ?? "an agent"}</p>}
      <button onClick={() => sendMessage("Thanks!")}>Send</button>
    </>
  );
}
```

Markers are `handoff_requested` (`available`: whether the team is online),
`handoff_accepted` and `handoff_transferred` (`agentName`), and
`handoff_ended`. Use `parseConversationMarker(content)` from `@useago/sdk` if
you read raw messages yourself.

`useChat()` returns `handoff`: `null` while the AI answers, otherwise
`{ state: "waiting" | "human", agentName, requestedAt }`. `useHandoff(conversationId?)`
returns it on its own, with `isWaiting`, `isHuman` and `agentName`. Vue has the
same `useChat` field and `useHandoff` composable. In plain TypeScript, read
`client.getHandoff(conversationId)` and listen to `handoff:changed`.

### Live replies and read receipts

The SDK keeps a live connection to the
[conversation on screen](conversations.md#the-conversation-on-screen), and only
while a person is involved. When the agent writes, the conversation is reloaded
and `conversation:updated` fires; `client.conversation(id)` objects, the React
and Vue `useMessages` and the widget apply it for you.

The conversation on screen is the one the visitor last sent in or opened, or
the one you name with `client.setActiveConversation(id)`. Also tell the SDK
whether it is visible, so the agent sees "read" (unread replies are also
emailed to the visitor after a few minutes):

```ts
client.setConversationVisible(panelIsOpen);
```

The widget does this for you. Receipts are only sent while the browser tab is
visible.

### Messages sent while an agent has the conversation

`sendMessage` resolves with an empty message flagged `handoffPaused: true`, and
`message:handoff-paused` fires instead of `message:complete`. Nothing failed:
the message is saved for the agent. Drop your typing indicator.

## Remote assistance

During a takeover, the support agent can ask the visitor for remote
assistance. If the visitor accepts in their browser, and only in the tab where
they accepted, the agent can:

- see the page URL and title, and the [page state](functions-and-context.md#page-state-shortcut)
  you expose to the AI;
- call the [functions](functions-and-context.md) you registered, exactly as the
  AI can;
- take a screenshot of the visible part of the page, if you allowed it;
- watch the page live and click in it, if you allowed it (see
  [Live view](#live-view));
- call the visitor by voice, if you allowed it and the visitor answers (see
  [Voice calls](#voice-calls));
- see the page's recent JavaScript errors, if you turned on
  [`errorWatcher`](functions-and-context.md#javascript-errors) for the AI. The agent only sees
  them once the visitor accepts.

The agent cannot type, and a click only runs a function you registered. A banner with the agent's name
and a Stop button stays at the top of the page for the whole session. Stop
takes effect at once, even offline.

### Turn it on

Both are required:

1. Remote assistance enabled for your workspace in AGO.
2. `remoteAssist` in the SDK config:

```ts
const client = new AgoClient({
  baseUrl: "https://YOUR-DOMAIN.api.useago.com",
  remoteAssist: true, // functions and page state only
  // errorWatcher: true, // the agent also sees the page's recent errors
  // remoteAssist: { screenshot: true },
  // remoteAssist: { screenshot: { mask: [".iban", "#ssn"] } },
  // remoteAssist: { liveView: { mask: [".iban"] } },
});
```

Same option on `<AgoProvider config>`, the Vue plugin and
`mountChatWidget({ config })`.

### Keep a function away from the agent

```ts
client.registerFunction({
  name: "applyDiscount",
  description: "Apply a discount code to the cart.",
  parameters: { type: "object", properties: { code: { type: "string" } } },
  handler: ({ code }) => cart.apply(code),
  remote: false, // the AI can call it, the support agent cannot
});
```

`useAgoFunction` and `useAgoPageState` take `remote: false` too. A function
that needs approval (`requiresApproval`, or a match in `approvalPolicy`) asks
the visitor before it runs, whoever calls it.

Every function the agent runs is added to the
[activity ledger](functions-and-context.md#activity-ledger) with
`actor: "support"`, so the AI knows about it when it answers again.

### Screenshots

The SDK takes the image in the browser, from a copy of the page; the page
itself is never changed. Only the viewport is captured, under 3 MB. These are
painted over in the image:

- password inputs;
- any element with `data-ago-mask`, and everything inside it;
- inputs whose `autocomplete` is a card field (`cc-number`, `cc-csc`,
  `cc-exp`...) or `one-time-code`;
- the selectors in `screenshot.mask`. An invalid selector cancels the
  screenshot rather than skip the mask.

Screenshots go to the support agent only, never to the AI.

The renderer ([modern-screenshot](https://github.com/qq15725/modern-screenshot),
about 9 kB gzipped) is a separate file the SDK loads on the first screenshot.
Your bundler picks it up from the package. To use your own
renderer, pass `capture`; it replaces the built-in one, masking included:

```ts
remoteAssist: {
  screenshot: {
    capture: async () => {
      const canvas = await myRenderer(document.body);
      return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
    },
  },
},
```

Canvas, cross-origin iframes, and images from servers without CORS headers may
render blank in the built-in capture.

### Live view

With `liveView`, the agent watches the page live in AGO and can click in it.
A click never replays a mouse event on your page: the SDK looks at the element
the agent clicked, on the visitor's real page, and runs the registered function
that element is declared for. Everything else is refused.

```ts
remoteAssist: { liveView: true },
// remoteAssist: { liveView: { mask: [".iban", "#ssn"] } },
```

Declare what a click means with attributes. The SDK reads the clicked element,
then its parents, and the closest element with one of these wins:

| On the element | A click runs |
| --- | --- |
| `data-ago-action="fn"` (with optional `data-ago-args='{"id":42}'`, a JSON object) | `fn` with those arguments |
| `data-ago-state="status"` and `data-ago-value="pending"` | [`setPageState`](functions-and-context.md#page-state-shortcut)`({ status: "pending" })`, the value typed by the function's schema (`"3"` becomes `3` for a number, `"true"` becomes `true` for a boolean) |
| the same, plus `data-ago-state-function="setFilters"` | `setFilters` instead of `setPageState` |
| `<a href="/orders/42">` on your own origin | `navigateToPage({ page: "order", id: "42" })`, when the path (or the `#/` path of a hash router) matches a route given to [`registerNavigationFunction`](functions-and-context.md#navigation-shortcut) exactly or through a `:param` |
| `data-ago-ignore` | nothing: the click stops here |

```html
<button data-ago-state="status" data-ago-value="pending">Pending</button>
<a href="/orders/42">Order 42</a>
<div data-ago-ignore>Not for the agent</div>
```

A click is refused, and the agent sees why, when:

- the element is `disabled` or `aria-disabled="true"`;
- it is a button, field, link or other control with no declaration, or a link
  to another site or to a page you did not declare;
- the page changed between what the agent saw and the click (nothing runs);
- the function is not registered on this page or has `remote: false`.

The usual rules still apply: a function that needs approval asks the visitor
first, and every click that runs a function is added to the
[activity ledger](functions-and-context.md#activity-ledger).

These are left out of the live view (the agent sees an empty box): the same
fields as in screenshots (password inputs, `data-ago-mask`, card and
one-time-code fields), the selectors in `liveView.mask`, and the SDK's own
prompts and banner. Canvas content and fonts are not recorded.

The recorder ([rrweb](https://github.com/rrweb-io/rrweb), about 25 kB
gzipped) is a separate file the SDK loads when a session with live view
starts. Pages without `liveView` never load it.

### Voice calls

With `voice`, the agent can call the visitor during the session to talk it
through.

```ts
remoteAssist: { liveView: true, voice: true },
```

The visitor sees "Jane is calling you" with Answer and Decline. When they
answer, the browser asks for the microphone; the banner then shows the call
with Mute and Hang up. Either side can hang up at any time, and the session
goes on without the call. A call ends with the session.

- The audio goes from one browser to the other through an encrypted relay,
  which also keeps each side's network address from the other. AGO does not
  record or store it.
- Only the tab where the visitor accepted the session rings. After a reload,
  a call in progress ends and the agent can call again.
- A page in an iframe needs `allow="microphone"` on the iframe. A page served
  with a `Permissions-Policy` header must allow `microphone=(self)`.
- If the visitor refuses the microphone, the call is declined. If the
  connection cannot be made (a network that blocks the relay), the agent is
  told the call failed.

### Your own consent prompt

The SDK renders the consent prompt, the banner and the approval prompt with
your `--ago-*` theme. To build your own, set `ui: false` and use the hook:

```tsx
import { useRemoteAssist } from "@useago/sdk/react";

function RemoteAssistBar() {
  const { state, session, pendingApproval, accept, decline, stop, approve, reject } =
    useRemoteAssist();
  const name = session?.agentName ?? "Support";
  if (pendingApproval) {
    return (
      <div role="alertdialog">
        {name} wants to run {pendingApproval.functionName}.
        <button onClick={() => reject(pendingApproval.commandId)}>Deny</button>
        <button onClick={() => approve(pendingApproval.commandId)}>Allow</button>
      </div>
    );
  }
  if (state === "requested") {
    return (
      <div role="alertdialog">
        {name} asks to help you on this page.
        <button onClick={decline}>Decline</button>
        <button onClick={accept}>Accept</button>
      </div>
    );
  }
  if (state === "active") {
    return <div role="region">{name} is helping you <button onClick={stop}>Stop</button></div>;
  }
  return null;
}
```

For voice calls, the hook also returns `call` (`status` is `"ringing"`,
`"connecting"` or `"connected"`, and `muted`) with `acceptCall`, `declineCall`,
`hangUpCall` and `setCallMuted(muted)`. Only call `acceptCall()` from the
visitor's own click: the browser asks for the microphone.

Vue: `useRemoteAssist()` returns `snapshot` (a ref) and the same actions. Plain
TypeScript: `client.remoteAssist` has `getSnapshot()`, `subscribe(listener)`,
`accept()`, `decline()`, `stop()`, `approve(id)`, `reject(id)` and the call
actions, and the `remoteAssist:*` [events](events-and-streaming.md#1-raw-events)
(`remoteAssist:call` for calls) fire either way. Only call `accept()` from the
visitor's own click.

### Sessions

- The consent is kept for the browser tab, so a reload resumes the session.
  Other tabs, and new tabs, never act on it.
- A session ends when the visitor stops it, the agent ends it, the agent hands
  the conversation back to the AI, the visitor opens another conversation, or
  it expires (2 minutes to answer the prompt, 15 minutes idle, 60 minutes in
  total).
- Commands that were queued when the session ended are dropped.
- The live view stops with the session, and nothing recorded after it ends
  is sent. After a reload it starts again in the consenting tab.

## Not supported yet

Angular has no `useHandoff` or `useRemoteAssist` equivalent. The vanilla widget
and the `client.remoteAssist` API work in Angular apps.

In React Native (`@useago/sdk/native`), remote assistance (live view and voice calls included) is always off. Human
takeover works: staff replies and markers arrive in `messages`. With React
Native's built-in `fetch`, live replies arrive when the server closes the live
connection (every few minutes); pass `fetch` from `expo/fetch` to get them at
once.
