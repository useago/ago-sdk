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
| Renders                   | floating bubble (iframe)  | inline panel, or fixed side panel  |
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
widget.destroy(); // removes listeners, uninstalls forms, clears the DOM
```

### Options

| Option                  | Type                                                                                      | Default                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `client?`               | `AgoClient`                                                                               | — (provide this **or** `config`)                           |
| `config?`               | `AgoConfig`                                                                               | — (needs at least `baseUrl`)                               |
| `conversationId?`       | `string`                                                                                  | —                                                          |
| `persistConversation?`  | `boolean \| Partial<ConversationSessionOptions>`                                          | — (off)                                                    |
| `loadThreads?`          | `boolean`                                                                                 | `false`                                                    |
| `title?`                | `string`                                                                                  | `"Chat"`                                                   |
| `welcomeMessage?`       | `string \| { message: string; mode?: "static" \| "streaming"; speed?; followUpReplies? }` | `"Hello! How can I help you today?"`                       |
| `placeholder?`          | `string`                                                                                  | `"Type a message..."`                                      |
| `allowFiles?`           | `boolean`                                                                                 | `false`                                                    |
| `height?`               | `string \| number`                                                                        | `500` (ignored for side panels)                            |
| `placement?`            | `"inline" \| "left" \| "right"`                                                           | `"inline"`                                                 |
| `width?`                | `string \| number`                                                                        | `400` (side panels only)                                   |
| `launcher?`             | `boolean`                                                                                 | `true` (side panels only)                                  |
| `defaultOpen?`          | `boolean`                                                                                 | `false` (side panels only)                                 |
| `mobile?`               | `{ breakpoint?: number; trigger?: "focus" \| "tap" \| "manual" }`                         | — (automatic; see [Mobile fullscreen](#mobile-fullscreen)) |
| `logoUrl?`              | `string`                                                                                  | —                                                          |
| `showAgentName?`        | `boolean`                                                                                 | `false`                                                    |
| `agentBubble?`          | `boolean`                                                                                 | `false`                                                    |
| `bubbleStyle?`          | `"default" \| "imessage"`                                                                 | `"default"`                                                |
| `showHeader?`           | `boolean`                                                                                 | `true`                                                     |
| `theme?`                | `WidgetTheme`                                                                             | — (see [Theming](#theming))                                |
| `forms?`                | `Array<CreateFormCollectorOptions \| LoadFormCollectorOptions>`                           | —                                                          |
| `formSubmittedMessage?` | `string \| ((result) => string \| null)`                                                  | server `message`, else `"Form submitted."`                 |
| `onFollowUpClick?`      | `((reply) => void) \| false`                                                              | sends the reply                                            |
| `onOpen?`               | `() => void`                                                                              | — (side open / inline expand)                              |
| `onClose?`              | `() => void`                                                                              | — (side close / inline collapse)                           |
| `onMessageSent?`        | `(content) => void`                                                                       | —                                                          |
| `onMessageReceived?`    | `({ id, content }) => void`                                                               | —                                                          |
| `onFormSubmitted?`      | `({ name, values, result }) => void`                                                      | —                                                          |
| `onFormError?`          | `({ name, values, error }) => void`                                                       | —                                                          |

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
`{ client, element, sendMessage, session, threads, refreshThreads, destroy }` (`session` is
present only when `persistConversation` is set; `open`/`close`/`toggle` are present for side
placements and, in a browser, for inline placement, see [Side panel](#side-panel-left--right)
and [Mobile fullscreen](#mobile-fullscreen)). `threads` is the visitor's conversation list,
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
(with a logo + close bar) when the input is engaged, and back when the user closes
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
full-screen sheet on mobile; the slide-in/out behavior is unchanged.

On a mobile viewport message bubbles also run wider (user bubbles to 88%, agent
bubbles to 92%) to reclaim the screen edge on narrow devices. This is automatic and
reflows when the viewport crosses the `breakpoint`.

Tuning (all optional): `breakpoint` is the max viewport width (px) treated as
mobile (default `768`); `trigger` sets how the inline card enters full screen:
`"focus"` (default, expand when the input is tapped), `"tap"` (expand when
anywhere on the card is tapped, while follow-up replies still send and links still
follow), or `"manual"` (expand only via `widget.open()`). `onOpen` / `onClose` fire on expand/collapse (and on side-panel
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
