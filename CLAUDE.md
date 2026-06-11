# AGO SDK

JavaScript/TypeScript SDK for integrating AGO chat functionality.

## Directory Structure

- `src/client/` - Core AgoClient class and types
- `src/api/` - HTTP client and API endpoint wrappers
- `src/streaming/` - SSE stream handling
- `src/functions/` - Client-side function registration
- `src/react/` - React components and hooks
- `src/utils/` - Shared utilities
- `tests/` - Test files

## Development

```bash
npm install
npm run dev      # Watch mode
npm run build    # Production build
npm test         # Run tests
npm run lint     # Lint code
npm run typecheck # Type check
```

## Key Patterns

- All API calls go through `HttpClient` which handles auth headers
- SSE streaming is handled by `SSEHandler` class
- Client-side functions are registered via `FunctionRegistry`
- React components are optional (peer dependency)

## Documentation (keep it simple)

Docs exist so a developer can try the SDK in minutes. Optimize for that, not for
completeness.

- **A new reader must understand it right away.** The top of any doc (and the
  README) leads with a copy-paste-runnable example, not prose or reference tables.
- **Show, don't catalogue.** Prefer one working snippet over an exhaustive option
  list. Push deep reference (full prop/option/event tables) below the fold or into
  a dedicated page; in the README, collapse them behind `<details>`.
- **Use the live endpoint** `https://ago.api.useago.com` in runnable examples so
  readers get a real response with zero setup. Note they swap it for their own
  `https://YOUR-DOMAIN.api.useago.com` when they have a tenant.
- **Lead with the three things devs test first:** (1) send a message and see a
  response, (2) let the agent navigate/act on their app, (3) a short map of what
  else is possible. See `docs/general/getting-started.md`.
- Short sentences. Link to deeper guides instead of inlining everything.
- **No AI-style writing.** The em-dash "—" is forbidden; use a period, comma,
  colon, or parentheses instead. Also avoid the other tells: "it's not just X,
  it's Y" constructions, rule-of-three lists ("fast, simple, and powerful"),
  hype adjectives ("seamless", "powerful", "robust", "supercharge"), starting
  sentences with "Whether you're...", and emoji sprinkled through prose. Write
  like a developer explaining to another developer.
- **A big README is fine:** the most important info should live there so a reader
  finds it without leaving the page. "Simple" means the top is instantly runnable
  and the layout is scannable (lead with the example, collapse reference behind
  `<details>`), not that the file is short. Don't strip out important content to
  make it shorter; structure it so the key path is obvious and the depth is still
  one scroll (or one `<details>`) away.

## Scoping (must not clobber the host app)

The SDK is embedded into third-party pages, so its CSS and JS must never override
anything that already exists in the host application.

- **No global style leakage.** Prefer inline styles on React elements (they cannot
  bleed). If you must inject a `<style>`/stylesheet, scope every rule under an
  `ago`-prefixed id/class (e.g. `#ago-dev-panel .dev-log`) — never emit bare element,
  `*`, or reset selectors.
- **Namespace every global identifier.** DOM ids, `@keyframes` names, custom-element
  names, `localStorage`/`sessionStorage` keys, and `data-*` attributes must be
  `ago`-prefixed (`ago-dev-panel`, `ago_widget_id`, `@keyframes ago-pulse`).
- **Theme via `--ago-*` tokens, not hardcoded values.** The widget's visible
  colors/font/radius are the public theming contract: render them as
  `var(--ago-token, default)` (see `THEME_VARS` / the `var()` constants in
  `widget/createChatWidget.ts`) so host CSS and the `theme` option can re-skin the
  panel. Don't inline a raw hex where a token belongs; keep the `theme` keys,
  `THEME_VARS`, and `docs/general/widget.md`'s token table in sync.
- **No global JS pollution.** Never assign to `window.*` / `globalThis.*`. Keep
  `sideEffects: false` true — importing the SDK must not mutate the page.
- `className` props on components are consumer hooks only; the SDK ships no CSS that
  targets them.

## Testing

Tests use Vitest. Run with `npm test`.
