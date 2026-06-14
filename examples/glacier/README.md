# Glacier (React)

An ice-cream shop where the AGO agent does the work: it composes ice creams scoop
by scoop, picks the container and toppings, manages a cart, navigates between the
ingredients/allergens and origins pages, and places the order. It is a fuller
showcase of client-side functions and `useAgoNavigation` than `simple-react`.

The chat is in French (the agent is a French glacier), but the SDK usage is the
same in any language.

## Run it

```bash
cd examples/glacier
npm install
npm run dev
```

It defaults to the public demo backend (`https://playground.api.useago.com`, agent
`glacier`), so it answers out of the box. Point `VITE_AGO_BASE_URL` at your own
domain (e.g. `https://YOUR-DOMAIN.api.useago.com`) to use your own agents.

Open the app with `?dev` (e.g. `http://localhost:5173/?dev`) to mount the dev
panel: it lists the registered functions, shows the live context snapshot, and
logs every function the agent calls. See [`initDevPanel`](../../docs/general/devtools.md).

## What to try

- "Deux boules pistache et chocolat avec de la chantilly"
- "Ajoute-la au panier et compose-en une autre, vanille de Tahiti en cornet"
- "Je suis allergique aux fruits à coque" (the agent opens the allergens page)
- "D'où vient votre pistache ?" (the agent navigates to the origins page)
- "C'est bon, je passe commande au nom de Marie"

## How it works

- `src/functions.ts` defines the client-side functions the agent calls
  (`setCone`, `updateScoops`, `updateToppings`, `addToCart`, `updateCart`,
  `getState`, `placeOrder`). They mutate React state through a small store passed
  in from `App.tsx`.
- `src/App.tsx` registers them with `useAgoFunction`, lists the app's routes with
  `useAgoNavigation`, and renders the `<ChatWidget>` next to the live ice-cream
  preview and order recap.
- `src/main.tsx` wraps the app in `<AgoProvider>`, which builds and shares the
  `AgoClient` (base URL + `glacier` agent).
