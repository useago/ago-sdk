import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAgoPageState } from '@useago/sdk/react';
import { Allergen, dietLabel, FLAVORS } from './flavors';
import { ORIGIN_BY_FLAVOR } from './origins';
import { marketPriceOf, useMarketPrices } from './marketPrices';
import { Badge, FlavorCard, PriceTag, SectionHeading } from './ui';

// A browsable "parfums" page whose view state lives in local useState — NOT in
// the URL. That's the point: the agent can't seed this by navigating with query
// params, so "va sur la page parfums et montre les parfums sans lactose" only
// works if, after navigation, the agent gets this page's controls + current
// state. useAgoPageState exposes them; useAgoAutoContinueAfterNavigation (mounted
// in App) makes the two-step happen in one user gesture.
//
// This page is also where the `data` option earns its keep. Switching the price
// source to "marche" fires a real HTTP request, so the rows on screen lag the
// control by a network round trip. Without `data`, the agent only learns its
// own arguments were accepted and has to wait for the next message to see the
// result; with it, the SDK waits for `isFetching` to clear and hands back the
// rows the customer is actually looking at, in the same turn.

type DietaryFilter = 'all' | 'sans-lactose' | 'sans-fruits-a-coque' | 'sans-gluten';
type SortBy = 'nom' | 'prix';
type ViewMode = 'grille' | 'liste';
type PriceSource = 'maison' | 'marche';

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

/** Prix retenu pour l'affichage et le tri : le cours du jour s'il est coté. */
function priceOf(
  flavor: { pricePerScoop: number; marketPrice: number | null },
  source: PriceSource,
): number {
  if (source === 'marche' && flavor.marketPrice !== null) return flavor.marketPrice;
  return flavor.pricePerScoop;
}

export default function FlavorsPage() {
  const [dietaryFilter, setDietaryFilter] = useState<DietaryFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('nom');
  const [view, setView] = useState<ViewMode>('grille');
  const [priceSource, setPriceSource] = useState<PriceSource>('maison');

  // Le cours du jour n'est chargé que si on l'affiche. `isFetching` couvre
  // chaque rechargement, pas seulement le premier.
  const { prices, isFetching, error, ensure } = useMarketPrices(priceSource === 'marche');

  const flavors = Object.values(FLAVORS)
    .filter((f) => matchesDiet(f.allergens, dietaryFilter))
    .map((f) => ({ ...f, marketPrice: marketPriceOf(f.id, prices) }))
    .sort((a, b) =>
      sortBy === 'prix'
        ? priceOf(a, priceSource) - priceOf(b, priceSource)
        : a.name.localeCompare(b.name, 'fr'),
    );

  // The agent can read the current view and change it. One synthesized
  // setPageState function, one optional property per control.
  useAgoPageState(
    [
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
      {
        name: 'priceSource',
        description:
          'Prix affichés : "maison" (notre tarif à la boule) ou "marche" (cours du jour, chargé depuis le service de prix). Passer à "marche" déclenche un appel réseau.',
        schema: { type: 'string', enum: ['maison', 'marche'] },
        get: () => priceSource,
        set: (v) => setPriceSource(v as PriceSource),
      },
    ],
    {
      // Ce que la page affiche, renvoyé à l'agent comme résultat de SON appel.
      // Sans ça, « passe au cours du jour et dis-moi le parfum le moins cher »
      // demanderait deux tours : un pour changer la source, un pour lire les prix.
      data: {
        description:
          'Les parfums actuellement affichés, dans l’ordre affiché, avec le prix maison et (si la source est "marche") le cours du jour en euros.',
        // `get` retourne une PROMESSE : le SDK l'attend, donc il sait
        // exactement quand le travail déclenché par le changement est fini. Pas
        // de sondage, pas d'hypothèse de timing. `ensure()` partage la requête
        // déjà en vol pour l'UI, donc un seul appel réseau.
        get: async () => {
          const live = priceSource === 'marche' ? await ensure() : null;
          return {
            priceSource,
            dietaryFilter,
            sortBy,
            parfums: Object.values(FLAVORS)
              .filter((f) => matchesDiet(f.allergens, dietaryFilter))
              .map((f) => ({
                id: f.id,
                nom: f.name,
                prixMaisonEuros: f.pricePerScoop,
                // null = ce parfum n'est pas coté par le service de prix.
                coursDuJourEuros: marketPriceOf(f.id, live),
                allergenes: f.allergens,
              }))
              .sort((a, b) =>
                sortBy === 'prix'
                  ? (a.coursDuJourEuros ?? a.prixMaisonEuros) -
                    (b.coursDuJourEuros ?? b.prixMaisonEuros)
                  : a.nom.localeCompare(b.nom, 'fr'),
              ),
          };
        },
      },
    },
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
            label="Prix"
            options={['maison', 'marche'] as const}
            value={priceSource}
            onChange={setPriceSource}
          />
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
        {priceSource === 'marche' && isFetching && <Badge>cours du jour…</Badge>}
        {priceSource === 'marche' && !isFetching && !error && <Badge tone="safe">cours du jour</Badge>}
        {priceSource === 'marche' && error && <Badge tone="allergen">prix indisponibles</Badge>}
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
                price={priceOf(f, priceSource)}
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
                    {priceSource === 'marche' && f.marketPrice === null && ' · non coté'}
                  </div>
                </div>
                <PriceTag amount={priceOf(f, priceSource)} size="sm" />
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
