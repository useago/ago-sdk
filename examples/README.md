# Examples

Runnable example apps for `@useago/sdk`, one per stack.

| Example | Stack | Entry |
| --- | --- | --- |
| `simple-react/` | React + Vite | `npm run dev` |
| `glacerie/` | React + Vite (ice-cream shop: functions + navigation) | `npm run dev` |
| `simple-vue/` | Vue 3 + Vite | `npm run dev` |
| `simple-angular/` | Angular | `npm run dev` |
| `simple-ts/` | Vanilla TypeScript | `npm run dev` |
| `simple-html/` | Plain HTML (no build) | open the `.html` file |
| `vue-widget/` | Embeddable widget in Vue | open `index.html` |

The examples default to the public demo backend (`https://ago.api.useago.com`,
agent `generic-guide`), so they answer out of the box. Point `baseUrl` at your
own domain (e.g. `https://YOUR-DOMAIN.api.useago.com`) to chat with your agents.

## Two ways to depend on the SDK

The bundled `package.json` files use a **local monorepo link** so the examples
track your local source:

```json
"@useago/sdk": "file:../.."
```

This requires building the SDK first (`npm install && npm run build` from `sdk/`).

To run an example **as an external user would** (against the published package),
swap that line for the released version and reinstall:

```jsonc
// in the example's package.json
"@useago/sdk": "^1.0.0"
```

```bash
npm install
npm run dev
```

### Plain HTML / CDN

The `simple-html/` files import the published package from a CDN
(`https://esm.sh/@useago/sdk@1/...`), so opening any of them directly in a
browser works with no build step and no server.

Working on the SDK source itself? Each file has a commented swap to the local
build (`../../dist/*.js`). Build first (`npm install && npm run build` at the
repo root), serve the repo (`python3 -m http.server`), and open
`http://localhost:8000/examples/simple-html/chat-widget.html` — `file://` pages
cannot import local modules.

## Building the SDK locally

From the `sdk/` directory:

```bash
npm install
npm run build      # produces dist/ consumed by the file:../.. examples
```

See the [main README](../README.md) and the [docs](https://ago.mintlify.app) for the
full API.
