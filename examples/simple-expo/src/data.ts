// Demo data: an Avignon-based customer, Tut Tut's S/M/L/XL sizes, and a
// made-up price grid. Nothing here comes from Tut Tut's real pricing.

export type Size = "S" | "M" | "L" | "XL";
export type Slot = "asap" | "this_afternoon" | "this_evening" | "tomorrow_morning";
export type Status = "searching" | "assigned" | "picked_up" | "delivered";

export const SIZES: Record<Size, { label: string; examples: string; base: number }> = {
  S: { label: "Small", examples: "keys, documents, a bottle, a phone", base: 9.9 },
  M: { label: "Medium", examples: "a box, flowers, a microwave, a suitcase", base: 14.9 },
  L: { label: "Large", examples: "a small table, a chair, a TV, a bike", base: 24.9 },
  XL: { label: "Extra large", examples: "a fridge, a sofa, a washing machine", base: 44.9 },
};

export const SLOTS: Record<Slot, string> = {
  asap: "As soon as possible (within 2 hours)",
  this_afternoon: "This afternoon",
  this_evening: "This evening",
  tomorrow_morning: "Tomorrow morning",
};

export const STATUS_LABELS: Record<Status, string> = {
  searching: "Looking for a co-transporter",
  assigned: "Co-transporter on the way to pickup",
  picked_up: "Parcel picked up, on its way",
  delivered: "Delivered",
};

// Road distance from Avignon centre. Tut Tut delivers within 30 km.
export const TOWNS: Record<string, number> = {
  Avignon: 3,
  "Villeneuve-lès-Avignon": 4,
  "Le Pontet": 6,
  "Morières-lès-Avignon": 9,
  Sorgues: 10,
  Châteaurenard: 11,
  "L'Isle-sur-la-Sorgue": 23,
  Carpentras: 25,
  Cavaillon: 26,
  Orange: 30,
  Nîmes: 45,
};
export const MAX_KM = 30;

export const USER = {
  firstName: "Camille",
  savedAddresses: {
    home: "12 rue Carnot, Avignon",
    shop: "Les Fleurs du Palais (Camille's flower shop), 5 place de l'Horloge, Avignon",
    mum: "8 chemin des Vignes, Le Pontet",
  },
};

/** "shop", "my mum", "home" → the saved address; anything else unchanged. */
export function resolveAddress(value: string): string {
  const key = value.trim().toLowerCase().replace(/^(my|the)\s+/, "").replace(/'s$/, "");
  const saved = USER.savedAddresses as Record<string, string>;
  return saved[key] ?? value;
}

/** The town an address is in, matched against {@link TOWNS}. */
export function townOf(address: string): string | undefined {
  const lower = address.toLowerCase();
  return Object.keys(TOWNS)
    .sort((a, b) => b.length - a.length)
    .find((town) => lower.includes(town.toLowerCase()));
}

export interface Quote {
  price: number;
  km: number;
  inZone: boolean;
}

export function quote(size: Size, town: string | undefined): Quote {
  const km = town ? TOWNS[town] : 8;
  const price = SIZES[size].base + Math.max(0, km - 5) * 0.5;
  return { price: Math.round(price * 10) / 10, km, inZone: km <= MAX_KM };
}

export interface CoTransporter {
  name: string;
  vehicle: string;
  rating: number;
}

export interface Delivery {
  id: string;
  from: string;
  to: string;
  size: Size;
  description: string;
  slot: Slot;
  price: number;
  status: Status;
  etaMinutes: number;
  coTransporter?: CoTransporter;
}

export const SEED_DELIVERIES: Delivery[] = [
  {
    id: "TT-4821",
    from: USER.savedAddresses.shop,
    to: "3 rue de la République, Villeneuve-lès-Avignon",
    size: "M",
    description: "Bouquet of roses",
    slot: "asap",
    price: 14.9,
    status: "picked_up",
    etaMinutes: 18,
    coTransporter: { name: "Karim", vehicle: "Renault Kangoo", rating: 4.9 },
  },
  {
    id: "TT-4790",
    from: USER.savedAddresses.home,
    to: "Mairie, place Charles de Gaulle, Sorgues",
    size: "S",
    description: "Signed documents",
    slot: "asap",
    price: 12.4,
    status: "delivered",
    etaMinutes: 0,
    coTransporter: { name: "Julie", vehicle: "Peugeot 208", rating: 5 },
  },
];

// Deliveries a co-transporter can book near their commute (Cagnotte screen).
export const AVAILABLE_JOBS = [
  { id: "J-1", from: "Avignon centre", to: "Carpentras", size: "M" as Size, earnings: 13.5, pickupIn: "15 min" },
  { id: "J-2", from: "Le Pontet", to: "Sorgues", size: "S" as Size, earnings: 6.2, pickupIn: "30 min" },
  { id: "J-3", from: "Avignon Nord", to: "Orange", size: "L" as Size, earnings: 21, pickupIn: "1 h" },
];
