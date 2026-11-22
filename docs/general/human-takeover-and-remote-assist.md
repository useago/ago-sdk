# Human takeover and remote assistance

```ts
import { mountChatWidget } from "@useago/sdk/widget";

mountChatWidget(document.body, {
  config: {
    baseUrl: "https://YOUR-DOMAIN.api.useago.com",
    agent: "support",
    remoteAssist: { screenshot: true },
  },
  placement: "bubble",
});
```

```html
<!-- Never shown in a screenshot -->
<input name="iban" data-ago-mask />
```

With nothing else to configure, the widget:

- shows the support agent's replies with their name, and the takeover events
  ("Jane joined the conversation") as centered lines;
- shows "Waiting for an agent" or "You are talking with Jane" under the
  conversation;
- delivers the agent's replies live, and tells the agent when the visitor has
  read them;
- with `remoteAssist`, asks the visitor before an agent can see the page, call
  your functions, or take a screenshot.

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
- see the page's recent JavaScript errors, if you turned on
  [`errorWatcher`](functions-and-context.md#javascript-errors) for the AI. The agent only sees
  them once the visitor accepts.

The agent cannot click, type, or read the DOM. A banner with the agent's name
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

Vue: `useRemoteAssist()` returns `snapshot` (a ref) and the same actions. Plain
TypeScript: `client.remoteAssist` has `getSnapshot()`, `subscribe(listener)`,
`accept()`, `decline()`, `stop()`, `approve(id)` and `reject(id)`, and the
`remoteAssist:*` [events](events-and-streaming.md#1-raw-events) fire either
way. Only call `accept()` from the visitor's own click.

### Sessions

- The consent is kept for the browser tab, so a reload resumes the session.
  Other tabs, and new tabs, never act on it.
- A session ends when the visitor stops it, the agent ends it, the agent hands
  the conversation back to the AI, the visitor opens another conversation, or
  it expires (2 minutes to answer the prompt, 15 minutes idle, 60 minutes in
  total).
- Commands that were queued when the session ended are dropped.

## Not supported yet

Angular has no `useHandoff` or `useRemoteAssist` equivalent. The vanilla widget
and the `client.remoteAssist` API work in Angular apps.

In React Native (`@useago/sdk/native`), remote assistance is always off. Human
takeover works: staff replies and markers arrive in `messages`. With React
Native's built-in `fetch`, live replies arrive when the server closes the live
connection (every few minutes); pass `fetch` from `expo/fetch` to get them at
once.
