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
