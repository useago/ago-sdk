import { useState } from 'react';
import { useAgoPageState } from '@useago/sdk/react';
import { Allergen, FLAVORS } from './flavors';

// A browsable "parfums" page whose view state lives in local useState — NOT in
// the URL. That's the point: the agent can't seed this by navigating with query
// params, so "va sur la page parfums et montre les parfums sans lactose" only
// works if, after navigation, the agent gets this page's controls + current
// state. useAgoPageState exposes them; useAgoAutoContinueAfterNavigation (mounted
// in App) makes the two-step happen in one user gesture.

type DietaryFilter = 'all' | 'sans-lactose' | 'sans-fruits-a-coque' | 'sans-gluten';
type SortBy = 'nom' | 'prix';
type ViewMode = 'grille' | 'liste';

const FILTER_ALLERGENS: Record<Exclude<DietaryFilter, 'all'>, Allergen[]> = {
  'sans-lactose': ['lait'],
  'sans-fruits-a-coque': ['fruits à coque', 'arachides'],
  'sans-gluten': ['gluten'],
};

function matchesDiet(allergens: Allergen[], filter: DietaryFilter): boolean {
  if (filter === 'all') return true;
  const excluded = FILTER_ALLERGENS[filter];
  return !allergens.some((a) => excluded.includes(a));
}

export default function FlavorsPage() {
  const [dietaryFilter, setDietaryFilter] = useState<DietaryFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('nom');
  const [view, setView] = useState<ViewMode>('grille');

  // The agent can read the current view and change it. One synthesized
  // setPageState function, one optional property per control.
  useAgoPageState([
    {
      name: 'dietaryFilter',
      description:
        'Filtre les parfums par régime alimentaire. "all" = tous ; "sans-lactose", "sans-fruits-a-coque", "sans-gluten" = masque les parfums contenant l’allergène correspondant.',
      schema: { type: 'string', enum: ['all', 'sans-lactose', 'sans-fruits-a-coque', 'sans-gluten'] },
      get: () => dietaryFilter,
      set: (v) => setDietaryFilter(v as DietaryFilter),
    },
    {
      name: 'sortBy',
      description: 'Ordre de tri de la liste des parfums : par nom ou par prix.',
      schema: { type: 'string', enum: ['nom', 'prix'] },
      get: () => sortBy,
      set: (v) => setSortBy(v as SortBy),
    },
    {
      name: 'view',
      description: 'Mode d’affichage : "grille" (cartes) ou "liste" (compact).',
      schema: { type: 'string', enum: ['grille', 'liste'] },
      get: () => view,
      set: (v) => setView(v as ViewMode),
    },
  ]);

  const flavors = Object.values(FLAVORS)
    .filter((f) => matchesDiet(f.allergens, dietaryFilter))
    .sort((a, b) =>
      sortBy === 'prix' ? a.pricePerScoop - b.pricePerScoop : a.name.localeCompare(b.name),
    );

  return (
    <div className="flavors-page" style={{ padding: '1.5rem' }}>
      <header style={{ marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Nos parfums</h2>
        <p style={{ color: '#6b6b6b', margin: '0.25rem 0 0' }}>
          Filtre : <strong>{dietaryFilter}</strong> · Tri : <strong>{sortBy}</strong> · Vue :{' '}
          <strong>{view}</strong> · {flavors.length} parfum{flavors.length > 1 ? 's' : ''}
        </p>
        <p style={{ color: '#9a9a9a', fontSize: '0.85rem', marginTop: '0.5rem' }}>
          Essayez : « montre-moi seulement les parfums sans lactose, triés par prix ».
        </p>
      </header>

      <div
        style={
          view === 'grille'
            ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }
            : { display: 'flex', flexDirection: 'column', gap: '0.4rem' }
        }
      >
        {flavors.map((f) => (
          <div
            key={f.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              border: '1px solid #ececec',
              borderRadius: 10,
              padding: view === 'grille' ? '0.75rem' : '0.5rem 0.75rem',
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: f.color,
                flexShrink: 0,
                border: '1px solid rgba(0,0,0,0.1)',
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{f.name}</div>
              <div style={{ color: '#8a8a8a', fontSize: '0.8rem' }}>
                {f.pricePerScoop.toFixed(2)} € · {f.allergens.length === 0 ? 'sans allergène' : f.allergens.join(', ')}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
