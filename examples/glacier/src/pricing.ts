import { CONES, type ConeType, FLAVORS, TOPPINGS } from './flavors';

export interface IceCreamState {
  cone: ConeType;
  scoops: string[];
  toppings: string[];
}

export function computePrice(state: IceCreamState): number {
  if (state.scoops.length === 0) return 0;
  const scoopPrice = state.scoops.reduce(
    (sum, id) => sum + (FLAVORS[id]?.pricePerScoop ?? 2.5),
    0,
  );
  const toppingPrice = state.toppings.reduce(
    (sum, id) => sum + (TOPPINGS[id]?.price ?? 0),
    0,
  );
  const conePrice = CONES[state.cone].price;
  return Math.round((scoopPrice + toppingPrice + conePrice) * 100) / 100;
}

export function computeCartTotal(items: IceCreamState[]): number {
  const total = items.reduce((sum, item) => sum + computePrice(item), 0);
  return Math.round(total * 100) / 100;
}
