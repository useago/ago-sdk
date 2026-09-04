# Embeddable widget

The embeddable chat widget is a drop-in `<script>` snippet: **no build step and
no npm install required**. The SDK ships the **TypeScript types** for its
`window.AGO` configuration object (so projects configuring the widget in
TypeScript get autocomplete) and a **programmatic vanilla widget**
([`mountChatWidget`](#programmatic-widget-mountchatwidget)) for pure TS/JS apps.

> If you want a chat bubble on a marketing site with zero code, use the embed
> snippet. If you control the DOM but don't use a framework, use
> `mountChatWidget`. For a React/Vue/Angular app, use the
> [framework bindings](../frameworks/react.md) instead.

There are **two** widgets in this package:

|                           | Embed snippet             | `mountChatWidget`                  |
| ------------------------- | ------------------------- | ---------------------------------- |
| Setup                     | `<script>` tag, no build  | `import` from `@useago/sdk/widget` |
| Renders                   | floating bubble (iframe)  | inline panel, side panel, or the same floating bubble (`placement: "bubble"`) |
| Framework                 | none                      | none (pure TS/JS)                  |
| Forms / suggested replies | built-in                  | yes, via options                   |
| Use when                  | marketing site, zero code | you control the DOM, no framework  |

---

## Programmatic widget: `mountChatWidget`

The pure TS/JS equivalent of the React [`<ChatWidget>`](../frameworks/react.md#2-the-fastest-ui-chatwidget):
a complete chat panel (header, streaming messages, input) you mount into any DOM
element, **no React, Vue, or Angular**. It supports the same conversational
**forms** (form creator) and **clickable suggested replies**.

```ts
import { mountChatWidget } from "@useago/sdk/widget";

const widget = mountChatWidget("#chat", {
  // Bring your own client, or pass `config` and one is created for you:
  config: { baseUrl: "https://YOUR-DOMAIN.useago.com" },
  title: "Book a demo",
  welcomeMessage: "Hi! Tell me about your team and I'll set up a demo.",
  // Suggested replies are clickable by default (clicking sends the reply).
  forms: [
    {
      name: "demo_request",
      description: "A request to book a product demo.",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          company: { type: "string" },
        },
        required: ["name", "email", "company"],
      },
      // Relay to a server-configured destination (URL + secret stay server-side):
      submit: { via: "backend" },
    },
    // Or keep the schema in the backend and reference it by name:
    // { name: "demo_request" },
  ],
});

// Programmatic control:
widget.sendMessage("Hello");
widget.stop(); // interrupt the answer being generated (no-op when idle)
widget.destroy(); // removes listeners, uninstalls forms, clears the DOM
```

### Floating bubble (`placement: "bubble"`)

The same widget as the embed snippet, without the iframe: a launcher in the
bottom-right corner, a teaser bubble a second later, and a 550px panel with a
home screen, a conversation screen, and a chat history screen. Paste this into
any page and it answers from the public demo account:

```ts
import { mountChatWidget } from "@useago/sdk/widget";

mountChatWidget(document.body, {
  config: { baseUrl: "https://playground.api.useago.com", agent: "generic-guide" },
  placement: "bubble",
  title: "Ask AGO",
  prompt: "Hello, how can I help you today?",
  subtitle: "Answers come from the **AGO docs**.",
  conversationStarters: [
    { label: "What can the SDK do?" },
    { label: "Pricing", message: "Tell me about pricing" },
  ],
  colors: { button: "#007bff", header: "#03182f" },
});
```

Swap `baseUrl` for your own `https://YOUR-DOMAIN.api.useago.com` when you have a
tenant.

**Screens.** The panel opens on **Home**: the title (one line per `\n`), the
optional markdown `subtitle`, the `conversationStarters` cards, and the composer.
Sending a message, or clicking a card, lands on the **conversation** screen,
where the footer hides and the header shows a back chevron and a new-chat
button. The **Chats** tab lists the visitor's threads newest first with a
relative time (`5min ago`, `2h ago`, `3d ago`); a row reopens that thread, and
the floating "New conversation" pill starts over. `hideFooter: true` drops the
tab bar.

**Home screen from the dashboard.** By default the home screen shows what you
pass in code. Set `loadHomeConfig: true` and it takes the title, the subtitle
and the starter cards from your AGO dashboard instead, like the hosted widget:

```ts
mountChatWidget(document.body, {
  config: { baseUrl: "https://YOUR-DOMAIN.api.useago.com" },
  placement: "bubble",
  loadHomeConfig: true,
  title: "Support", // still the header title, and the home title until the config lands
});
```

It costs one `GET /config` on mount. The panel opens right away with whatever
the options set, and re-renders when the config arrives, so nothing waits on
the request; if it fails, the options stay. Each part is replaced only when the
dashboard has a value for it, so a dashboard with a title but no starters keeps
your `conversationStarters`. The header keeps the `title` option either way.

A dashboard starter can name the agent that answers it, and so can yours
(`{ label: "Billing", message: "I have a billing question", agentId: "billing-bot" }`).
The dashboard's **widget starter**, an opening message the agent sends by
itself, is honored too. It fires when the visitor first opens the panel, and
only on a fresh visit: never over a resumed thread, and never on a page where
nobody clicks the launcher (the hosted widget builds its iframe on first open,
so it costs the same nothing there).

**Reopening the last thread.** On load the widget reopens the visitor's most
recent conversation if its last message is under two hours old, first from the
front-side cache (`persistConversation` is on by default here, under the usual
`ago_last_thread` key), then from the thread list once it arrives, so it also
works where the browser blocks storage. A visitor who already navigated is never
redirected. Pass `autoResume: false` to always land on Home; an explicit
`conversationId` opens that thread directly.

**Mobile.** Under 450px the panel fills the screen, the launcher hides while it
is open, the page behind it stops scrolling, and Escape or the header "X" close
it. On a desktop viewport the launcher stays visible and toggles the panel.

**Colors.** `colors` takes the embed snippet's `AgoWidgetColors` object and maps
it onto the theme tokens; `theme` wins over it key by key.

| `colors` key        | Sets                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `button`            | `launcherBg` and `sendBg`                                            |
| `header`            | `headerBg` (a gradient works), `headerText` derived for contrast     |
| `agentMessage`      | `agentBubbleBg` (the assistant row gets a fill)                      |
| `agentMessageFont`  | `agentBubbleText`                                                    |
| `background`        | `panelBg` and `messagesBg`                                           |
| `font`              | `text`                                                               |
| `userMessage`       | `userBubbleBg`                                                       |
| `userMessageFont`   | `userBubbleText`                                                     |

The header text is white unless the header color is light (contrast under 3:1),
in which case it turns black. If you set the header color from host CSS
instead, set `--ago-header-text-color` alongside it.

**Handle.** On top of the usual methods (including `newConversation()`, which
every placement has), the bubble handle exposes `screen`,
`showScreen("home" | "chat" | "history")`, and `openConversation(id)`. The
chrome's strings are translated through `labels`:

```ts
mountChatWidget(document.body, {
  config: { baseUrl: "https://playground.api.useago.com", agent: "generic-guide" },
  placement: "bubble",
  labels: {
    home: "Accueil",
    chats: "Discussions",
    history: "Historique",
    newConversation: "Nouvelle conversation",
    noHistory: "Aucune discussion pour le moment",
    askQuestion: "Posez une question",
    timeAgo: { minutes: "il y a {n} min", hours: "il y a {n} h", days: "il y a {n} j" },
  },
});
```

The bubble ignores `height`, `welcomeMessage`, `bubbleStyle`, `agentBubble`,
and `showAgentName` (its layout is the hosted widget's), defaults `title` to
`"AGO Chatbot"`, `width` to `550` (clamped between 400px and the viewport minus
40px), `mobile.breakpoint` to `450`, and turns `feedback`, `loadThreads`, and
`persistConversation` on. Every element carries an `ago`-prefixed class name
(`.ago-chat-widget-launcher`, `.ago-chat-widget-teaser`, `.ago-chat-widget-bubble`,
`.ago-chat-widget__header`, `.ago-chat-widget__home`, `.ago-chat-widget__history`,
`.ago-chat-widget__footer`).

### Options

| Option                  | Type                                                                                      | Default                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `client?`               | `AgoClient`                                                                               | — (provide this **or** `config`)                           |
| `config?`               | `AgoConfig`                                                                               | — (needs at least `baseUrl`)                               |
| `conversationId?`       | `string`                                                                                  | —                                                          |
| `persistConversation?`  | `boolean \| Partial<ConversationSessionOptions>`                                          | — (off; `true` for the bubble)                             |
| `loadThreads?`          | `boolean`                                                                                 | `false` (`true` for the bubble)                            |
| `title?`                | `string`                                                                                  | `"Chat"` (`"AGO Chatbot"` for the bubble)                  |
| `welcomeMessage?`       | `string \| { message: string; mode?: "static" \| "streaming"; speed?; followUpReplies? }` | `"Hello! How can I help you today?"`                       |
| `placeholder?`          | `string`                                                                                  | `"Type a message..."`                                      |
| `allowFiles?`           | `boolean`                                                                                 | `false`                                                    |
| `allowStop?`            | `boolean`                                                                                 | `true` (see [Stop button](#stop-button))                   |
| `height?`               | `string \| number`                                                                        | `500` (ignored for side panels)                            |
| `placement?`            | `"inline" \| "left" \| "right" \| "bubble"`                                               | `"inline"` (see [Floating bubble](#floating-bubble-placement-bubble)) |
| `width?`                | `string \| number`                                                                        | `400` (side panels), `550` (bubble)                        |
| `launcher?`             | `boolean`                                                                                 | `true` (side panels and bubble)                            |
| `defaultOpen?`          | `boolean`                                                                                 | `false` (side panels and bubble)                           |
| `prompt?`               | `string \| false`                                                                         | `"Hello, how can I help you today?"` (bubble teaser)       |
| `icon?`                 | `string`                                                                                  | — (bubble launcher image)                                  |
| `colors?`               | `AgoWidgetColors`                                                                         | — (bubble only)                                            |
| `hideFooter?`           | `boolean`                                                                                 | `false` (bubble only)                                      |
| `subtitle?`             | `string` (markdown)                                                                       | — (bubble home screen)                                     |
| `conversationStarters?` | `Array<{ label: string; message?: string; agentId?: string }>`                            | — (bubble home screen)                                     |
| `autoResume?`           | `boolean`                                                                                 | `true` (bubble only)                                       |
| `loadHomeConfig?`       | `boolean`                                                                                 | `false` (bubble only; home title/subtitle/cards from the dashboard) |
| `labels?`               | `Partial<WidgetLabels>`                                                                   | English strings (bubble only)                              |
| `mobile?`               | `{ breakpoint?: number; trigger?: "tap" \| "focus" \| "manual" }`                         | — (automatic; see [Mobile fullscreen](#mobile-fullscreen)) |
| `logoUrl?`              | `string`                                                                                  | —                                                          |
| `showAgentName?`        | `boolean`                                                                                 | `false`                                                    |
| `agentBubble?`          | `boolean`                                                                                 | `false`                                                    |
| `bubbleStyle?`          | `"default" \| "imessage"`                                                                 | `"default"`                                                |
| `showHeader?`           | `boolean`                                                                                 | `true`                                                     |
| `theme?`                | `WidgetTheme`                                                                             | — (see [Theming](#theming))                                |
| `forms?`                | `Array<CreateFormCollectorOptions \| LoadFormCollectorOptions>`                           | —                                                          |
| `formSubmittedMessage?` | `string \| ((result) => string \| null)`                                                  | server `message`, else `"Form submitted."`                 |
| `feedback?`             | `boolean \| WidgetFeedbackOptions`                                                        | `false` (`true` for the bubble; see [Feedback](#feedback)) |
| `toolCallForm?`         | `WidgetToolCallFormOptions`                                                               | — (see [Ticket form](#ticket-form-the-form-tool-call))     |
| `onFollowUpClick?`      | `((reply) => void) \| false`                                                              | sends the reply                                            |
| `onOpen?`               | `() => void`                                                                              | — (side open / inline expand)                              |
| `onClose?`              | `() => void`                                                                              | — (side close / inline collapse)                           |
| `onMessageSent?`        | `(content) => void`                                                                       | —                                                          |
| `onMessageReceived?`    | `({ id, content }) => void`                                                               | —                                                          |
| `onFormSubmitted?`      | `({ name, values, result }) => void`                                                      | —                                                          |
| `onFormError?`          | `({ name, values, error }) => void`                                                       | —                                                          |

### Feedback

`feedback: true` puts a thumbs up / thumbs down under every finished answer. On
a thumbs-down, a small panel asks what went wrong (four reason chips and a free
-text box).

```ts
mountChatWidget("#ago-chat", {
  config: { baseUrl: "https://playground.api.useago.com", agent: "generic-guide" },
  feedback: true,
});
```

The thumb is sent the moment it is clicked, so the signal survives a visitor who
ignores the panel; sending the panel then files the detailed report. A bare
rating is a reaction (the thumbs counted in the dashboard); a report with reasons
or a comment also lands in the AGO feedback list, the analytics and the CSV
export.

Pass an object to translate the strings or watch what goes out:

```ts
mountChatWidget("#ago-chat", {
  config: { baseUrl: "https://playground.api.useago.com", agent: "generic-guide" },
  feedback: {
    labels: {
      helpful: "Utile",
      notHelpful: "Pas utile",
      whatWentWrong: "Qu'est-ce qui n'a pas marché ?",
      send: "Envoyer",
      thanks: "Merci, c'est remonté.",
      commentPlaceholder: "Autre chose ? (facultatif)",
      reasons: {
        inaccurate: "Inexact",
        incomplete: "Incomplet",
        information_not_found: "Information introuvable",
        technical_issue: "Problème technique",
      },
    },
    onSubmit: ({ messageId, rating, reasons, comment }) => track(rating),
  },
});
```

| Option      | Type                                            | Default |
| ----------- | ----------------------------------------------- | ------- |
| `askWhy?`   | `boolean`                                       | `true` (set `false` for thumbs only) |
| `labels?`   | `Partial<FeedbackLabels>`                       | English strings |
| `onSubmit?` | `({ messageId, rating, reasons, comment }) => void` | — (fires per accepted report: once for the thumb, again for the detailed panel) |
| `onError?`  | `(error: Error) => void`                        | — (the row keeps its state) |

The row's elements carry `ago-feedback*` class names, so host CSS can restyle
them; it ships no stylesheet of its own. The client-level API behind it is
[`submitFeedback`](core.md#6-tool-calls-feedback-and-lifecycle).

### Ticket form (the `form` tool call)

When the visitor asks to talk to a human, the agent's built-in `ago_ticketing`
tool opens a contact form inside the conversation, as a `form` tool call. The
widget renders it the way the hosted widget does, with no option to set:

```ts
mountChatWidget("#ago-chat", {
  config: { baseUrl: "https://YOUR-DOMAIN.api.useago.com", agent: "support-bot" },
});
// Visitor: "I want to talk to someone" → the form appears under the answer.
```

The fields come from the ticket form configured in your AGO dashboard (fetched
once from `GET /config`): subject, typology, priority, the custom fields, the
detailed context, and attachments when the tenant allows them. The form asks
for an email when the client has neither `userEmail` nor `userJwt`. Submitting
creates the ticket (`POST /tickets`), completes the tool call
(`POST /tool-calls/{id}/submit`), and shows a green confirmation with the
ticket link. Fields pre-filled by the agent are kept, and what the visitor types
survives every streamed chunk.

Three variants: the inline form above; an **embedded** form when the ticket
form is in embed mode (the tenant's HubSpot HTML is hosted in place, pre-filled,
and its submission detected); and a yellow notice when the tenant does not allow
this visitor to create a ticket. While a form is pending the composer is
replaced by a "complete the form above" card; once the ticket exists it becomes
"a ticket has been created" with a **New conversation** button, which is also
`widget.newConversation()`.

```ts
mountChatWidget("#ago-chat", {
  config: { baseUrl: "https://YOUR-DOMAIN.api.useago.com", agent: "support-bot" },
  toolCallForm: {
    userEmail: currentUser.email, // skip the email field for a known visitor
    successMessage: "Merci, votre demande est enregistrée.",
    labels: { subject: "Sujet", submit: "Envoyer", detailedContext: "Description" },
    onSubmitted: ({ toolCallId, ticket, values }) => track("ticket", ticket?.id),
    onError: (error) => console.warn("ticket failed", error),
  },
});
```

| Option              | Type                                                        | Default                            |
| ------------------- | ----------------------------------------------------------- | ---------------------------------- |
| `labels?`           | `Partial<ToolCallFormLabels>`                               | English strings                    |
| `successMessage?`   | `string`                                                    | "Your ticket has been successfully submitted." |
| `successUrlLabel?`  | `string`                                                    | "You can find it here:"            |
| `userEmail?`        | `string`                                                    | the client's `userEmail`           |
| `onSubmitted?`      | `({ toolCallId, toolName, mode, ticket, values }) => void` | —                                  |
| `onError?`          | `(error: Error) => void`                                    | —                                  |
| `onNewConversation?`| `() => void`                                                | —                                  |

Only the newest form in a thread is live; an older one is replaced by a short
status line, as in the hosted widget. This is separate from the `forms` option
(form collectors the agent fills through client functions): the two can coexist,
and the ticket form never triggers `onFormSubmitted`. The widget renders no
other tool call type; a `confirmation_input` is yours to handle with
`confirmToolCall` / `rejectToolCall` (see [Tool calls](events-and-streaming.md#tool-calls)).
The client-level calls behind the form are
[`getConfig`, `createTicket`, and `submitToolCallForm`](core.md#6-tool-calls-feedback-and-lifecycle).

### Stop button

While the agent answers, the send button becomes a **Stop** button that
interrupts the turn. The stream closes and the backend is told to stop
generating, so the partial answer stays on screen with status `CANCELED` instead
of the agent finishing in the background. Set `allowStop: false` to keep the
disabled spinner shown by earlier versions.

```ts
const widget = mountChatWidget("#ago-chat", {
  config: { baseUrl: "https://playground.api.useago.com", agent: "generic-guide" },
});

widget.stop(); // same path as the Stop button; no-op when nothing is generating
```

Swap `baseUrl` for your own `https://YOUR-DOMAIN.api.useago.com` once you have a
tenant. See [Stop the answer](core.md#stop-the-answer) for the client-level API.

### Streamed welcome message

By default `welcomeMessage` is a centered placeholder that disappears once the chat
starts. Pass an object with `mode: "streaming"` to greet the visitor with a real
assistant bubble, typed out token-by-token. It plays only on a fresh visit (skipped
when a stored thread is resumed) and `speed` sets the per-token interval in ms.

Add `followUpReplies` to show clickable suggestion pills under the greeting once it
finishes typing. A click sends that text as the first message (the same behavior as
the follow-up replies a turn returns, so `onFollowUpClick` still intercepts it).
`followUpReplies` applies to `mode: "streaming"` only; the static placeholder has no
bubble to attach pills to.

```js
mountChatWidget("#ago-chat", {
  config: { baseUrl: "https://YOUR-DOMAIN.api.useago.com" },
  welcomeMessage: {
    message: "Hi! Tell me about your team and I'll set up a demo.",
    mode: "streaming",
    speed: 45,
    followUpReplies: ["See pricing", "Book a demo", "Talk to a human"],
  },
});
```

`mountChatWidget` returns a handle:
`{ client, element, sendMessage, stop, newConversation, session, threads, refreshThreads, destroy }`
(`session` is present only when `persistConversation` is set; `open`/`close`/`toggle` are present
for side and bubble placements and, in a browser, for inline placement, see
[Side panel](#side-panel-left--right) and [Mobile fullscreen](#mobile-fullscreen); the bubble
adds `screen`, `showScreen`, and `openConversation`). `newConversation()` forgets the current
thread and starts over. `threads` is the visitor's conversation list,
the vanilla equivalent of the React/Vue `useConversation().conversations`. It auto-loads on
mount and refreshes after each turn only when `loadThreads: true`; otherwise it stays empty
until you call `refreshThreads()`. To debug, hand `widget.client` to the [dev panel](devtools.md)
(`initDevPanel({ client: widget.client })`); it shows the installed forms' live state and every
function the agent calls.

> When a form is submitted (forms auto-submit once complete by default), the widget
> appends a green confirmation notice below the conversation. It shows a `message`
> string from the submit response when present, otherwise `formSubmittedMessage`.

To run your own logic on submit (and to catch failures, which show no notice), pass
`onFormSubmitted` / `onFormError`. `result` is the raw submit response (the
third-party API's answer):

```js
mountChatWidget("#ago-chat", {
  config: { baseUrl: "https://YOUR-DOMAIN.api.useago.com" },
  forms: [{ name: "credit" }],
  onFormSubmitted: ({ name, values, result }) => {
    console.log(name, "submitted", result);
  },
  onFormError: ({ name, error }) => {
    console.warn(name, "submit failed:", error);
  },
});
```

These forward the client's `form:submitted` / `form:error` events, so
`widget.client.on("form:submitted", ...)` works too (see
[Events](events-and-streaming.md)).

> Message content is rendered as **GitHub-flavored markdown** (headings, bold,
> italic, strikethrough, inline + fenced code, links, images, ordered/nested
> lists, blockquotes, tables, and rules) by a tiny built-in parser, no extra
> dependencies. All message text is HTML-escaped before it reaches the DOM and
> link/image URLs are scheme-validated, so untrusted agent output can't inject
> markup. The same renderer is exported as `renderMarkdown(source)` →
> `DocumentFragment` if you build a custom vanilla UI.

### Side panel (`left` / `right`)

By default the panel renders **inline**, filling the target element. Set
`placement: "left"` or `"right"` and it instead pins a **fixed, full-height panel**
to that edge of the viewport that slides open and closed; pass `document.body` as
the target for a true page overlay. A circular **launcher button** opens it and a
"×" in the header closes it; the `height` option is ignored (the panel is always
full-height) and the width comes from `width` (default `400`, capped at the
viewport).

```ts
const widget = mountChatWidget(document.body, {
  config: { baseUrl: "https://YOUR-DOMAIN.useago.com" },
  placement: "left", // or "right"
  width: 420, // panel width (number → px)
  // defaultOpen: true,   // start open instead of behind the launcher
  // launcher: false,     // hide the built-in button and drive it yourself
});

// Drive open/close yourself (present only for side placements):
widget.open?.();
widget.toggle?.();
widget.close?.();
```

The panel is themed exactly like the inline one (see [Theming](#theming)); it just
drops its rounded corners and keeps a single divider on the inner edge. The
wrapper, launcher, and close button all carry `ago`-prefixed class names
(`.ago-chat-widget-panel`, `.ago-chat-widget-launcher`, `.ago-chat-widget__close`)
so nothing leaks into the host page.

### Mobile fullscreen

The widget fills the screen on small viewports automatically. There is no flag to
set: a compact inline card behaves like a launcher on a phone, and the side panel
squares off to a full-screen sheet. The `mobile` object only exists to tune this
or hand control back to you.

```ts
mountChatWidget("#ago-chat", {
  config: { baseUrl: "https://YOUR-DOMAIN.api.useago.com" },
  logoUrl: "https://YOUR-DOMAIN/logo.svg", // shown in the fullscreen bar
});
```

The fullscreen bar is the sheet's header. Its leading content reuses the props the
in-card header already uses: it shows `logoUrl` as a logo, or falls back to the
`title` text when there is no logo. Pass `title: ""` for a bar with just the close
button. When `showHeader` is `true`, the in-card header is hidden while full-screen
so the logo/title is not duplicated.

With `placement: "inline"`, the compact card morphs to a fixed full-screen sheet
(with a logo + close bar) when the card is tapped, and back when the user closes
it. The morph uses the [View Transitions API](https://developer.mozilla.org/docs/Web/API/View_Transitions_API)
where available and falls back to an instant swap, tracks the visible viewport so
the input stays above the keyboard, and exposes the sheet as a `role="dialog"`
(Escape closes it). The morph is skipped automatically when the card is already
full-bleed (about full viewport height), so a dedicated full-page chat is left
alone. `open`/`close`/`toggle` are available on the handle (no-ops on a desktop
viewport):

```ts
widget.open?.(); // expand to fullscreen (mobile only)
widget.close?.(); // collapse back to the inline card
```

With `placement: "left" | "right"`, the side panel squares off to a true
full-screen sheet on mobile; the slide-in/out behavior is unchanged. There it is
a real dialog: it takes `role="dialog"` and `aria-modal`, traps Tab, closes on
Escape, locks the page behind it, and tracks the visible viewport so the
on-screen keyboard never covers the composer. Opening it moves focus into the
panel rather than into the text field, so the keyboard does not eat half the
screen before anything has been read.

On a desktop viewport that same panel stays deliberately non-modal: the page
beside it keeps its scroll and its Tab order, because it is still usable.

The page's own scroll lock is restored, not cleared: if your app already pinned
`<body>` (for its own modal, say), the widget puts your inline styles back
exactly as it found them when it releases.

On a mobile viewport message bubbles also run wider (user bubbles to 88%, agent
bubbles to 92%) to reclaim the screen edge on narrow devices. This is automatic and
reflows when the viewport crosses the `breakpoint`.

Tuning (all optional): `breakpoint` is the max viewport width (px) treated as
mobile (default `768`). A short landscape viewport counts as mobile too
(`max-height: 500px` in landscape), so a phone turned sideways keeps the
full-screen sheet and the keyboard handling instead of falling back to the
desktop layout. `trigger` sets how the inline card enters full screen:
`"tap"` (default, expand when anywhere on the card is tapped, while follow-up
replies still send and links still follow), `"focus"` (expand only when the input
is tapped), or `"manual"` (expand only via `widget.open()`). `onOpen` / `onClose` fire on expand/collapse (and on side-panel
open/close). The fullscreen bar and spacer carry `ago`-prefixed class names
(`.ago-chat-widget-mobile-bar`, `.ago-chat-widget-spacer`).

### Resume the last thread across reloads

Set `persistConversation` and the widget resumes the visitor's last active thread
automatically, no manual `localStorage` wiring. It's built on
[`createConversationSession`](core.md#resume-the-visitors-last-thread-with-createconversationsession):
the visitor is identified by a single stable **widget id** (`ago_widget_id`), and the last
active thread (its id + last message time) is cached on the front. On the next mount the
widget decides **without a backend call** whether that thread is still fresh, and if so
fetches its history, so the panel shows the previous messages instead of an empty greeting.
Only threads idle for less than `ttlMs` (default **2h**, sliding) are resumed; a thread with
no recorded last-message time is not.

```ts
const widget = mountChatWidget("#chat", {
  config: { baseUrl: "https://YOUR-DOMAIN.useago.com", agent: "support-bot" },
  persistConversation: true, // localStorage, widget id under `ago_widget_id`, 2h ttl
});

// Customize the storage, ttl, or supply an explicit visitor id:
mountChatWidget("#chat", {
  config: {
    /* … */
  },
  persistConversation: {
    storage: sessionStorage,
    ttlMs: 60 * 60 * 1000,
    widgetId: "visitor-42",
  },
});

widget.session?.clear(); // forget the thread, e.g. a "new chat" button
widget.session?.widgetId; // the stable visitor id (for debugging / correlation)
```

A passed `conversationId` still takes precedence as the initial thread (and its history
loads the same way); `persistConversation` only kicks in when you don't supply one. Without
it, the widget starts on an empty greeting each mount.

### Theming

`mountChatWidget` renders **inline into the host page**
every color, font, and corner radius from a small set of **CSS custom properties**
with built-in fallbacks. A widget with no theming looks exactly as shipped; set a
token and that part of the panel re-skins to match the surrounding page.

There are two ways to set the tokens; they do the same thing, so pick whichever
fits where your brand values live:

**1. Plain CSS** (recommended for anything context-dependent). Target the widget
root, `.ago-chat-widget`:

```css
.ago-chat-widget {
  --ago-font: inherit; /* adopt the page font */
  --ago-brand-color: #2b7fff; /* user bubbles + send button */
  --ago-header-background: #1c2b4a; /* deep brand header */
  --ago-border-color: #e3e7ee;
}

/* CSS unlocks things a one-shot value can't: dark mode, responsive, hover. */
@media (prefers-color-scheme: dark) {
  .ago-chat-widget {
    --ago-panel-background: #0d1117;
    --ago-text-color: #e6edf3;
  }
}
@media (max-width: 700px) {
  .ago-chat-widget {
    --ago-radius: 0;
  } /* flatten for full-bleed mobile */
}
```

**2. The `theme` option** (a typed convenience; sets the same variables for you).
Best when the colors come from JavaScript (a tenant config, a CMS value):

```ts
mountChatWidget("#chat", {
  config: { baseUrl: "https://YOUR-DOMAIN.useago.com" },
  theme: {
    font: "inherit",
    brand: "#2b7fff",
    headerBg: "#1c2b4a",
    border: "#e3e7ee",
  },
});
```

The `theme` keys are a strict subset of what CSS can do (it's set once at mount,
so no media queries or hover); CSS variables override it if both are present.

#### Token reference

| CSS variable                    | `theme` key     | Default                                        | Applies to                                                        |
| ------------------------------- | --------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| `--ago-font`                    | `font`          | IBM Plex Sans stack                            | Whole panel (`inherit` adopts the page font)                      |
| `--ago-radius`                  | `radius`        | `16px`                                         | Panel container corners                                           |
| `--ago-message-radius`          | `messageRadius` | `16px` (`20px` with `bubbleStyle: "imessage"`) | Message bubble and suggested-reply pill corners                   |
| `--ago-brand-color`             | `brand`         | `#03182f`                                      | User bubbles + send button (and header, unless `headerBg` is set) |
| `--ago-brand-text-color`        | `brandText`     | `#fff`                                         | Text on `brand`                                                   |
| `--ago-header-background`       | `headerBg`      | → `brand`                                      | Header background                                                 |
| `--ago-header-text-color`       | `headerText`    | `#e8f0fe`                                      | Header title                                                      |
| `--ago-panel-background`        | `panelBg`       | `#fff`                                         | Container, input row, pills, source cards                         |
| `--ago-messages-background`     | `messagesBg`    | `#fbfbfb`                                      | Scrolling messages area                                           |
| `--ago-text-color`              | `text`          | `#30373e`                                      | Assistant messages, agent name, source labels                     |
| `--ago-muted-text-color`        | `mutedText`     | `#6b6d6f`                                      | Empty-state welcome message                                       |
| `--ago-border-color`            | `border`        | `#dee3e8`                                      | Panel, input, pills, cards (set transparent to hide)              |
| `--ago-accent-color`            | `accent`        | `#1b5fc4`                                      | Source badges + suggested-reply hover outline                     |
| `--ago-agent-bubble-background` | `agentBubbleBg` | `#f1f3f5`                                      | Assistant message bubble fill (when `agentBubble` is on)          |
| `--ago-agent-bubble-text-color` | `agentBubbleText` | → `text`                                     | Assistant message text                                            |
| `--ago-user-bubble-background`  | `userBubbleBg`  | `#fff` (bubble)                                | User message card (`placement: "bubble"`)                         |
| `--ago-user-bubble-text-color`  | `userBubbleText`| `#0a0a0a` (bubble)                             | User message text (`placement: "bubble"`)                         |
| `--ago-launcher-background`     | `launcherBg`    | `#007bff` (bubble)                             | Floating launcher circle (`placement: "bubble"`)                  |
| `--ago-launcher-text-color`     | `launcherText`  | `#fff`                                         | Launcher glyph                                                    |
| `--ago-send-button-background`  | `sendBg`        | → `brand`                                      | Composer send/stop button and ticket form submit (bubble)         |
| `--ago-panel-width`             | `panelWidth`    | `550px`                                        | Bubble panel width (clamped to 400px and the viewport minus 40px) |

With `placement: "bubble"`, `--ago-header-background` accepts a gradient and
`--ago-header-text-color` is derived from it for contrast unless you set it;
`--ago-panel-background` and `--ago-accent-color` there default to the hosted
widget's `#f8faff` and `#003edf`.

Error messages stay red by design, and a couple of incidental tints (file/source
chip background, streaming dots) are fixed neutrals that read on any light surface.
To embed the panel flush inside a frame you already drew, match `--ago-border-color`
to your frame's color (it's shared with the header/input dividers) and set
`--ago-radius` to match, or drop your wrapper's own border and let the widget's be
the single frame.

---

## Embed snippet

Configure `window.AGO` before loading the widget script:

```html
<script>
  window.AGO = {
    basepath: "https://YOUR-DOMAIN.useago.com",
    widgetApiKey: "YOUR-WIDGET-API-KEY",
    defaultAgent: "support-bot",
    title: "Support",
    prompt: "Hi! How can I help?",
  };
</script>
<script
  async
  src="https://useago.github.io/widgetjs/frame.js"
  crossorigin="anonymous"
></script>
```

(Grab the recommended `integrity` hash from your AGO dashboard, and add the
domain where you embed the widget to your allowed domains list.)

The same UI is available without the iframe through
`mountChatWidget(document.body, { placement: "bubble", colors })`, see
[Floating bubble](#floating-bubble-placement-bubble).

---

## Typing the config

```ts
import type { AgoWidgetConfig, AgoWidgetColors } from "@useago/sdk/widget";

const config: AgoWidgetConfig = {
  basepath: "https://YOUR-DOMAIN.useago.com",
  widgetApiKey: "YOUR-WIDGET-API-KEY",
  defaultAgent: "support-bot",
  title: "Support",
  colors: { button: "#03182f", header: "#03182f" },
};

window.AGO = config;
```

The package augments the global `Window` type, so `window.AGO` is typed for you
anywhere this import is in scope.

---

## `AgoWidgetConfig`

| Field                  | Type                      | Description                                        |
| ---------------------- | ------------------------- | -------------------------------------------------- |
| `basepath`             | `string`                  | Your AGO instance URL (required).                  |
| `widgetApiKey`         | `string`                  | Widget API key from your AGO dashboard (required). |
| `defaultAgent?`        | `string`                  | Agent id/slug to start conversations with.         |
| `email?`               | `string`                  | Pre-fill / identify the end user.                  |
| `title?`               | `string`                  | Header title.                                      |
| `icon?`                | `string`                  | URL of the launcher/header icon.                   |
| `prompt?`              | `string`                  | Greeting / opening message.                        |
| `notifications?`       | `boolean`                 | Enable proactive notification bubble.              |
| `notificationMessage?` | `string`                  | Text for the notification bubble.                  |
| `colors?`              | `AgoWidgetColors`         | Theme overrides (see below).                       |
| `hideFooter?`          | `boolean`                 | Hide the "powered by" footer.                      |
| `jwt?` / `authToken?`  | `string`                  | Authenticated-session tokens.                      |
| `permission?`          | `string`                  | Permission name applied to requests.               |
| `metadata?`            | `Record<string, unknown>` | Arbitrary metadata sent with the session.          |

### `AgoWidgetColors`

`button`, `header`, `agentMessage`, `agentMessageFont`, `background`, `font`,
`userMessage`, `userMessageFont`: all optional CSS color strings.

---

## Relationship to the SDK

The widget and the SDK talk to the same AGO backend. Notably, the core SDK's
[`createAgo()`](configuration.md#zero-config-auto-detection) auto-detects an
existing `window.AGO` object, so you can have the embedded widget **and**
script your own SDK-driven interactions on the same page without re-declaring
config.

---

See also: [Core SDK](core.md) · [Configuration](configuration.md)
