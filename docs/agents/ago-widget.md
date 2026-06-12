# AGO SDK skill: embeddable `<script>` widget

You are adding the AGO chat widget to a website with a `<script>` tag. No build
step and no npm install. This is the right approach for a marketing site, a CMS
(WordPress, Webflow), or any server-rendered page where you don't control a JS
bundle. For a React/Vue/Angular app, use the framework binding instead. This file
is everything you need. Follow it exactly.

## Endpoint

Set `basepath` to the project's AGO instance, `https://YOUR-DOMAIN.api.useago.com`.
Grab the widget API key and the recommended `integrity` hash from the AGO
dashboard, and add the embedding domain to the dashboard's allowed-domains list.

## 1. Add the widget script

Configure `window.AGO` BEFORE loading the script, and place both tags just before
the closing `</body>` tag (not in `<head>`).

```html
<script>
  window.AGO = {
    basepath: "https://YOUR-DOMAIN.api.useago.com",
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

A floating chat bubble appears in the bottom-right corner. The panel itself is an
iframe, so it cannot leak styles into the host page.

## 2. Customize appearance

```html
<script>
  window.AGO = {
    basepath: "https://YOUR-DOMAIN.api.useago.com",
    widgetApiKey: "YOUR-WIDGET-API-KEY",
    title: "Support",
    icon: "https://example.com/logo.svg",
    colors: {
      button: "#4F46E5",
      header: "#4F46E5",
      userMessage: "#4F46E5",
      userMessageFont: "#FFFFFF",
    },
  };
</script>
```

## 3. Identify the user (optional)

```html
<script>
  window.AGO = {
    basepath: "https://YOUR-DOMAIN.api.useago.com",
    widgetApiKey: "YOUR-WIDGET-API-KEY",
    email: "user@example.com",
    jwt: "jwt-token-here",
    metadata: { plan: "pro", company: "Acme Inc" },
  };
</script>
```

## 4. Framework-specific placement

**Next.js (App Router)**, in `app/layout.tsx`:

```tsx
export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.AGO = { basepath: "${process.env.NEXT_PUBLIC_AGO_BASE_URL}", widgetApiKey: "${process.env.NEXT_PUBLIC_AGO_WIDGET_KEY}" };`,
          }}
        />
        <script async src="https://useago.github.io/widgetjs/frame.js" crossOrigin="anonymous" />
      </body>
    </html>
  );
}
```

**WordPress**: add both tags via the theme's `footer.php` or a "Custom HTML"
widget placed in a footer area.

**Webflow**: Project Settings > Custom Code > Footer Code.

## 5. Type the config (TypeScript projects)

The SDK ships the types and augments the global `Window`, so `window.AGO` is typed
anywhere this import is in scope:

```ts
import type { AgoWidgetConfig } from "@useago/sdk/widget";

const config: AgoWidgetConfig = {
  basepath: "https://YOUR-DOMAIN.api.useago.com",
  widgetApiKey: "YOUR-WIDGET-API-KEY",
  defaultAgent: "support-bot",
};
window.AGO = config;
```

## `AgoWidgetConfig` reference

| Field            | Type    | Description |
| ---------------- | ------- | ----------- |
| `basepath`       | string  | AGO instance URL (required) |
| `widgetApiKey`   | string  | Widget API key from the dashboard (required) |
| `defaultAgent?`  | string  | Agent id/slug to start conversations with |
| `email?`         | string  | Identify the end user |
| `title?`         | string  | Header title |
| `icon?`          | string  | Launcher/header icon URL |
| `prompt?`        | string  | Greeting / opening message |
| `notifications?` | boolean | Enable a proactive notification bubble |
| `colors?`        | object  | `button`, `header`, `agentMessage`, `background`, `font`, `userMessage`, ... |
| `hideFooter?`    | boolean | Hide the "powered by" footer |
| `jwt?`           | string  | Authenticated-session token |
| `metadata?`      | object  | Arbitrary key-value pairs sent with the session |

## When to use `mountChatWidget` instead

If the project is a pure TS/JS app where you DO control the DOM (but use no
framework), prefer `mountChatWidget` from `@useago/sdk/widget`: it renders an
inline panel instead of a floating iframe and supports conversational forms. See
the plain JS/TS skill for that.

## Checklist before you finish

1. The `window.AGO` config script comes BEFORE the `frame.js` script.
2. Both tags are just before `</body>`, not in `<head>`.
3. `basepath` and `widgetApiKey` are set.
4. The embedding domain is on the dashboard's allowed-domains list.
5. Reload the page and confirm the chat bubble appears bottom-right; check the
   browser console for errors if it doesn't.
