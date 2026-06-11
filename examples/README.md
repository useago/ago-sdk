# Examples

Runnable example apps for `@useago/sdk`, one per stack.

| Example | Stack | Entry |
| --- | --- | --- |
| `simple-react/` | React + Vite | `npm run dev` |
| `simple-vue/` | Vue 3 + Vite | `npm run dev` |
| `simple-angular/` | Angular | `npm run dev` |
| `simple-ts/` | Vanilla TypeScript | `npm run dev` |
| `simple-html/` | Plain HTML (no build) | open the `.html` file |
| `vue-widget/` | Embeddable widget in Vue | open `index.html` |

Each example points its chat at a running AGO instance. Set `baseUrl` to your
domain (e.g. `https://YOUR-DOMAIN.useago.com`) — the examples default to
`http://localhost:8000` for local development.

## Two ways to depend on the SDK

The bundled `package.json` files use a **local monorepo link** so the examples
track your local source:

```json
"@useago/sdk": "file:../.."
```

This requires building the SDK first (`npm install && npm run build` from `sdk/`).

To run an example **as an external user would** — against the published package —
swap that line for the released version and reinstall:

```jsonc
// in the example's package.json
"@useago/sdk": "^0.4.7"
```

```bash
npm install
npm run dev
```

### Plain HTML / CDN

The `simple-html/` examples import the local build (`../../dist/*.js`). To run one
without any build step, import from a CDN instead — see
`simple-html/credit-form-simple.html`, which uses an import map:

```html
<script type="importmap">
  {
    "imports": {
      "@useago/sdk/widget": "https://esm.sh/@useago/sdk/widget",
      "@useago/sdk/devtools": "https://esm.sh/@useago/sdk/devtools"
    }
  }
</script>
```

## Building the SDK locally

From the `sdk/` directory:

```bash
npm install
npm run build      # produces dist/ consumed by the file:../.. examples
```

See the [main README](../README.md) and the [docs](https://ago.mintlify.app) for the
full API.
