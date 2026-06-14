import { defineFunction } from '@useago/sdk';
import { CONES, ConeType, FLAVORS, FLAVOR_IDS, TOPPINGS, TOPPING_IDS } from './flavors';
import type { IceCreamState } from './IceCream';

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

export function buildIceCreamFunctions(store: OrderStore) {
  const setCone = defineFunction({
    name: 'setCone',
    description: 'Choose the container for the ice cream currently being composed: a waffle cone, a waffle cup, or a plain cup.',
    parameters: {
      type: 'object',
      properties: {
        cone: { type: 'string', enum: Object.keys(CONES), description: 'Container type' },
      },
      required: ['cone'],
    },
    handler: async (args: Record<string, unknown>) => {
      const cone = String(args.cone) as ConeType;
      if (!CONES[cone]) {
        return { ok: false, error: `Unknown container: ${cone}` };
      }
      const current = store.get().current;
      store.setCurrent({ ...current, cone });
      return { ok: true, cone };
    },
  });

  const updateScoops = defineFunction({
    name: 'updateScoops',
    description: `Add, remove, or replace scoops on the ice cream currently being composed. Available flavors: ${FLAVOR_IDS.join(', ')}. Max ${MAX_SCOOPS} scoops.`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'remove', 'replace'],
          description: '"add" appends one scoop (needs flavor). "remove" removes one (default = topmost; optional index, 0=bottom). "replace" sets the full list (needs flavors, comma-separated, bottom-to-top).',
        },
        flavor: { type: 'string', enum: FLAVOR_IDS, description: 'Flavor id — required for action=add' },
        index: { type: 'number', description: '0-based index of the scoop to remove (0 = bottom). Optional for action=remove; defaults to topmost.' },
        flavors: { type: 'string', description: 'Comma-separated flavor ids, bottom-to-top — required for action=replace (e.g. "vanilla,chocolate,pistachio")' },
      },
      required: ['action'],
    },
    handler: async (args: Record<string, unknown>) => {
      const action = String(args.action);
      const current = store.get().current;

      if (action === 'add') {
        const flavor = String(args.flavor ?? '');
        if (!FLAVORS[flavor]) {
          return { ok: false, error: `Unknown flavor: ${flavor}` };
        }
        if (current.scoops.length >= MAX_SCOOPS) {
          return { ok: false, error: `Maximum ${MAX_SCOOPS} scoops reached.` };
        }
        const next = { ...current, scoops: [...current.scoops, flavor] };
        store.setCurrent(next);
        return { ok: true, scoops: next.scoops };
      }

      if (action === 'remove') {
        if (current.scoops.length === 0) {
          return { ok: false, error: 'No scoops to remove.' };
        }
        const idx = typeof args.index === 'number' ? Number(args.index) : current.scoops.length - 1;
        if (idx < 0 || idx >= current.scoops.length) {
          return { ok: false, error: `Index ${idx} out of range.` };
        }
        const scoops = current.scoops.filter((_, i) => i !== idx);
        store.setCurrent({ ...current, scoops });
        return { ok: true, scoops };
      }

      if (action === 'replace') {
        const raw = String(args.flavors ?? '');
        const flavors = raw.split(',').map((s) => s.trim()).filter(Boolean);
        const cleaned = flavors.filter((f) => FLAVORS[f]).slice(0, MAX_SCOOPS);
        store.setCurrent({ ...current, scoops: cleaned });
        return { ok: true, scoops: cleaned };
      }

      return { ok: false, error: `Unknown action: ${action}` };
    },
  });

  const updateToppings = defineFunction({
    name: 'updateToppings',
    description: `Add or remove a topping on the ice cream currently being composed. Available: ${TOPPING_IDS.join(', ')}.`,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'remove'], description: '"add" or "remove"' },
        topping: { type: 'string', enum: TOPPING_IDS, description: 'Topping id' },
      },
      required: ['action', 'topping'],
    },
    handler: async (args: Record<string, unknown>) => {
      const action = String(args.action);
      const topping = String(args.topping);
      if (!TOPPINGS[topping]) {
        return { ok: false, error: `Unknown topping: ${topping}` };
      }
      const current = store.get().current;

      if (action === 'add') {
        if (current.toppings.includes(topping)) {
          return { ok: true, toppings: current.toppings, note: 'already added' };
        }
        const toppings = [...current.toppings, topping];
        store.setCurrent({ ...current, toppings });
        return { ok: true, toppings };
      }

      if (action === 'remove') {
        const toppings = current.toppings.filter((t) => t !== topping);
        store.setCurrent({ ...current, toppings });
        return { ok: true, toppings };
      }

      return { ok: false, error: `Unknown action: ${action}` };
    },
  });

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
    setCone,
    updateScoops,
    updateToppings,
    resetCurrent,
    addToCart,
    updateCart,
    getState,
    placeOrder,
  };
}

export function computePrice(state: IceCreamState): number {
  if (state.scoops.length === 0 && state.toppings.length === 0) return 0;
  const scoopPrice = state.scoops.reduce((sum, id) => sum + (FLAVORS[id]?.pricePerScoop ?? 2.5), 0);
  const toppingPrice = state.toppings.reduce((sum, id) => sum + (TOPPINGS[id]?.price ?? 0), 0);
  const conePrice = CONES[state.cone].price;
  return Math.round((scoopPrice + toppingPrice + conePrice) * 100) / 100;
}

export function computeCartTotal(items: IceCreamState[]): number {
  const total = items.reduce((sum, item) => sum + computePrice(item), 0);
  return Math.round(total * 100) / 100;
}
