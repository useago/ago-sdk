import { Link, useParams } from 'react-router-dom';
import { ORIGINS } from './origins';
import { FLAVORS, TOPPINGS } from './flavors';
import { SavoirFaire } from './Chrome';
import { ButtonLink, Eyebrow, OriginCard, Pill, SectionHeading, TerroirPlate } from './ui';

export function OriginsIndex() {
  const origins = Object.values(ORIGINS);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '56px' }}>
      <div>
        <SectionHeading
          eyebrow="Origines"
          title="Choisis un terroir à la fois"
          lede="Chaque ingrédient a un lieu, un producteur, une saison. Voici d'où vient ce que vous goûtez — ou demandez à l'assistant : « parle-moi de la vanille de Tahiti »."
        />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '22px',
            marginTop: '48px',
          }}
        >
          {origins.map((o) => (
            <OriginCard
              key={o.id}
              to={`/origines/${o.id}`}
              ingredient={o.ingredient}
              terroir={o.terroir}
              country={o.country}
              tagline={o.tagline}
              accent={o.accent}
              imageSrc={o.imageSrc}
              imageAlt={o.imageAlt}
            />
          ))}
        </div>
      </div>

      <SavoirFaire />
    </div>
  );
}

export function OriginDetail() {
  const { id } = useParams<{ id: string }>();
  const origin = id ? ORIGINS[id] : undefined;

  if (!origin) {
    return (
      <div>
        <SectionHeading
          eyebrow="Origines"
          title="Origine introuvable"
          lede="Cette origine n'existe pas (ou plus)."
        />
        <div style={{ marginTop: '32px' }}>
          <ButtonLink to="/origines" variant="gold">Toutes les origines</ButtonLink>
        </div>
      </div>
    );
  }

  const relatedFlavor = origin.relatedFlavorId ? FLAVORS[origin.relatedFlavorId] : undefined;
  const relatedTopping = origin.relatedToppingId ? TOPPINGS[origin.relatedToppingId] : undefined;

  return (
    <article>
      <Link
        to="/origines"
        className="gl-quiet-btn"
        style={{
          display: 'inline-block',
          textDecoration: 'none',
          fontFamily: 'var(--font-body)',
          fontSize: '12px',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          padding: '8px 0',
          marginBottom: '28px',
        }}
      >
        ← Toutes les origines
      </Link>

      <header style={{ borderTop: `2px solid ${origin.accent}`, paddingTop: '32px' }}>
        <Eyebrow>{origin.country}</Eyebrow>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            fontSize: 'clamp(40px, 6vw, 64px)',
            lineHeight: 1.04,
            color: 'var(--text-strong)',
            margin: '18px 0 0',
          }}
        >
          {origin.ingredient}
        </h1>
        <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-body)', marginTop: '10px' }}>
          {origin.terroir}
        </div>
        <p
          style={{
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontSize: '22px',
            lineHeight: 1.5,
            color: 'var(--text-muted)',
            margin: '20px 0 0',
            maxWidth: '640px',
          }}
        >
          {origin.tagline}
        </p>
      </header>

      <div style={{ marginTop: '40px' }}>
        <TerroirPlate
          accent={origin.accent}
          emblem={origin.emoji}
          imageSrc={origin.imageSrc}
          imageAlt={origin.imageAlt}
          caption={`${origin.ingredient} · ${origin.country}`}
        />
      </div>

      <div
        className="gl-origin-story"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 300px)',
          gap: '48px',
          marginTop: '48px',
          alignItems: 'start',
        }}
      >
        <p style={{ fontSize: '16px', lineHeight: 1.75, color: 'var(--text-body)' }}>{origin.story}</p>

        <aside
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--r-lg)',
            padding: '24px',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '0.2em',
              color: 'var(--gold)',
              marginBottom: '16px',
            }}
          >
            Notre choix
          </div>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {origin.notes.map((n) => (
              <li key={n} style={{ display: 'flex', gap: '10px', fontSize: '13.5px', lineHeight: 1.5, color: 'var(--text-body)' }}>
                <span style={{ color: origin.accent, fontWeight: 700 }}>—</span>
                {n}
              </li>
            ))}
          </ul>

          {(relatedFlavor || relatedTopping) && (
            <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--border-hairline)' }}>
              <div
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.14em',
                  color: 'var(--text-faint)',
                  marginBottom: '12px',
                }}
              >
                Se déguste en
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {relatedFlavor && (
                  <Pill color={relatedFlavor.color} speckle={relatedFlavor.speckle}>
                    {relatedFlavor.name}
                  </Pill>
                )}
                {relatedTopping && <Pill tone="gold">{relatedTopping.name}</Pill>}
              </div>
              <div style={{ marginTop: '18px' }}>
                <ButtonLink to="/" variant="accent" size="sm" fullWidth>
                  Composer une glace
                </ButtonLink>
              </div>
            </div>
          )}
        </aside>
      </div>
    </article>
  );
}
