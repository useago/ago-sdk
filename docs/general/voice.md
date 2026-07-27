# Voice

Live voice conversations with your agent: microphone in, agent audio out, and
every finalized turn persisted into the same conversation thread as chat.

> **Voice is currently access-gated; installing the SDK does not enable it.
> Ask AGO to enable voice for your tenant and agent.** Until both flags are on,
> `useAgoVoice().availability` resolves to `policy-unavailable` and the voice
> components render nothing.

## Try it in two minutes (no mic, no HTTPS, no backend)

The mock client drives the full voice UI end-to-end: consent, permission,
connecting, live turns with streaming captions and level pulses, then call end.
Paste this into any React app (or a Storybook story) and press the mic:

```tsx
import { AgoProvider } from "@useago/sdk/react";
import {
  AgoVoiceBar,
  AgoVoiceButton,
  AgoVoiceCaptions,
  useAgoVoice,
} from "@useago/sdk/react";
import { createMockClient, mockVoiceConversation } from "@useago/sdk/testing";

const mock = createMockClient();
mockVoiceConversation(mock, {
  turns: [
    {
      user: "Where is my order?",
      assistant: "Order 1042 shipped this morning and arrives Thursday.",
    },
  ],
});

function VoiceSandbox() {
  const voice = useAgoVoice();
  return (
    <div style={{ maxWidth: 380, display: "grid", gap: 8 }}>
      <AgoVoiceButton voice={voice} />
      <AgoVoiceBar voice={voice} />
      <AgoVoiceCaptions voice={voice} />
    </div>
  );
}

export function App() {
  return (
    <AgoProvider client={mock}>
      <VoiceSandbox />
    </AgoProvider>
  );
}
```

In tests, the same script is deterministic under fake timers; see
[Testing voice UIs](#testing-voice-uis).

## Prerequisites for real calls

Work through this checklist before writing code; each miss has a typed
availability reason or error code, never a silent failure:

1. **Tenant flag**: AGO enabled voice for your tenant (`tenant-disabled`
   otherwise).
2. **Agent flag**: the agent you target is a voice agent (`agent-not-voice`
   otherwise).
3. **A signed user JWT**: `userJwt` or `getUserJwt` in the config.
   `userEmail` and anonymous widget ids do not qualify (`jwt-missing` /
   `jwt-required`).
4. **HTTPS**: voice needs a secure context; `localhost` is the only HTTP
   exception (`insecure-context`).
5. **Origin allow-listed**: the exact page origin, scheme, host and port, must
   be on your tenant's allow-list (`origin-not-allowed`).
6. **CSP**: if you ship a Content-Security-Policy, see [the CSP
   section](#content-security-policy) (`csp-blocked`).

One console read replaces the whole checklist:

```ts
await client.voice.checkAvailability();
// [AGO] voice availability: policy-unavailable (jwt-missing)
//   secure context:  true
//   worklet support: true
//   auth kind:       anonymous
//   tenant gate:     true
//   agent gate:      true
```

## Real integration (React)

```tsx
"use client"; // Next.js: voice is browser-only

import { useEffect, useState } from "react";
import {
  AgoProvider,
  AgoVoiceBar,
  AgoVoiceButton,
  AgoVoiceCaptions,
  useAgoClient,
  useAgoVoice,
  useMessages,
} from "@useago/sdk/react";
import type { VoicePersistedAck } from "@useago/sdk";

export function Root() {
  return (
    <AgoProvider
      baseUrl="https://YOUR-DOMAIN.api.useago.com"
      agent="your-voice-agent"
      getUserJwt={async () => {
        // Return a fresh signed JWT for the logged-in user. The SDK calls
        // this to refresh the bearer and retries once on jwt_required.
        const res = await fetch("/api/ago-jwt");
        return (await res.json()).jwt;
      }}
    >
      <ChatWithVoice />
    </AgoProvider>
  );
}

function ChatWithVoice() {
  const client = useAgoClient();
  const voice = useAgoVoice();
  const { messages } = useMessages({ conversationId: voice.conversationId });
  const voiceForConversation = {
    ...voice,
    start: () => voice.start({ conversationId: voice.conversationId }),
  };

  // Finalized voice turns are persisted into the thread and acked with their
  // authoritative messageId. Merge them into your list; never key on
  // turnIndex (it resets on reconnect).
  const [voiceRows, setVoiceRows] = useState<VoicePersistedAck[]>([]);
  useEffect(() => {
    const onPersisted = (ack: VoicePersistedAck) =>
      setVoiceRows((rows) =>
        rows.some((r) => r.messageId === ack.messageId) ? rows : [...rows, ack]
      );
    client.on("voice:persisted", onPersisted);
    return () => client.off("voice:persisted", onPersisted);
  }, [client]);

  return (
    <div style={{ maxWidth: 380, display: "grid", gap: 8 }}>
      <div>
        {messages.map((m) => (
          <p key={m.id}>
            <b>{m.role}:</b> {m.content}
          </p>
        ))}
        {voiceRows
          .filter((row) => !messages.some((m) => m.id === row.messageId))
          .map((row) => (
            <p key={row.messageId}>
              <b>{row.role} (voice):</b> {row.text}
            </p>
          ))}
        {/* Live captions render IN the message list, never in the bar. */}
        <AgoVoiceCaptions voice={voice} />
      </div>

      {/* The bar owns status, level meter, mute and end-call. It also renders
          errors inline with Retry and dismiss, so no extra error UI is
          needed. */}
      <AgoVoiceBar voice={voice} />

      {/* Renders nothing until availability resolves to "available"; shows a
          built-in consent disclosure on first use. */}
      <AgoVoiceButton voice={voiceForConversation} />
    </div>
  );
}
```

Cleanup is automatic: the provider destroys the client on unmount, which stops
any live session and releases the microphone. To end a call from code, call
`voice.stop()`.

The hook subscribes to `client.voice`, the lazy singleton session owner. It
never creates a session of its own, so any number of components can share one
call, and unmounting a component does not end it.

## Vocabulary

One vocabulary, stable for the 1.x line. The engine keeps three orthogonal
state axes; UIs consume the derived bar state.

| Axis | Values |
| --- | --- |
| `status` (lifecycle) | `idle`, `requesting-permission`, `connecting`, `live`, `reconnecting`, `error`, `ended` |
| `turn` (while live) | `listening`, `user-speaking`, `agent-thinking`, `agent-speaking` |
| flags | `muted`, `degraded`, `consentPending` |
| `availability` | `loading`, `available`, `policy-unavailable`, `unsupported` |
| `unavailableReason` | `tenant-disabled`, `agent-not-voice`, `jwt-missing`, `insecure-context`, `worklet-unsupported`, `csp-blocked` |

`resolveBarState(status, turn, flags)` folds the axes into the single value a
status UI renders: `requesting-permission`, `connecting`, `listening`,
`user-speaking`, `agent-thinking`, `agent-speaking`, `muted`, `reconnecting`,
`degraded`, `error`, `ended`. Lifecycle beats flags, flags beat turn, and
muted beats degraded. Import it from `@useago/sdk/react` or `@useago/sdk/voice`
if you build your own bar.

`useAgoVoice()` returns
`{ availability, unavailableReason, status, turn, muted, degraded,
consentPending, captions, level, error, endedReason, conversationId, start,
stop, toggleMute, acceptConsent, cancelConsent, retry, dismissError }`.
Components take it as a single object: `<AgoVoiceBar voice={voice} />`.

Events on the client emitter: `voice:status`, `voice:transcript`,
`voice:turn-final`, `voice:persisted`, `voice:thread-ready`, `voice:level`,
`voice:error`, `voice:ended`.

## Components

Three controlled presentation primitives over `useAgoVoice`. They never create
a session, never touch the microphone on their own, and are safe to import
during SSR (no browser API is touched at import or first render).

- **`<AgoVoiceButton voice={voice} />`**: the mic affordance. Renders nothing
  until `availability` is `"available"` (never a disabled dangling mic). The
  first press shows a built-in minimal consent disclosure (two buttons, all
  copy overridable via `labels`, `renderConsent` for a fully custom UI);
  consent is on by default (`voice: { requireConsent: false }` in the config
  turns it off). While a call is active the button ends it.
- **`<AgoVoiceBar voice={voice} />`**: status, mic level meter, mute and
  end-call. It never renders transcript text. Errors replace the bar content
  with the message, a primary Retry and an icon dismiss. On call end it shows
  "Call ended" for about 1.2 seconds, fades, and returns focus to the button.
  In-flow, no z-index, inherits the host font.
- **`<AgoVoiceCaptions voice={voice} />`**: the live caption layer for your
  message list. The assistant caption streams; the user side shows a speaking
  indicator only, because user captions are final-only on the wire.

All three forward `className`, `style`, `id`, `data-*`, `aria-*` and `ref`.
Unknown future status values render as a generic status instead of crashing.

The components are `@experimental` for now: their props may still move while
voice is access-gated. The hook shape, event names and error codes are stable.

### Accessibility

Ported from the shipped AGO voice UI and covered by tests: focus moves to End
on call start and back to the mic button on end or dismiss; Esc ends the call;
the bar status is `role="status" aria-live="polite"` and announces state
changes only, never transcript; the captions region is `aria-live="off"`; the
meter is `role="meter"` and never announced per update; every target is at
least 44px; focus rings use the `--ago-voice-focus-ring` token; layout uses
logical properties (RTL works); all animation is non-essential and disabled
under `prefers-reduced-motion`.

### Theming tokens

Set these on any ancestor. Each falls back into the widget's `--ago-*` theme
tokens where one exists, then a hard default, so a themed widget and the voice
UI stay consistent with zero configuration.

| Token | Role | Fallback |
| --- | --- | --- |
| `--ago-voice-surface` | bar and consent background | `--ago-panel-background`, `#fff` |
| `--ago-voice-border` | borders, meter track | `--ago-border-color`, `#dee3e8` |
| `--ago-voice-text` | primary text | `--ago-text-color`, `#30373e` |
| `--ago-voice-text-muted` | sub-lines, consent body | `--ago-muted-text-color`, `#6b6d6f` |
| `--ago-voice-accent` | primary actions, active mic | `--ago-accent-color`, `#1b5fc4` |
| `--ago-voice-destructive` | end-call, error text | `#b3261e` |
| `--ago-voice-focus-ring` | focus outline | `--ago-voice-accent` chain |
| `--ago-voice-radius` | corner radius | `--ago-radius`, `12px` |
| `--ago-voice-meter-fill` | level meter fill | `--ago-voice-accent` chain |

The components inherit the host font. Styling is inline plus one injected
`<style id="ago-voice-styles">` scoped to `ago-voice-*` classes (keyframes,
reduced-motion, forced-colors), so nothing leaks into the host page.

### Labels

`labels: Partial<Record<AgoVoiceLabelKey, string>>` on every component.

| Key | Default |
| --- | --- |
| `start` | Start voice call |
| `requesting-permission` | Waiting for microphone… |
| `connecting` | Connecting… |
| `listening` / `user-speaking` | Listening |
| `agent-thinking` | Thinking… |
| `agent-speaking` | Speaking |
| `muted` | Muted |
| `reconnecting` | Reconnecting… |
| `degraded` | Connection degraded |
| `ended` | Call ended |
| `consent-title` | Start a voice call? |
| `consent-body` | Your microphone will be shared with the voice agent and the conversation is transcribed into this chat. |
| `consent-accept` / `consent-cancel` | Start call / Cancel |
| `mute` / `unmute` / `end` / `cancel` | Mute / Unmute / End call / Cancel |
| `retry` / `dismiss` | Retry / Dismiss |
| `meter` | Microphone level |
| `user-speaking-indicator` | You are speaking |
| `error-<code>` | the registry message of that error code |

Example: `labels={{ "error-mic-denied": "Micro bloque. Autorisez-le, puis reessayez." }}`.

## Error codes

Every voice failure is an `AgoVoiceError` with a stable kebab-case `code` from
this closed registry, `retryable`, optional `retryAfter` (seconds), the raw
server reason as `serverReason`, and a `docUrl` pointing at the matching
heading below. Errors are emitted as `voice:error` and always logged with
`console.error`. Match on `code`, never on message text.

```ts
client.on("voice:error", (error) => {
  if (error.code === "jwt-required") promptLogin();
});
```

### mic-denied

The user blocked microphone access. Retryable: ask them to allow the mic in
the browser's address bar, then call `retry()`. The bar's built-in error state
carries this copy already.

### no-mic

No microphone exists on the device (or the requested `inputDeviceId` matched
nothing). Not retryable without hardware changes.

### mic-busy

Another application holds the microphone. Retryable after closing it.

### mic-lost

The microphone was disconnected or its permission revoked mid-call. The
session ends; a new `start()` is required.

### insecure-context

The page is not a secure context, so `navigator.mediaDevices` does not exist.
Voice requires HTTPS; `localhost` is the only HTTP exception. Typical trigger:
testing on `http://<LAN-IP>`.

### worklet-unsupported

The browser lacks the AudioWorklet APIs voice needs. Not retryable; hide the
affordance (availability already reports `unsupported`).

### csp-blocked

The page's Content-Security-Policy blocked loading the audio worklet from a
`blob:` URL. The error detail names the exact violated directive. Fix the
policy (see [Content-Security-Policy](#content-security-policy)).

### audio-init-failed

Audio setup failed for a reason other than CSP (worklet load, audio graph).
Voice is not usable in this environment.

### jwt-required

The most common first error: voice minting requires an authenticated AGO user.
Anonymous widget ids and `userEmail` do not qualify. Provide a signed JWT via
`userJwt` or `getUserJwt`, then retry. With a `getUserJwt` provider configured
the SDK refreshes the token and retries once automatically; without one it
surfaces immediately, because retrying the same stored token is useless.

### mint-failed

Creating the voice session grant failed (5xx, network, malformed response).
Retryable; the SDK already spends one budgeted retry with backoff.

### rate-limited

Too many session requests (HTTP 429). Never auto-retried; honor the wait.

### connect-failed

The WebSocket did not reach the voice service (or no `ready` arrived in time).
Retryable; the SDK spends its single reconnect budget first.

### connection-lost

A live connection dropped and the reconnect budget was already spent.

### invalid-token

The session token was rejected: expired (60 second TTL) or already used. The
SDK re-mints and retries once transparently; seeing this error means that
retry also failed.

### origin-not-allowed

The page origin is not allow-listed for voice. The allow-list matches the
exact normalized origin: scheme, host and port. Ask AGO to add the exact
origin your app runs on.

### kill-switch

Voice is temporarily disabled by the operator. Not retryable client-side.

### concurrent-cap

The tenant's concurrent voice session cap is reached. Try again later.

### daily-minutes-cap

The tenant's daily voice minutes cap is reached. Try again tomorrow.

### backend-unavailable

The voice backend is temporarily unavailable. The SDK retries once (honoring
`retryAfter`); seeing this error means the retry failed too.

### server-error

The voice server reported an error the SDK does not recognize. The raw reason
is preserved in `serverReason`.

### voice-unavailable

The mint was refused because voice is not enabled for this tenant or agent.
Ask AGO to enable it. UIs should never reach this state: availability gating
hides the mic first.

### session-active

`start()` was called while a session is already active. One client owns at
most one session; call `stop()` first. The prebuilt button never triggers
this.

### session-destroyed

The session was used after `client.destroy()`. Create a new client.

## Content-Security-Policy

Voice loads its audio worklets from `blob:` URLs and streams audio over a
WebSocket. A locked-down CSP must allow both. This policy is tested against
current Chromium, which governs Blob worklet module loading through
`script-src` (not only `worker-src`), so both directives carry `blob:`:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' blob:;
  worker-src 'self' blob:;
  connect-src 'self' https://YOUR-DOMAIN.api.useago.com wss://YOUR-DOMAIN.api.useago.com;
```

If your app embeds the voice UI inside an iframe, the frame must be allowed to
use the microphone:

```html
<iframe src="..." allow="microphone"></iframe>
```

When the policy blocks the worklet anyway, the SDK reports `csp-blocked` with
the exact violated directive in the error detail, so you know which line to
fix.

## Troubleshooting with devtools

`initDevPanel({ client })` (from `@useago/sdk/devtools`) shows a live voice
status line and event log. Patterns and their causes:

| Pattern in the panel | Likely cause |
| --- | --- |
| status stays `connecting`, then `error connect-failed` | WebSocket host unreachable: check `connect-src` in your CSP and that the `wsUrl` host resolves |
| auth sent but no `ready` (ends in `invalid-token` or `origin-not-allowed`) | token expired before the socket opened, or the page origin is not the exact allow-listed origin (port included) |
| `ready` arrives but no `transcript` ever | the mic is muted, the wrong input device is selected, or audio frames are not flowing: watch whether the meter pulses when you speak |
| `transcript` finals but no `persisted` acks | backend persistence is failing; finalized turns will appear in the thread after the call via refetch |
| status flips to `reconnecting` mid-call | network drop; the SDK reconnects once, and the agent loses its in-call memory (see gotchas) |
| `error csp-blocked (blocked directive: ...)` | your Content-Security-Policy; apply the tested policy above |

## Gotchas

1. Voice is access-gated: installing the SDK does not enable it. Ask AGO to enable voice for your tenant and agent.
2. Voice requires a signed user JWT (`userJwt` or `getUserJwt`). `userEmail` and anonymous widget ids are not authentication.
3. Do not render a mic before `availability` resolves: render nothing while it is `"loading"`, and never render a mic when it is unavailable.
4. Voice requires HTTPS. `localhost` is the only HTTP exception.
5. The exact page origin, including the port, must be allow-listed for voice. `https://app.example.com` and `https://app.example.com:8443` are different origins.
6. User captions are final-only: the assistant caption streams word by word, while the user side shows a speaking indicator until the final transcript lands. This is protocol behavior, not a bug.
7. Captions render in the message list (`AgoVoiceCaptions`), never in the bar. The bar owns status, meter, mute and end-call only.
8. If your page ships a Content-Security-Policy, allow `blob:` in `worker-src` (and in `script-src`, which governs Blob worklets in some Chromium versions), add the voice WebSocket host to `connect-src`, and set `allow="microphone"` on any embedding iframe.
9. A reconnect starts a new model session: the agent loses its in-call memory of earlier turns. Persisted turns stay safe in the thread.
10. Voice can invoke registered SDK client functions and receives the current
    client context. Functions covered by `requiresApproval` or `approvalPolicy`
    fail closed with `approval_required`; protected actions must be completed
    through the text approval flow until voice approvals are introduced.
11. Voice is browser-only. In Next.js, put `"use client"` on components that use it; the SDK touches no browser API at import time.
12. One active voice session per client: a second `start()` while one is active rejects with the `session-active` error. Call `stop()` first.

## Testing voice UIs

`mockVoiceConversation` (from `@useago/sdk/testing`) scripts a whole call with
no microphone, WebSocket, or backend. It is timer-driven: under fake timers it
steps deterministically, under real timers it animates.

```ts
import { vi } from "vitest";
import { createMockClient, mockVoiceConversation } from "@useago/sdk/testing";

vi.useFakeTimers();
const mock = createMockClient();
const handle = mockVoiceConversation(mock, {
  turns: [{ user: "Where is my order?", assistant: "It ships today." }],
  stepMs: 100,
});

await handle.play(); // start + consent, no button needed
await vi.advanceTimersByTimeAsync(5000);
await handle.finished;
```

`mock.voice` also exposes `__setVoiceState(partial)` and
`__emitVoiceEvent(event, data)` for pinpoint state tests, and every call is
recorded in `mock.__calls` as `voice.<method>`.

## Beyond React

The engine is framework-agnostic. `client.voice` (on the core client) exposes
`start`, `stop`, `toggleMute`, `acceptConsent`, `cancelConsent`,
`checkAvailability`, `getState`, `on`/`off` and `destroy`; the full engine
also ships on the `@useago/sdk/voice` subpath. Chat-only bundles carry none of
the audio code: the engine loads through a dynamic import on first use.

Continue an existing typed conversation by passing its ID when the call starts;
omit it to let AGO create a new conversation and report that ID through
`voice:thread-ready`:

```ts
voice.start({ conversationId });
```

Device selection uses the same `start()` options:
`voice.start({ conversationId, inputDeviceId, mediaConstraints })`.

---

See also: [Configuration & auth](configuration.md) · [Events & streaming](events-and-streaming.md) · [Testing](testing.md) · [Dev panel](devtools.md)
