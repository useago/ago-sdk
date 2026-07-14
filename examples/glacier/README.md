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
logs every function the agent calls. See [`initDevPanel`](../../docs/general/devtools.md).

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

## Try the proactive mode

The example configures three proactive triggers (`proactive` in `src/main.tsx`)
with demo-short thresholds, rendered by the `<AgoNudge>` toast in `App.tsx`:

- **Rage clicks** — click 4+ times in under a second on something inert (a
  heading, the ice-cream drawing). A nudge appears instantly; accepting it
  opens a conversation ("Quelque chose ne marche pas, aidez-moi.").
- **Hesitation on the flavors page** — open `/parfums` and don't touch anything
  for ~10 s. The nudge's action button applies the lactose-free filter through
  `setPageState`, no chat involved.
- **Stuck on the shop** — stay idle on `/` for ~20 s. This one is
  `intervene: 'agent'`: the SDK calls `POST /proactive/evaluate` and the
  backend's fast LLM decides whether to intervene and drafts the message. It
  needs a backend with the proactive endpoints — against an older backend the
  call fails and the SDK silently stays quiet (by design).

Dismissing a nudge suppresses its trigger for 24 h and the demo caps nudges at
5 per session; to reset between experiments, clear the `ago_proactive` key from
localStorage (or use a private window).

Note `enabledOverride: true` in the config: it bypasses the remote kill-switch
(`GET /config` → `proactive.enabled`) so the demo works against backends that
don't expose the flag yet. Never set it in a real app — the tenant admin
controls the feature, and the evaluate endpoint stays gated server-side
regardless.

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
