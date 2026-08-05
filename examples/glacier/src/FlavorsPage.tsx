import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAgoPageState } from '@useago/sdk/react';
import { Allergen, dietLabel, FLAVORS } from './flavors';
import { ORIGIN_BY_FLAVOR } from './origins';
import { Badge, FlavorCard, PriceTag, SectionHeading } from './ui';

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

const FILTER_LABELS: Record<DietaryFilter, string> = {
  all: 'Tous',
  'sans-lactose': 'Sans lait (recette)',
  'sans-fruits-a-coque': 'Sans fruits à coque',
  'sans-gluten': 'Sans gluten',
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
      sortBy === 'prix' ? a.pricePerScoop - b.pricePerScoop : a.name.localeCompare(b.name, 'fr'),
    );

  return (
    <div>
      <SectionHeading
        eyebrow="La carte"
        title="Nos parfums"
        lede="Dix créations à la carte — crèmes glacées et sorbets plein fruit. Filtrez selon votre régime."
      />

      {/* Filter bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          margin: '40px 0 24px',
          paddingBottom: '20px',
          borderBottom: '1px solid var(--border-hairline)',
        }}
      >
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {(Object.keys(FILTER_LABELS) as DietaryFilter[]).map((id) => {
            const active = dietaryFilter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setDietaryFilter(id)}
                aria-pressed={active}
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: '12px',
                  fontWeight: 500,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  padding: '9px 18px',
                  borderRadius: 'var(--r-pill)',
                  cursor: 'pointer',
                  transition: 'var(--t-hover)',
                  background: active ? 'var(--ink-900)' : 'transparent',
                  color: active ? 'var(--text-inverse)' : 'var(--text-body)',
                  border: `1px solid ${active ? 'var(--ink-900)' : 'var(--border-strong)'}`,
                }}
              >
                {FILTER_LABELS[id]}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          <ToggleGroup
            label="Trier"
            options={['nom', 'prix'] as const}
            value={sortBy}
            onChange={setSortBy}
          />
          <ToggleGroup
            label="Vue"
            options={['grille', 'liste'] as const}
            value={view}
            onChange={setView}
          />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontFamily: 'var(--font-body)',
          fontSize: '13px',
          color: 'var(--text-muted)',
          marginBottom: '24px',
        }}
      >
        {flavors.length} parfum{flavors.length > 1 ? 's' : ''}
        {dietaryFilter !== 'all' && <Badge tone="safe">{FILTER_LABELS[dietaryFilter].toLowerCase()}</Badge>}
      </div>

      {view === 'grille' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '22px' }}>
          {flavors.map((f) => {
            const origin = ORIGIN_BY_FLAVOR[f.id];
            return (
              <FlavorCard
                key={f.id}
                name={f.name}
                color={f.color}
                speckle={f.speckle}
                description={f.description}
                price={f.pricePerScoop}
                dietLabel={dietLabel(f.allergens)}
                imageSrc={f.imageSrc}
                imageAlt={f.imageAlt}
                to={origin ? `/origines/${origin.id}` : undefined}
              />
            );
          })}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
          {flavors.map((f) => {
            const content = (
              <>
                <img
                  src={f.imageSrc}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="gl-flavor-list-image"
                  style={{ width: '76px', height: '54px', display: 'block', objectFit: 'cover', borderRadius: 'var(--r-sm)' }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '21px',
                      fontWeight: 600,
                      color: 'var(--text-strong)',
                      lineHeight: 1.2,
                    }}
                  >
                    {f.name}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {f.allergens.length === 0 ? 'Sans allergène déclaré' : f.allergens.join(', ')}
                  </div>
                </div>
                <PriceTag amount={f.pricePerScoop} size="sm" />
              </>
            );
            const rowStyle = {
                display: 'flex',
                alignItems: 'center',
                gap: '18px',
                padding: '18px 4px',
                borderBottom: '1px solid var(--border-hairline)',
                color: 'inherit',
                textDecoration: 'none',
              } as const;
            const origin = ORIGIN_BY_FLAVOR[f.id];
            return (
              <li key={f.id}>
                {origin ? (
                  <Link className="gl-lift" to={`/origines/${origin.id}`} style={rowStyle}>{content}</Link>
                ) : (
                  <div style={rowStyle}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ToggleGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <span
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: '11px',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)',
        }}
      >
        {label}
      </span>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          aria-pressed={value === o}
          className="gl-quiet-btn"
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: '12px',
            fontWeight: 500,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textTransform: 'capitalize',
            transition: 'var(--t-hover)',
            color: value === o ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: `1px solid ${value === o ? 'var(--accent)' : 'transparent'}`,
            padding: '2px 0',
          }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
