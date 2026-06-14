export type Allergen =
  | 'lait'
  | 'œufs'
  | 'fruits à coque'
  | 'arachides'
  | 'gluten'
  | 'soja'
  | 'sulfites';

export interface Flavor {
  id: string;
  name: string;
  color: string;
  speckle?: string;
  pricePerScoop: number;
  description: string;
  allergens: Allergen[];
}

export const FLAVORS: Record<string, Flavor> = {
  vanilla: {
    id: 'vanilla',
    name: 'Vanille',
    color: '#f9e8c4',
    pricePerScoop: 2.5,
    description: 'Crème glacée onctueuse à la vanille de Tahiti, base lait entier et jaunes d\'œufs.',
    allergens: ['lait', 'œufs'],
  },
  chocolate: {
    id: 'chocolate',
    name: 'Chocolat',
    color: '#5b3a29',
    pricePerScoop: 2.5,
    description: 'Chocolat noir 70% fondu dans une base lactée. Trace possible de soja (lécithine).',
    allergens: ['lait', 'soja'],
  },
  strawberry: {
    id: 'strawberry',
    name: 'Fraise',
    color: '#f4a8b6',
    speckle: '#c64a6b',
    pricePerScoop: 2.5,
    description: 'Fraises fraîches mixées avec une base crémeuse au lait entier.',
    allergens: ['lait'],
  },
  pistachio: {
    id: 'pistachio',
    name: 'Pistache',
    color: '#bdd49a',
    speckle: '#5a7a3a',
    pricePerScoop: 3.0,
    description: 'Pâte de pistaches de Sicile dans une base crème-lait. Contient des fruits à coque.',
    allergens: ['lait', 'fruits à coque'],
  },
  mint: {
    id: 'mint',
    name: 'Menthe',
    color: '#b8e8d4',
    speckle: '#3a3a3a',
    pricePerScoop: 2.5,
    description: 'Infusion de menthe fraîche avec éclats de chocolat noir. Peut contenir du soja.',
    allergens: ['lait', 'soja'],
  },
  lemon: {
    id: 'lemon',
    name: 'Citron',
    color: '#fff2a8',
    pricePerScoop: 2.5,
    description: 'Sorbet plein fruit au citron de Menton. Sans produits laitiers.',
    allergens: [],
  },
  caramel: {
    id: 'caramel',
    name: 'Caramel',
    color: '#d49a5e',
    pricePerScoop: 2.8,
    description: 'Caramel au beurre salé maison sur base crème-lait.',
    allergens: ['lait'],
  },
  mango: {
    id: 'mango',
    name: 'Mangue',
    color: '#ffc070',
    pricePerScoop: 2.8,
    description: 'Sorbet à la mangue Alphonso. Sans produits laitiers.',
    allergens: [],
  },
  raspberry: {
    id: 'raspberry',
    name: 'Framboise',
    color: '#e85a7a',
    speckle: '#7a1f3a',
    pricePerScoop: 2.8,
    description: 'Sorbet plein fruit à la framboise. Sans produits laitiers.',
    allergens: [],
  },
  coffee: {
    id: 'coffee',
    name: 'Café',
    color: '#7a4a2a',
    pricePerScoop: 2.8,
    description: 'Espresso italien infusé dans une base crémeuse au lait entier.',
    allergens: ['lait'],
  },
};

export const FLAVOR_IDS = Object.keys(FLAVORS);

export interface Topping {
  id: string;
  name: string;
  price: number;
  description: string;
  allergens: Allergen[];
}

export const TOPPINGS: Record<string, Topping> = {
  'chocolate-sauce': {
    id: 'chocolate-sauce',
    name: 'Sauce chocolat',
    price: 0.8,
    description: 'Sauce au chocolat noir tiède. Contient du lait et de la lécithine de soja.',
    allergens: ['lait', 'soja'],
  },
  'caramel-sauce': {
    id: 'caramel-sauce',
    name: 'Sauce caramel',
    price: 0.8,
    description: 'Sauce caramel au beurre salé maison.',
    allergens: ['lait'],
  },
  sprinkles: {
    id: 'sprinkles',
    name: 'Vermicelles',
    price: 0.5,
    description: 'Vermicelles colorés en sucre et farine de blé.',
    allergens: ['gluten', 'soja'],
  },
  'whipped-cream': {
    id: 'whipped-cream',
    name: 'Chantilly',
    price: 1.0,
    description: 'Crème fouettée maison, légèrement sucrée.',
    allergens: ['lait'],
  },
  nuts: {
    id: 'nuts',
    name: 'Noisettes',
    price: 0.8,
    description: 'Noisettes du Piémont concassées et torréfiées. Trace possible d\'autres fruits à coque.',
    allergens: ['fruits à coque'],
  },
  cherry: {
    id: 'cherry',
    name: 'Cerise',
    price: 0.5,
    description: 'Cerise confite au sirop. Contient des sulfites (conservateur).',
    allergens: ['sulfites'],
  },
};

export const TOPPING_IDS = Object.keys(TOPPINGS);

export type ConeType = 'cone' | 'cup' | 'waffle-cup';

export interface Cone {
  name: string;
  price: number;
  description: string;
  allergens: Allergen[];
}

export const CONES: Record<ConeType, Cone> = {
  cone: {
    name: 'Cornet gaufré',
    price: 0.5,
    description: 'Cornet gaufré croquant à base de farine de blé, œufs et lait.',
    allergens: ['gluten', 'œufs', 'lait'],
  },
  cup: {
    name: 'Pot',
    price: 0,
    description: 'Pot en carton. Aucun allergène.',
    allergens: [],
  },
  'waffle-cup': {
    name: 'Coupe gaufrée',
    price: 0.8,
    description: 'Coupe gaufrée artisanale à base de farine de blé, œufs et lait.',
    allergens: ['gluten', 'œufs', 'lait'],
  },
};
