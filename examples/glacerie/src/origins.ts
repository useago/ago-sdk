export interface Origin {
  id: string;
  ingredient: string;
  terroir: string;
  country: string;
  emoji: string;
  accent: string;
  tagline: string;
  story: string;
  notes: string[];
  relatedFlavorId?: string;
  relatedToppingId?: string;
}

export const ORIGINS: Record<string, Origin> = {
  'vanille-tahiti': {
    id: 'vanille-tahiti',
    ingredient: 'Vanille',
    terroir: 'Îles de la Société',
    country: 'Polynésie française',
    emoji: '🌺',
    accent: '#f5d28a',
    tagline: 'Vanilla tahitensis — la vanille la plus parfumée du monde.',
    story:
      "Cultivée sur les atolls de Raiatea, Taha'a et Huahine, la vanille de Tahiti est une espèce à part (Vanilla tahitensis), distincte de la vanille bourbon. Ses gousses, plus charnues et plus courtes, libèrent un parfum floral unique — notes d'anis, de prune et de fleur blanche — qui ne supporte pas la cuisson agressive. Nous la laissons infuser à froid 24h dans le lait avant turbinage.",
    notes: [
      "Infusion à froid pour préserver l'arôme floral",
      'Gousses fendues à la main, grattées',
      'Récolte 2024, plantation de Taha\'a',
    ],
    relatedFlavorId: 'vanilla',
  },
  'pistache-bronte': {
    id: 'pistache-bronte',
    ingredient: 'Pistache',
    terroir: 'Bronte, versants de l\'Etna',
    country: 'Sicile, Italie',
    emoji: '🌋',
    accent: '#bdd49a',
    tagline: 'Le pistacchio verde di Bronte DOP — l\'or vert sicilien.',
    story:
      "Sur les coulées de lave de l'Etna, à 500m d'altitude, les pistachiers de Bronte ne produisent qu'une année sur deux. Le sol volcanique donne à cette pistache une couleur émeraude intense et une douceur sans amertume. Récoltées à la main fin août, les pistaches sont mondées, légèrement torréfiées, puis broyées en pâte pure — sans colorant ni huile ajoutée.",
    notes: [
      'Appellation DOP, récolte 2024',
      'Pâte pure, broyée chez nous',
      'Aucun colorant — la couleur vient du fruit',
    ],
    relatedFlavorId: 'pistachio',
  },
  'citron-menton': {
    id: 'citron-menton',
    ingredient: 'Citron',
    terroir: 'Côte d\'Azur',
    country: 'Menton, France',
    emoji: '🍋',
    accent: '#fff2a8',
    tagline: 'IGP Citron de Menton — peu acide, intensément parfumé.',
    story:
      "Le citron de Menton, IGP depuis 2015, pousse sur les coteaux qui dominent la Méditerranée. Le microclimat — pas de gel, ensoleillement maximal — donne un fruit à la peau épaisse, riche en huiles essentielles, et au jus moins acide que la moyenne. Nous utilisons le zeste pour parfumer le sorbet, et le jus pressé le matin même. Aucun arôme ajouté.",
    notes: [
      'IGP Citron de Menton',
      'Zeste + jus pressé le jour',
      'Sorbet plein fruit (45% de fruit)',
    ],
    relatedFlavorId: 'lemon',
  },
  'mangue-alphonso': {
    id: 'mangue-alphonso',
    ingredient: 'Mangue',
    terroir: 'Konkan, côte ouest',
    country: 'Inde',
    emoji: '🥭',
    accent: '#ffc070',
    tagline: 'La reine des mangues — saison courte, parfum inégalé.',
    story:
      "La mangue Alphonso (\"Hapus\") ne se cultive que sur une étroite bande côtière du Maharashtra, entre avril et juin. Sa chair, sans fibre, d'un orange profond, concentre des arômes de pêche, d'abricot et de safran. Nous l'achetons en purée pasteurisée à froid, importée par bateau, pour conserver la fraîcheur du fruit cueilli à maturité.",
    notes: [
      'Saison avril-juin uniquement',
      'Purée pasteurisée à froid',
      'Sorbet plein fruit (50% de fruit)',
    ],
    relatedFlavorId: 'mango',
  },
  'noisette-piemont': {
    id: 'noisette-piemont',
    ingredient: 'Noisette',
    terroir: 'Langhe, collines du Piémont',
    country: 'Italie',
    emoji: '🌰',
    accent: '#c89a6b',
    tagline: 'Tonda Gentile Trilobata IGP — la noisette des grands chocolatiers.',
    story:
      "La Tonda Gentile pousse sur les mêmes collines que le Barolo et le Barbaresco. Ronde, à coque fine, elle est récoltée fin août quand elle tombe naturellement de l'arbre, puis torréfiée doucement à 140°C pendant 25 minutes — ni cru, ni amer. C'est la noisette que Ferrero et les plus grands maîtres chocolatiers utilisent. Nous la concassons à la dernière minute.",
    notes: [
      'IGP Tonda Gentile Trilobata',
      'Torréfaction maison à 140°C',
      'Concassée à la commande',
    ],
    relatedToppingId: 'nuts',
  },
  'cacao-equateur': {
    id: 'cacao-equateur',
    ingredient: 'Cacao',
    terroir: 'Vallée du Río Esmeraldas',
    country: 'Équateur',
    emoji: '🍫',
    accent: '#5b3a29',
    tagline: 'Cacao Nacional Arriba — le grand cru équatorien.',
    story:
      "Le cacao Nacional, originaire de la haute Amazonie équatorienne, est l'une des plus anciennes variétés cultivées au monde. Classé \"fine flavour\" par l'ICCO, il développe des notes florales rares — jasmin, agrumes, fruits rouges. Nous utilisons un chocolat noir 70% conché 72 heures à partir de fèves fermentées sous feuilles de bananier dans la vallée d'Esmeraldas.",
    notes: [
      'Chocolat 70% origine Équateur',
      'Conchage long (72h)',
      'Fèves fermentées 6 jours',
    ],
    relatedFlavorId: 'chocolate',
  },
  'fraise-gariguette': {
    id: 'fraise-gariguette',
    ingredient: 'Fraise',
    terroir: 'Périgord et Sud-Ouest',
    country: 'France',
    emoji: '🍓',
    accent: '#f4a8b6',
    tagline: 'Gariguette — la fraise française par excellence, mars à juin.',
    story:
      "Variété française obtenue en 1976 à l'INRAE d'Avignon, la Gariguette est reconnaissable à sa forme allongée et conique, sa couleur rouge orangé brillante et son parfum prononcé. Récoltée à pleine maturité — elle ne mûrit plus après cueillette — elle ne se conserve que 48h. Nous la travaillons fraîche en pleine saison, et passons à la Mara des Bois en juillet-août.",
    notes: [
      'Saison mars-juin, fraîche uniquement',
      'Producteur partenaire en Dordogne',
      'Variété hors saison : Mara des Bois',
    ],
    relatedFlavorId: 'strawberry',
  },
  'cafe-ethiopie': {
    id: 'cafe-ethiopie',
    ingredient: 'Café',
    terroir: 'Sidamo, hauts plateaux',
    country: 'Éthiopie',
    emoji: '☕',
    accent: '#7a4a2a',
    tagline: 'Sidamo lavé — berceau du café arabica.',
    story:
      "L'Éthiopie est le berceau historique de l'arabica, et la région du Sidamo, entre 1800 et 2200m d'altitude, en produit l'une des expressions les plus aromatiques. Notre lot est un Grade 1 lavé, aux notes de bergamote, jasmin et myrtille. Nous l'infusons en espresso double, refroidi rapidement, dans une base lactée — pour conserver l'acidité vive du grain.",
    notes: [
      'Sidamo Grade 1, processus lavé',
      'Torréfaction medium par notre torréfacteur lyonnais',
      'Extraction espresso minute',
    ],
    relatedFlavorId: 'coffee',
  },
};

export const ORIGIN_IDS = Object.keys(ORIGINS);
