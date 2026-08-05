// The boutique's furniture: announce bar, sticky header, dark footer.
// Present on every route, so the maison frames the app rather than each page
// re-declaring its own header.
import { Link, useLocation } from 'react-router-dom';
import { ButtonLink, Monogram } from './ui';

const NAV = [
  { to: '/', label: 'Boutique' },
  { to: '/parfums', label: 'Parfums' },
  { to: '/origines', label: 'Origines' },
  { to: '/ingredients', label: 'Ingrédients' },
];

export function AnnounceBar() {
  return (
    <div
      style={{
        background: 'var(--ink-900)',
        color: 'var(--gold)',
        textAlign: 'center',
        padding: '9px 24px',
        fontFamily: 'var(--font-body)',
        fontSize: '11px',
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
      }}
    >
      Retrait boutique quai Saint-Antoine · Livraison fraîche à Lyon · Tous les jours 11h–23h
    </div>
  );
}

export function BoutiqueHeader({ orderCount, grandTotal }: { orderCount: number; grandTotal: number }) {
  const { pathname } = useLocation();
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to));

  return (
    <header
      className="gl-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '20px',
        borderBottom: '1px solid var(--border-hairline)',
        background: 'rgba(251,247,238,0.86)',
        backdropFilter: 'blur(8px)',
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}
    >
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '14px', textDecoration: 'none' }}>
        <Monogram />
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: '9.5px',
              letterSpacing: '0.34em',
              textTransform: 'uppercase',
              color: 'var(--gold)',
              marginBottom: '5px',
            }}
          >
            Maison de glaces
          </span>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '27px',
              fontWeight: 500,
              letterSpacing: '0.05em',
              color: 'var(--text-strong)',
            }}
          >
            GLACIER
          </span>
        </span>
      </Link>

      <nav className="gl-nav">
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className="gl-nav-link"
            style={{
              padding: '6px 0',
              textDecoration: 'none',
              fontFamily: 'var(--font-body)',
              fontSize: '12px',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              transition: 'var(--t-hover)',
              color: isActive(n.to) ? 'var(--accent)' : 'var(--text-body)',
              borderBottom: `1px solid ${isActive(n.to) ? 'var(--accent)' : 'transparent'}`,
            }}
          >
            {n.label}
          </Link>
        ))}
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
        <span
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: '12px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}
        >
          Commande · {orderCount} — {grandTotal.toFixed(2).replace('.', ',')} €
        </span>
        <ButtonLink to="/parfums" variant="accent" size="sm">
          Commander
        </ButtonLink>
      </div>
    </header>
  );
}

const FOOTER_COLUMNS: { heading: string; items: { label: string; to?: string }[] }[] = [
  {
    heading: 'La maison',
    items: [
      { label: 'Composer une glace', to: '/' },
      { label: 'Nos origines', to: '/origines' },
      { label: 'Ingrédients & allergènes', to: '/ingredients' },
    ],
  },
  {
    heading: 'Parfums',
    items: [
      { label: 'Toute la carte', to: '/parfums' },
      { label: 'Sorbets plein fruit', to: '/parfums' },
      { label: 'Crèmes de saison', to: '/parfums' },
    ],
  },
  {
    heading: 'Contact',
    items: [
      { label: '12 quai Saint-Antoine, Lyon' },
      { label: 'bonjour@glacier.fr' },
      { label: 'Tous les jours · 11h–23h' },
    ],
  },
];

export function BoutiqueFooter() {
  return (
    <footer style={{ background: 'var(--ink-900)', color: 'var(--text-inverse)', padding: '64px 40px 40px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '40px',
          maxWidth: 'var(--content-max)',
          margin: '0 auto',
        }}
      >
        <div style={{ maxWidth: '300px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '30px', fontWeight: 500, letterSpacing: '0.04em' }}>
            GLACIER
          </div>
          <p
            style={{
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              fontSize: '17px',
              color: 'rgba(248,241,230,0.66)',
              marginTop: '12px',
              lineHeight: 1.5,
            }}
          >
            Depuis le fruit, jusqu'à la boule.
          </p>
        </div>

        {FOOTER_COLUMNS.map((col) => (
          <div key={col.heading}>
            <div
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: '11px',
                textTransform: 'uppercase',
                letterSpacing: '0.22em',
                color: 'var(--gold)',
                marginBottom: '16px',
              }}
            >
              {col.heading}
            </div>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {col.items.map((item) => {
                const style = {
                  fontFamily: 'var(--font-body)',
                  fontSize: '13.5px',
                  color: 'rgba(248,241,230,0.7)',
                  textDecoration: 'none',
                  transition: 'var(--t-hover)',
                } as const;
                return (
                  <li key={`${col.heading}-${item.label}`}>
                    {item.to ? (
                      <Link to={item.to} className="gl-footer-link" style={style}>
                        {item.label}
                      </Link>
                    ) : (
                      <span style={style}>{item.label}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div
        style={{
          borderTop: '1px solid rgba(248,241,230,0.14)',
          marginTop: '48px',
          paddingTop: '22px',
          textAlign: 'center',
          fontFamily: 'var(--font-body)',
          fontSize: '11px',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'rgba(248,241,230,0.4)',
        }}
      >
        © 2026 Glacier · Maison de glaces · Lyon
      </div>
    </footer>
  );
}

/** The dark savoir-faire trio that closes the editorial pages. */
export function SavoirFaire() {
  const cards = [
    {
      n: 'I',
      h: "Le fruit d'abord",
      p: "Nous n'achetons qu'en pleine saison, à des producteurs nommés. Hors saison, un parfum disparaît de la carte plutôt que de céder au congelé.",
    },
    {
      n: 'II',
      h: 'Turbiné le matin',
      p: "Chaque bac est turbiné le jour de sa vente, jamais stocké. Peu d'air, peu de sucre — la texture d'une glace, pas d'une mousse.",
    },
    {
      n: 'III',
      h: 'Rien de superflu',
      p: "Pas de colorant, pas d'arôme ajouté. La couleur de la pistache vient de la pistache ; celle du citron, du zeste pressé le matin.",
    },
  ];

  return (
    <section
      className="gl-savoir"
      style={{
        background: 'var(--ink-900)',
        color: 'var(--text-inverse)',
        borderRadius: 'var(--r-lg)',
        padding: 'clamp(40px, 5vw, 64px)',
      }}
    >
      {cards.map((c) => (
        <div className="gl-savoir-card" key={c.n}>
          <div
            className="gl-savoir-numeral"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '34px',
              fontWeight: 500,
              color: 'var(--gold)',
              letterSpacing: '0.06em',
            }}
          >
            {c.n}
          </div>
          <div
            className="gl-savoir-rule"
            style={{ width: '40px', height: '1px', background: 'var(--gold)', margin: '18px 0 22px' }}
          />
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '27px', fontWeight: 500, margin: '0 0 14px' }}>
            {c.h}
          </h3>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: '14.5px',
              lineHeight: 1.7,
              color: 'rgba(248,241,230,0.68)',
            }}
          >
            {c.p}
          </p>
        </div>
      ))}
    </section>
  );
}
