import { defineFunction } from '@useago/sdk';
import type { AgoStateControl, AgoStateSetResult } from '@useago/sdk';
import { CONES, type ConeType, FLAVORS, FLAVOR_IDS, TOPPINGS, TOPPING_IDS } from './flavors';
import {
  fetchMarketPrices,
  MARKET_PRICES_URL,
  marketPriceOf,
  type MarketPrices,
} from './marketPrices';
import { computeCartTotal, computePrice, type IceCreamState } from './pricing';

export { computeCartTotal, computePrice, type IceCreamState } from './pricing';

const MAX_SCOOPS = 5;

export interface CartItem extends IceCreamState {
  id: string;
}

export interface CartState {
  current: IceCreamState;
  cart: CartItem[];
}

export interface OrderStore {
  get: () => CartState;
  setCurrent: (next: IceCreamState) => void;
  setCart: (next: CartItem[]) => void;
}

function newCartItemId() {
  return `ic-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeItem(item: IceCreamState) {
  return {
    cone: CONES[item.cone].name,
    scoops: item.scoops.map((id) => FLAVORS[id]?.name ?? id),
    toppings: item.toppings.map((id) => TOPPINGS[id]?.name ?? id),
    priceEuros: computePrice(item),
  };
}

// The ice cream currently being composed is now editable page state, not a set
// of bespoke mutation functions. cone/scoops/toppings each map to one control
// of the synthesized `setPageState` function, and their `get()` feeds the agent
// the live composition as dynamic context. The agent sets the whole array for
// scoops/toppings (bottom-to-top) rather than issuing add/remove actions.
export function buildIceCreamControls(store: OrderStore): AgoStateControl[] {
  return [
    {
      name: 'cone',
      description: 'The container for the ice cream currently being composed: a waffle cone, a waffle cup, or a plain cup.',
      schema: { type: 'string', enum: Object.keys(CONES) },
      get: () => store.get().current.cone,
      set: (value) => {
        const cone = String(value) as ConeType;
        if (!CONES[cone]) return;
        store.setCurrent({ ...store.get().current, cone });
      },
    },
    {
      name: 'scoops',
      description: `The scoops on the ice cream currently being composed, listed bottom-to-top. Set the full list. Available flavors: ${FLAVOR_IDS.join(', ')}. Max ${MAX_SCOOPS} scoops.`,
      schema: { type: 'array', items: { type: 'string', enum: FLAVOR_IDS } },
      get: () => store.get().current.scoops,
      set: (value): AgoStateSetResult | void => {
        const ids = Array.isArray(value) ? value.map(String) : [];
        if (ids.length > MAX_SCOOPS) {
          return {
            result: 'rejected',
            reason: `Une glace peut contenir au maximum ${MAX_SCOOPS} boules. Choisissez au plus ${MAX_SCOOPS} parfums.`,
          };
        }
        store.setCurrent({ ...store.get().current, scoops: [...ids] });
      },
    },
    {
      name: 'toppings',
      description: `The toppings on the ice cream currently being composed. Set the full list. Available: ${TOPPING_IDS.join(', ')}.`,
      schema: { type: 'array', items: { type: 'string', enum: TOPPING_IDS } },
      get: () => store.get().current.toppings,
      set: (value): AgoStateSetResult | void => {
        const ids = Array.isArray(value) ? value.map(String) : [];
        const normalized = Array.from(new Set(ids.filter((t) => TOPPINGS[t])));
        const current = store.get().current.toppings;
        if (
          normalized.length === current.length &&
          normalized.every((v, i) => v === current[i])
        ) {
          return { result: 'unchanged' };
        }
        store.setCurrent({ ...store.get().current, toppings: normalized });
      },
    },
  ];
}

export function buildIceCreamFunctions(store: OrderStore) {
  const resetCurrent = defineFunction({
    name: 'resetCurrent',
    description: 'Empty the ice cream currently being composed — no scoops, no toppings. Keeps the chosen container. Does not touch the cart.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      const current = store.get().current;
      store.setCurrent({ ...current, scoops: [], toppings: [] });
      return { ok: true };
    },
  });

  const addToCart = defineFunction({
    name: 'addToCart',
    description: 'Add the ice cream currently being composed to the cart, then start a fresh ice cream so the customer can compose another. Use this once a customer is happy with one ice cream and wants to add another to the same order.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      const { current, cart } = store.get();
      if (current.scoops.length === 0) {
        return { ok: false, error: 'Cannot add an empty ice cream to the cart — add at least one scoop first.' };
      }
      const item: CartItem = { id: newCartItemId(), ...current };
      const nextCart = [...cart, item];
      store.setCart(nextCart);
      store.setCurrent({ cone: current.cone, scoops: [], toppings: [] });
      return {
        ok: true,
        cartItemId: item.id,
        cartCount: nextCart.length,
        cartTotalEuros: computeCartTotal(nextCart),
      };
    },
  });

  const updateCart = defineFunction({
    name: 'updateCart',
    description: 'Manage the cart: remove one ice cream, or clear it entirely. Does not affect the ice cream currently being composed.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['remove', 'clear'], description: '"remove" one item, or "clear" all items' },
        cartItemId: { type: 'string', description: 'For action=remove: the cart item id to remove' },
        position: { type: 'number', description: 'For action=remove: 1-based position in the cart (alternative to cartItemId)' },
      },
      required: ['action'],
    },
    handler: async (args: Record<string, unknown>) => {
      const action = String(args.action);
      const { cart } = store.get();

      if (action === 'clear') {
        store.setCart([]);
        return { ok: true, cartCount: 0 };
      }

      if (action === 'remove') {
        if (cart.length === 0) {
          return { ok: false, error: 'Cart is empty.' };
        }
        let idx = -1;
        if (typeof args.cartItemId === 'string') {
          idx = cart.findIndex((c) => c.id === args.cartItemId);
        } else if (typeof args.position === 'number') {
          idx = Number(args.position) - 1;
        } else {
          idx = cart.length - 1;
        }
        if (idx < 0 || idx >= cart.length) {
          return { ok: false, error: 'Cart item not found.' };
        }
        const next = cart.filter((_, i) => i !== idx);
        store.setCart(next);
        return { ok: true, cartCount: next.length, cartTotalEuros: computeCartTotal(next) };
      }

      return { ok: false, error: `Unknown action: ${action}` };
    },
  });

  const getState = defineFunction({
    name: 'getState',
    description: 'Read the full order state: the ice cream currently being composed, every ice cream in the cart, and the running totals in euros.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      const { current, cart } = store.get();
      const cartTotal = computeCartTotal(cart);
      const currentSummary = summarizeItem(current);
      return {
        current: { ...currentSummary, scoopCount: current.scoops.length },
        cart: {
          count: cart.length,
          totalEuros: cartTotal,
          items: cart.map((item, i) => ({ position: i + 1, id: item.id, ...summarizeItem(item) })),
        },
        grandTotalEuros: Math.round((cartTotal + currentSummary.priceEuros) * 100) / 100,
      };
    },
  });

  const placeOrder = defineFunction({
    name: 'placeOrder',
    description: "Confirm and place the customer's full order. Checks out every ice cream in the cart, plus the one being composed if it has any scoops. Call this once the customer is happy and ready to pay.",
    parameters: {
      type: 'object',
      properties: {
        customerName: { type: 'string', description: 'Customer name on the order ticket' },
      },
    },
    handler: async (args: Record<string, unknown>) => {
      const { current, cart } = store.get();
      const items: IceCreamState[] = [...cart];
      if (current.scoops.length > 0) {
        items.push(current);
      }
      if (items.length === 0) {
        return { ok: false, error: 'Cannot place an empty order — add at least one ice cream first.' };
      }
      const ticket = {
        ticketId: `GLA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        customerName: typeof args.customerName === 'string' ? args.customerName : 'Client',
        items: items.map((item, i) => ({ position: i + 1, ...summarizeItem(item) })),
        itemCount: items.length,
        priceEuros: computeCartTotal(items),
        readyInMinutes: 3 + items.length,
      };
      store.setCart([]);
      store.setCurrent({ cone: current.cone, scoops: [], toppings: [] });
      return { ok: true, ...ticket };
    },
  });

  return {
    resetCurrent,
    addToCart,
    updateCart,
    getState,
    placeOrder,
  };
}

// Tous les prix, d'un coup. Aucun argument : c'est à l'agent de lire la grille
// et d'en tirer ce qu'on lui demande (le moins cher, deux parfums sous 3 €,
// l'écart maison/marché). On ne pré-mâche pas la réponse côté front, sinon on
// ne teste plus son raisonnement, juste notre tri.
export const lookupFlavorPrices = defineFunction({
  name: 'lookupFlavorPrices',
  description:
    "Prix de TOUS les parfums de la carte, en euros : le tarif maison à la boule et le cours du jour du service de prix externe. Aucun argument. À appeler pour toute question de prix, de comparaison ou de total.",
  parameters: { type: 'object', properties: {} },
  handler: async () => {
    let prices: MarketPrices;
    try {
      prices = await fetchMarketPrices();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    return {
      ok: true,
      source: MARKET_PRICES_URL,
      devise: 'EUR',
      parfums: FLAVOR_IDS.map((id) => ({
        id,
        nom: FLAVORS[id].name,
        prixMaisonEuros: FLAVORS[id].pricePerScoop,
        // null = ce parfum n'est pas coté par le service de prix.
        coursDuJourEuros: marketPriceOf(id, prices),
      })),
    };
  },
});

// Calls a public API (Wikipedia) and deliberately returns the RAW response,
// 100 KB to several hundred KB of article HTML, to exercise the SDK's
// result-size guard (`maxFunctionResultBytes`). The agent receives a truncated
// preview plus a hint instead of the full payload; the console (with
// `debug: true`) and the dev panel show the warning. A real integration would
// fetch the summary endpoint or extract the relevant sections in the handler.
export const lookupWikipediaArticle = defineFunction({
  name: 'lookupWikipediaArticle',
  description:
    "Fetch the full French Wikipedia article on a topic, for encyclopedic background on our ingredients and their origins (e.g. 'Crème glacée', 'Vanille', 'Pistache', 'Sorbet'). Returns the complete article.",
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: "Exact article title on fr.wikipedia.org, e.g. 'Crème glacée' or 'Vanille'",
      },
    },
    required: ['title'],
  },
  handler: async (args: Record<string, unknown>) => {
    const title = String(args.title);
    const res = await fetch(
      `https://fr.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`,
    );
    if (!res.ok) {
      return { ok: false, error: `Wikipedia returned HTTP ${res.status} for "${title}"` };
    }
    return { title, html: await res.text() };
  },
});
