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
  imageSrc: string;
  imageAlt: string;
}

export const FLAVORS: Record<string, Flavor> = {
  vanilla: {
    id: 'vanilla',
    name: 'Vanille',
    color: '#f9e8c4',
    pricePerScoop: 2.5,
    description: 'Crème glacée onctueuse à la vanille de Tahiti, base lait entier et jaunes d\'œufs.',
    allergens: ['lait', 'œufs'],
    imageSrc: '/images/flavors/vanilla.webp',
    imageAlt: 'Quenelle de glace à la vanille de Tahiti dans une coupelle en céramique ivoire',
  },
  chocolate: {
    id: 'chocolate',
    name: 'Chocolat',
    color: '#5b3a29',
    pricePerScoop: 2.5,
    description: 'Chocolat noir 70% fondu dans une base lactée. Trace possible de soja (lécithine).',
    allergens: ['lait', 'soja'],
    imageSrc: '/images/flavors/chocolate.webp',
    imageAlt: 'Quenelle de glace au chocolat noir avec quelques copeaux de cacao',
  },
  strawberry: {
    id: 'strawberry',
    name: 'Fraise',
    color: '#f4a8b6',
    speckle: '#c64a6b',
    pricePerScoop: 2.5,
    description: 'Fraises fraîches mixées avec une base crémeuse au lait entier.',
    allergens: ['lait'],
    imageSrc: '/images/flavors/strawberry.webp',
    imageAlt: 'Quenelle de glace à la fraise Gariguette avec deux fraises fraîches',
  },
  pistachio: {
    id: 'pistachio',
    name: 'Pistache',
    color: '#bdd49a',
    speckle: '#5a7a3a',
    pricePerScoop: 3.0,
    description: 'Pâte de pistaches de Sicile dans une base crème-lait. Contient des fruits à coque.',
    allergens: ['lait', 'fruits à coque'],
    imageSrc: '/images/flavors/pistachio.webp',
    imageAlt: 'Quenelle de glace à la pistache de Bronte avec pistaches concassées',
  },
  mint: {
    id: 'mint',
    name: 'Menthe',
    color: '#b8e8d4',
    speckle: '#3a3a3a',
    pricePerScoop: 2.5,
    description: 'Infusion de menthe fraîche avec éclats de chocolat noir. Peut contenir du soja.',
    allergens: ['lait', 'soja'],
    imageSrc: '/images/flavors/mint.webp',
    imageAlt: 'Quenelle de glace à la menthe fraîche avec éclats de chocolat noir',
  },
  lemon: {
    id: 'lemon',
    name: 'Citron',
    color: '#fff2a8',
    pricePerScoop: 2.5,
    description: 'Sorbet plein fruit au citron de Menton. Sans produits laitiers.',
    allergens: [],
    imageSrc: '/images/flavors/lemon.webp',
    imageAlt: 'Quenelle de sorbet au citron de Menton avec zeste et quartier de citron',
  },
  caramel: {
    id: 'caramel',
    name: 'Caramel',
    color: '#d49a5e',
    pricePerScoop: 2.8,
    description: 'Caramel au beurre salé maison sur base crème-lait.',
    allergens: ['lait'],
    imageSrc: '/images/flavors/caramel.webp',
    imageAlt: 'Quenelle de glace au caramel au beurre salé avec un fin ruban de caramel',
  },
  mango: {
    id: 'mango',
    name: 'Mangue',
    color: '#ffc070',
    pricePerScoop: 2.8,
    description: 'Sorbet à la mangue Alphonso. Sans produits laitiers.',
    allergens: [],
    imageSrc: '/images/flavors/mango.webp',
    imageAlt: 'Quenelle de sorbet à la mangue Alphonso avec une tranche de mangue mûre',
  },
  raspberry: {
    id: 'raspberry',
    name: 'Framboise',
    color: '#e85a7a',
    speckle: '#7a1f3a',
    pricePerScoop: 2.8,
    description: 'Sorbet plein fruit à la framboise. Sans produits laitiers.',
    allergens: [],
    imageSrc: '/images/flavors/raspberry.webp',
    imageAlt: 'Quenelle de sorbet à la framboise avec quelques framboises fraîches',
  },
  coffee: {
    id: 'coffee',
    name: 'Café',
    color: '#7a4a2a',
    pricePerScoop: 2.8,
    description: 'Espresso italien infusé dans une base crémeuse au lait entier.',
    allergens: ['lait'],
    imageSrc: '/images/flavors/coffee.webp',
    imageAlt: 'Quenelle de glace au café espresso avec quelques grains torréfiés',
  },
};

export const FLAVOR_IDS = Object.keys(FLAVORS);

// The one dietary claim the catalogue card can make truthfully from the
// allergen list alone. Derived, never stored, so it can't drift from FLAVORS.
export function dietLabel(allergens: Allergen[]): string | undefined {
  if (allergens.includes('lait') || allergens.includes('œufs')) return undefined;
  return 'sans lait dans la recette';
}

export interface Topping {
  id: string;
  name: string;
  price: number;
  description: string;
  allergens: Allergen[];
  imageSrc: string;
  imageAlt: string;
}

export const TOPPINGS: Record<string, Topping> = {
  'chocolate-sauce': {
    id: 'chocolate-sauce',
    name: 'Sauce chocolat',
    price: 0.8,
    description: 'Sauce au chocolat noir tiède. Contient du lait et de la lécithine de soja.',
    allergens: ['lait', 'soja'],
    imageSrc: '/images/toppings/chocolate-sauce.webp',
    imageAlt: 'Sauce au chocolat noir tiède dans un petit pichet en céramique',
  },
  'caramel-sauce': {
    id: 'caramel-sauce',
    name: 'Sauce caramel',
    price: 0.8,
    description: 'Sauce caramel au beurre salé maison.',
    allergens: ['lait'],
    imageSrc: '/images/toppings/caramel-sauce.webp',
    imageAlt: 'Sauce caramel au beurre salé dans un petit pichet en céramique',
  },
  sprinkles: {
    id: 'sprinkles',
    name: 'Vermicelles',
    price: 0.5,
    description: 'Vermicelles colorés en sucre et farine de blé.',
    allergens: ['gluten', 'soja'],
    imageSrc: '/images/toppings/sprinkles.webp',
    imageAlt: 'Vermicelles de sucre aux couleurs douces dans une coupelle ivoire',
  },
  'whipped-cream': {
    id: 'whipped-cream',
    name: 'Chantilly',
    price: 1.0,
    description: 'Crème fouettée maison, légèrement sucrée.',
    allergens: ['lait'],
    imageSrc: '/images/toppings/whipped-cream.webp',
    imageAlt: 'Chantilly maison dressée dans une petite coupe en argent patiné',
  },
  nuts: {
    id: 'nuts',
    name: 'Noisettes',
    price: 0.8,
    description: 'Noisettes du Piémont concassées et torréfiées. Trace possible d\'autres fruits à coque.',
    allergens: ['fruits à coque'],
    imageSrc: '/images/toppings/nuts.webp',
    imageAlt: 'Noisettes du Piémont torréfiées et concassées dans une coupelle',
  },
  cherry: {
    id: 'cherry',
    name: 'Cerise',
    price: 0.5,
    description: 'Cerise confite au sirop. Contient des sulfites (conservateur).',
    allergens: ['sulfites'],
    imageSrc: '/images/toppings/cherry.webp',
    imageAlt: 'Cerises confites au sirop dans une petite coupelle en argent patiné',
  },
};

export const TOPPING_IDS = Object.keys(TOPPINGS);

export type ConeType = 'cone' | 'cup' | 'waffle-cup';

export interface Cone {
  name: string;
  price: number;
  description: string;
  allergens: Allergen[];
  imageSrc: string;
  imageAlt: string;
}

export const CONES: Record<ConeType, Cone> = {
  cone: {
    name: 'Cornet gaufré',
    price: 0.5,
    description: 'Cornet gaufré croquant à base de farine de blé, œufs et lait.',
    allergens: ['gluten', 'œufs', 'lait'],
    imageSrc: '/images/containers/cone.webp',
    imageAlt: 'Cornet gaufré artisanal vide sur un linge de lin ivoire',
  },
  cup: {
    name: 'Pot',
    price: 0,
    description: 'Pot en carton. Aucun allergène.',
    allergens: [],
    imageSrc: '/images/containers/cup.webp',
    imageAlt: 'Petit pot à glace en carton ivoire sans inscription',
  },
  'waffle-cup': {
    name: 'Coupe gaufrée',
    price: 0.8,
    description: 'Coupe gaufrée artisanale à base de farine de blé, œufs et lait.',
    allergens: ['gluten', 'œufs', 'lait'],
    imageSrc: '/images/containers/waffle-cup.webp',
    imageAlt: 'Coupe gaufrée artisanale vide avec bord festonné',
  },
};
