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

It defaults to the AGO playground backend (`https://playground.api.useago.com`, agent `glacier`).
Point `VITE_AGO_BASE_URL` at another domain (e.g. `https://YOUR-DOMAIN.api.useago.com`)
to use your own agents.

The example runs with the default `clientFunctionsMode` (`"pause"`): the agent
pauses on client function calls (navigation, cart actions) and resumes the same
turn once their results are submitted, instead of continuing on a placeholder. Cross-page
requests ("va sur la page parfums et montre les parfums sans lactose") need the
backend's pause/resume support and an agent with `reasoning_iterations >= 2`.

Open the app with `?dev` (e.g. `http://localhost:5173/?dev`) to mount the dev
panel: it lists the registered functions, shows the live context snapshot, and
logs every function the agent calls. With `?dev` the panel also includes a
**local function runner** that executes registered functions directly via
`client.executeClientFunction`, without contacting the agent backend. See
[`initDevPanel`](../../docs/general/devtools.md).

## What to try

- "Deux boules pistache et chocolat avec de la chantilly"
- "Ajoute-la au panier et compose-en une autre, vanille de Tahiti en cornet"
- "Je suis allergique aux fruits à coque" (the agent opens the allergens page)
- "D'où vient votre pistache ?" (the agent navigates to the origins page)
- "C'est bon, je passe commande au nom de Marie"
- "Raconte-moi l'histoire de la crème glacée" (fetches the full Wikipedia
  article, 100+ KB of raw HTML, so the SDK's
  [result size guard](../../docs/general/functions-and-context.md#result-size-limit)
  truncates it before it reaches the LLM. Watch the console warning and the
  dev panel.)
- "Va sur la page parfums, passe au cours du jour et dis-moi le moins cher"
  (the payoff of the page-state `data` option, see below)
- "Fais-moi un pot avec les deux parfums les moins chers" (the agent calls
  `lookupFlavorPrices`, which returns the whole grid with no ranking done for
  it, and has to work out the answer itself)

### The page returns what it displays

`/parfums` can price its flavors two ways: the house tariff (`maison`) or the
live rate (`marche`), fetched from
[a public price service](https://useago.github.io/static-json-response/flavours-price.json).
`priceSource` is a page-state control, so the agent can flip it. The catch: the
switch fires an HTTP request, so for a moment the rows on screen are still the
old ones.

`src/FlavorsPage.tsx` therefore passes a `data` source to `useAgoPageState`:

```ts
data: {
  description: 'Les parfums actuellement affichés…',
  // A promise: the SDK awaits it, so it knows exactly when the work the
  // change triggered has finished. ensure() shares the request already in
  // flight for the UI, so the prices are fetched once.
  get: async () => {
    const live = priceSource === 'marche' ? await ensure() : null;
    return { priceSource, parfums: [...] };
  },
}
```

The SDK awaits that promise, then returns the rows as the result of the agent's
own `setPageState` call. So "passe au cours du jour et dis-moi le moins cher" is
answered in one turn, with the prices that are actually on screen.

The alternative is `isLoading: () => isFetching`, which the SDK polls. It works
here, but it is a heuristic: the flag has to go up within ~100 ms of the change.
Put a debounce in front of the fetch and the poll misses it, and the agent
answers with the previous source's prices, confidently and wrongly. The promise
cannot miss it.

Declaring `data` also registers `readPageData`: no arguments, changes nothing,
returns the same snapshot. That is what answers "qu'est-ce qui est affiché ?".

Note `mint` (our Menthe glaciale) is not quoted by the service, which only
lists `mint_chocolate_chip`. It comes back as `coursDuJourEuros: null` and shows
"non coté" in the list view, rather than being silently priced wrong.

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

## The look

The boutique styling is a small design system, not page-by-page CSS:

- `src/App.css` declares every token (`--ink-900`, `--framboise`, `--font-display`,
  `--r-lg`, …) plus the shell layout and the `.ago-*` ChatWidget overrides.
- `src/ui.tsx` holds the pieces built from those tokens: `ButtonLink`, `Badge`, `Pill`,
  `PriceTag`, `FlavorCard`, `OriginCard`, `SectionHeading`, `GoldFrame`.
- `src/Chrome.tsx` is the furniture every route shares: announce bar, sticky
  header, footer.

Components style themselves inline and only ever reference `var(--…)`, so
re-skinning the whole shop means editing the `:root` block in `App.css`.

## Local contract exercises

Open `/?dev` and use the local function runner to exercise `setPageState` with
raw JSON arguments. These calls run in the browser and do not contact the agent
backend. Each row below shows the arguments, the expected SDK verdict, and the
visible page effect.

### `/parfums`

| Arguments | Expected |
| --- | --- |
| `{ "search": "chocolat" }` | APPLY: search applied, visible list filtered. Page data includes `search: "chocolat"`. |
| `{ "search": "chocolat" }` again | generic SKIP: value matches `get()`. |
| `{ "search": "" }` | APPLY (clearable): search cleared, full list restored. |
| `{ "search": "" }` again from empty | generic SKIP: already empty. |
| `{ "dietaryFilter": "keto" }` | SDK enum REJECT: `keto` is not in the allowed values. Visible filter unchanged. |
| `{ "sortBy": "" }` | DROP: empty string on a non-clearable control. No bucket, no state change. |
| `{ "sortBy": "nom" }` (from initial state) | generic SKIP: value matches `get()`. |
| `{ "view": "liste", "sortBy": "nom", "dietaryFilter": "keto", "mystery": null }` | APPLY `view` + SKIP `sortBy` + REJECT `dietaryFilter` (enum) + REJECT `mystery` (unknown control). No rollback of applied fields. |
| `{ "priceSource": "marche" }` | APPLY plus settled market-price page data in the result. |

### `/` (shop)

| Arguments | Expected |
| --- | --- |
| `{ "scoops": ["pistachio", "banana"] }` | SDK item-enum REJECT: `banana` is not in the allowed values. Composition unchanged. |
| `{ "scoops": ["pistachio", "chocolate"] }` twice | APPLY, then generic SKIP on the second call. |
| `{ "scoops": ["chocolate", "pistachio"] }` after `["pistachio", "chocolate"]` | APPLY: array order is significant. |
| `{ "scoops": ["vanilla", "chocolate", "pistachio", "strawberry", "lemon", "mango"] }` | Page-owned tagged REJECT: max 5 scoops. Prior composition preserved. |
| `{ "toppings": [] }` twice after a non-empty selection | APPLY, then generic SKIP. |
| `{ "toppings": ["cherry", "cherry"] }` when `cherry` is already selected | Page-owned semantic UNCHANGED: duplicates are normalized, and the normalized set matches `get()`. No store write. |
| `{ "toppings": ["cherry", "cherry"] }` from empty | APPLY: normalized set `["cherry"]` differs from `[]`. |

The `search` control on `/parfums` is `clearable`: sending `""` clears the
search and restores the full list. Glacier's enum controls use explicit neutral
values (`"all"`, `"nom"`) and its collections clear with `[]`, so `search` is
the only field that needs the clearable flag.
