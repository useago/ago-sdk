# Examples

Runnable example apps for `@useago/sdk`, one per stack.

| Example | Stack | Entry |
| --- | --- | --- |
| `simple-react/` | React + Vite | `npm run dev` |
| `react-sidebar-doc/` | React + Vite (chat folds into a sidebar, shows the top cited document) | `npm run dev` |
| `glacier/` | React + Vite (ice-cream shop: functions + navigation) | `npm run dev` |
| `simple-vue/` | Vue 3 + Vite | `npm run dev` |
| `simple-angular/` | Angular | `npm run dev` |
| `simple-ts/` | Vanilla TypeScript | `npm run dev` |
| `simple-html/` | Plain HTML (no build) | open the `.html` file |
| `vue-widget/` | Embeddable widget in Vue | open `index.html` |

The examples default to the public demo backend (`https://ago.api.useago.com`,
agent `generic-guide`), so they answer out of the box. Point `baseUrl` at your
own domain (e.g. `https://YOUR-DOMAIN.api.useago.com`) to chat with your agents.

## How they depend on the SDK

The bundled `package.json` files use the **published package**, so each example
runs the same way an external user would:

```json
"@useago/sdk": "^1.0.5"
```

```bash
npm install
npm run dev
```

### Plain HTML / CDN

The `simple-html/` files import the published package from a CDN
(`https://esm.sh/@useago/sdk@1/...`), so opening any of them directly in a
browser works with no build step and no server.

## Working on the SDK source

To run an example against your local source instead of the published package,
swap that line in the example's `package.json` for a local monorepo link, then
build the SDK and reinstall:

```jsonc
// in the example's package.json
"@useago/sdk": "file:../.."
```

```bash
npm install && npm run build   # from the repo root, produces dist/
```

The `simple-html/` files each have a commented swap to the local build
(`../../dist/*.js`). Serve the repo (`python3 -m http.server`) and open
`http://localhost:8000/examples/simple-html/chat-widget.html` — `file://` pages
cannot import local modules.

See the [main README](../README.md) and the [docs](https://ago.mintlify.app) for the
full API.
