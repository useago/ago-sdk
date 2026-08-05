// The Glacier maison design system: the small set of pieces every screen is
// built from. Styles are inline and reference only the `--` tokens declared in
// App.css, so the whole boutique re-skins from one place.
import type { CSSProperties, ReactNode } from 'react';
import { Link, type To } from 'react-router-dom';

/* ========================================================================== */
/* Typography                                                                 */
/* ========================================================================== */

/** Wide-tracked uppercase overline — the maison's section marker. */
export function Eyebrow({
  children,
  color = 'var(--gold)',
  align = 'left',
  style,
}: {
  children: ReactNode;
  color?: string;
  align?: 'left' | 'center';
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-body)',
        fontSize: '12px',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.26em',
        color,
        textAlign: align,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Gold eyebrow, display-serif title, gold rule, italic lede. How every section opens. */
export function SectionHeading({
  eyebrow,
  title,
  lede,
  align = 'left',
  ornament = true,
  style,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  align?: 'left' | 'center';
  ornament?: boolean;
  style?: CSSProperties;
}) {
  const center = align === 'center';
  return (
    <header
      style={{
        textAlign: align,
        maxWidth: center ? '760px' : undefined,
        marginInline: center ? 'auto' : 0,
        ...style,
      }}
    >
      {eyebrow && (
        <Eyebrow align={align} style={{ marginBottom: '18px' }}>
          {eyebrow}
        </Eyebrow>
      )}
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 500,
          fontSize: 'clamp(30px, 4vw, 52px)',
          lineHeight: 1.08,
          letterSpacing: '-0.01em',
          color: 'var(--text-strong)',
          margin: 0,
        }}
      >
        {title}
      </h1>
      {ornament && (
        <div
          style={{
            width: '54px',
            height: '1px',
            background: 'var(--gold)',
            margin: center ? '22px auto 0' : '22px 0 0',
          }}
        />
      )}
      {lede && (
        <p
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '20px',
            fontStyle: 'italic',
            lineHeight: 1.55,
            color: 'var(--text-muted)',
            marginTop: '20px',
            maxWidth: '620px',
            marginInline: center ? 'auto' : 0,
          }}
        >
          {lede}
        </p>
      )}
    </header>
  );
}

/* ========================================================================== */
/* Controls                                                                   */
/* ========================================================================== */

type ButtonVariant = 'primary' | 'accent' | 'gold' | 'ghost' | 'link';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_SIZES: Record<ButtonSize, CSSProperties> = {
  sm: { padding: '8px 18px', fontSize: '11px', letterSpacing: '0.16em' },
  md: { padding: '13px 28px', fontSize: '12px', letterSpacing: '0.16em' },
  lg: { padding: '17px 40px', fontSize: '13px', letterSpacing: '0.18em' },
};

const BUTTON_VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary: { background: 'var(--ink-900)', color: 'var(--text-inverse)', border: '1px solid var(--ink-900)' },
  accent: { background: 'var(--accent)', color: 'var(--text-on-accent)', border: '1px solid var(--accent)' },
  gold: { background: 'transparent', color: 'var(--ink-900)', border: '1px solid var(--gold)' },
  ghost: { background: 'transparent', color: 'var(--ink-900)', border: '1px solid var(--border-strong)' },
  link: { background: 'transparent', color: 'var(--accent)', border: '1px solid transparent', padding: '4px 2px' },
};

export function ButtonLink({
  children,
  to,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  style,
}: {
  children: ReactNode;
  to: To;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  style?: CSSProperties;
}) {
  return (
    <Link
      className="gl-btn"
      to={to}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        width: fullWidth ? '100%' : 'auto',
        fontFamily: 'var(--font-body)',
        fontWeight: 500,
        textTransform: 'uppercase',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        borderRadius: 'var(--r-sm)',
        transition: 'var(--t-hover)',
        ...BUTTON_SIZES[size],
        ...BUTTON_VARIANTS[variant],
        ...style,
      }}
    >
      {children}
    </Link>
  );
}

/* ========================================================================== */
/* Data display                                                               */
/* ========================================================================== */

/** A flavor colour dot — solid fill, optional speckle. */
export function Swatch({
  color,
  speckle,
  size = 22,
  style,
}: {
  color: string;
  speckle?: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: speckle
          ? `radial-gradient(circle at 30% 30%, ${speckle} 0 2px, transparent 2px),` +
            `radial-gradient(circle at 68% 62%, ${speckle} 0 1.6px, transparent 1.6px), ${color}`
          : color,
        boxShadow: 'inset 0 0 0 1px rgba(30,23,18,0.10)',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

type PillTone = 'default' | 'solid' | 'gold' | 'accent';

const PILL_TONES: Record<PillTone, CSSProperties> = {
  default: { background: 'var(--surface-raised)', color: 'var(--text-strong)', border: '1px solid var(--border-hairline)' },
  solid: { background: 'var(--ink-900)', color: 'var(--text-inverse)', border: '1px solid var(--ink-900)' },
  gold: { background: 'var(--or-300)', color: 'var(--ink-800)', border: '1px solid var(--gold)' },
  accent: { background: 'var(--accent-soft)', color: 'var(--framboise-900)', border: '1px solid var(--framboise-400)' },
};

/** A compact taxonomy pill — flavor chip (with swatch) or a plain tag. */
export function Pill({
  children,
  color,
  speckle,
  tone = 'default',
  caps = false,
  style,
}: {
  children: ReactNode;
  color?: string;
  speckle?: string;
  tone?: PillTone;
  caps?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 13px',
        borderRadius: 'var(--r-pill)',
        fontFamily: 'var(--font-body)',
        fontSize: '12.5px',
        fontWeight: 500,
        textTransform: caps ? 'uppercase' : 'none',
        letterSpacing: caps ? '0.12em' : 0,
        ...PILL_TONES[tone],
        ...style,
      }}
    >
      {color && <Swatch color={color} speckle={speckle} size={13} />}
      {children}
    </span>
  );
}

type BadgeTone = 'neutral' | 'allergen' | 'safe' | 'gold';

const BADGE_TONES: Record<BadgeTone, CSSProperties> = {
  neutral: { background: 'var(--surface-fill)', color: 'var(--text-muted)', border: '1px solid var(--border-hairline)' },
  allergen: { background: 'var(--warn-soft)', color: 'var(--warn)', border: '1px solid var(--warn-border)' },
  safe: { background: 'var(--ok-soft)', color: 'var(--ok)', border: '1px solid var(--ok-border)' },
  gold: { background: 'var(--or-300)', color: 'var(--or-700)', border: '1px solid var(--gold)' },
};

/** A small status token — allergen present, diet-safe, or a neutral note. */
export function Badge({
  children,
  tone = 'neutral',
  style,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '3px 10px',
        borderRadius: 'var(--r-pill)',
        fontFamily: 'var(--font-body)',
        fontSize: '11.5px',
        fontWeight: 500,
        lineHeight: 1.5,
        ...BADGE_TONES[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** A euro price in the display serif — the maison way of quoting a scoop. */
export function PriceTag({
  amount,
  suffix = '€',
  size = 'md',
  muted = false,
  style,
}: {
  amount: number;
  suffix?: string;
  size?: 'sm' | 'md' | 'lg';
  muted?: boolean;
  style?: CSSProperties;
}) {
  const sizes = { sm: '15px', md: '20px', lg: '30px' };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: '3px',
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
        fontSize: sizes[size],
        lineHeight: 1,
        color: muted ? 'var(--text-muted)' : 'var(--text-strong)',
        ...style,
      }}
    >
      {amount.toFixed(2).replace('.', ',')}
      <span style={{ fontSize: '0.7em', fontWeight: 500 }}>{suffix}</span>
    </span>
  );
}

/* ========================================================================== */
/* Surfaces                                                                   */
/* ========================================================================== */

/** The base maison surface — cream, hairline border, restrained radius. */
export function Card({
  children,
  raised = false,
  padded = true,
  style,
}: {
  children: ReactNode;
  raised?: boolean;
  padded?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--r-lg)',
        boxShadow: raised ? 'var(--shadow-md)' : 'none',
        padding: padded ? '24px' : 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** An inset gold rule floating over any surface — the maison's picture frame. */
export function GoldFrame({
  children,
  inset = '10px',
  style,
}: {
  children: ReactNode;
  inset?: string;
  style?: CSSProperties;
}) {
  return (
    <div style={{ position: 'relative', ...style }}>
      <div
        style={{
          position: 'absolute',
          inset,
          border: '1px solid var(--gold)',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      />
      {children}
    </div>
  );
}

/** A parfum catalogue card — colour band, serif name, tasting note, price. */
export function FlavorCard({
  name,
  color,
  speckle,
  description,
  price,
  dietLabel,
  imageSrc,
  imageAlt,
  to,
  style,
}: {
  name: string;
  color: string;
  speckle?: string;
  description?: string;
  price: number;
  dietLabel?: string;
  imageSrc?: string;
  imageAlt?: string;
  to?: To;
  style?: CSSProperties;
}) {
  const cardStyle: CSSProperties = {
    background: 'var(--surface-card)',
    border: '1px solid var(--border-hairline)',
    borderTop: `2px solid ${color}`,
    borderRadius: 'var(--r-lg)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    color: 'inherit',
    textDecoration: 'none',
    ...style,
  };
  const content = (
    <>
      {imageSrc ? (
        <div className="gl-flavor-card-media" style={{ aspectRatio: '16 / 10', overflow: 'hidden' }}>
          <img
            src={imageSrc}
            alt={imageAlt ?? ''}
            loading="lazy"
            decoding="async"
            className="gl-flavor-card-image"
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
        </div>
      ) : (
        <div
          style={{
            height: '104px',
            background: `radial-gradient(120% 120% at 50% -10%, ${color} 0%, ${color} 55%, rgba(0,0,0,0.06) 130%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Swatch
            color={color}
            speckle={speckle}
            size={44}
            style={{ boxShadow: '0 4px 14px rgba(30,23,18,0.18), inset 0 0 0 1px rgba(255,255,255,0.5)' }}
          />
        </div>
      )}
      <div style={{ padding: '18px 20px 20px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' }}>
          <h3
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: '24px',
              lineHeight: 1,
              color: 'var(--text-strong)',
              margin: 0,
            }}
          >
            {name}
          </h3>
          <PriceTag amount={price} size="sm" />
        </div>
        {description && (
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: '13px',
              lineHeight: 1.55,
              color: 'var(--text-muted)',
              margin: 0,
              flex: 1,
            }}
          >
            {description}
          </p>
        )}
        {dietLabel && (
          <div style={{ marginTop: '2px' }}>
            <Badge tone="safe">{dietLabel}</Badge>
          </div>
        )}
      </div>
    </>
  );

  return to ? (
    <Link className="gl-lift gl-flavor-card" to={to} style={cardStyle}>
      {content}
    </Link>
  ) : (
    <article className="gl-flavor-card" style={cardStyle}>
      {content}
    </article>
  );
}

/** A terroir card — editorial photograph, origin details, italic tagline. */
export function OriginCard({
  ingredient,
  terroir,
  country,
  tagline,
  accent = 'var(--gold)',
  imageSrc,
  imageAlt,
  to,
  style,
}: {
  ingredient: string;
  terroir: string;
  country: string;
  tagline?: string;
  accent?: string;
  imageSrc?: string;
  imageAlt?: string;
  to?: To;
  style?: CSSProperties;
}) {
  const cardStyle: CSSProperties = {
    background: 'var(--surface-card)',
    border: '1px solid var(--border-hairline)',
    borderTop: `2px solid ${accent}`,
    borderRadius: 'var(--r-lg)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    color: 'inherit',
    textDecoration: 'none',
    ...style,
  };
  const content = (
    <>
      {imageSrc && (
        <div className="gl-origin-card-media" style={{ aspectRatio: '16 / 10', overflow: 'hidden' }}>
          <img
            src={imageSrc}
            alt={imageAlt ?? ''}
            loading="lazy"
            decoding="async"
            className="gl-origin-card-image"
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
        </div>
      )}
      <div style={{ padding: '22px 24px 24px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: '11px',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.18em',
            color: 'var(--text-faint)',
          }}
        >
          {country}
        </div>
        <h3
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: '27px',
            lineHeight: 1.05,
            color: 'var(--text-strong)',
            margin: 0,
          }}
        >
          {ingredient}
        </h3>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 500, color: 'var(--text-body)' }}>
          {terroir}
        </div>
        {tagline && (
          <p
            style={{
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              fontSize: '15px',
              lineHeight: 1.5,
              color: 'var(--text-muted)',
              margin: '2px 0 0',
            }}
          >
            {tagline}
          </p>
        )}
      </div>
    </>
  );

  return to ? (
    <Link className="gl-lift" to={to} style={cardStyle}>
      {content}
    </Link>
  ) : (
    <article style={cardStyle}>{content}</article>
  );
}

/** Editorial terroir photography, presented like a plate in a print catalogue. */
export function TerroirPlate({
  accent,
  emblem,
  imageSrc,
  imageAlt,
  caption,
  height = 'clamp(240px, 48cqw, 320px)',
}: {
  accent: string;
  emblem: string;
  imageSrc?: string;
  imageAlt?: string;
  caption?: string;
  height?: string;
}) {
  return (
    <GoldFrame inset="8px" style={{ height }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'var(--r-sm)',
          overflow: 'hidden',
          background: `radial-gradient(80% 110% at 25% 15%, ${accent} 0%, rgba(0,0,0,0) 62%), var(--sand)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={imageAlt ?? ''}
            decoding="async"
            className="gl-terroir-image"
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
        ) : (
          <span aria-hidden style={{ fontSize: 'clamp(80px, 18cqw, 140px)', lineHeight: 1, opacity: 0.9 }}>
            {emblem}
          </span>
        )}
        {imageSrc && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 1,
              background: 'linear-gradient(180deg, rgba(30,23,18,0.02) 42%, rgba(30,23,18,0.36) 100%)',
            }}
          />
        )}
      </div>
      {caption && (
        <div
          style={{
            position: 'absolute',
            left: '28px',
            bottom: '28px',
            zIndex: 3,
            background: 'rgba(30,23,18,0.72)',
            color: 'var(--text-inverse)',
            padding: '10px 16px',
            fontFamily: 'var(--font-body)',
            fontSize: '11px',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            pointerEvents: 'none',
            backdropFilter: 'blur(8px)',
          }}
        >
          {caption}
        </div>
      )}
    </GoldFrame>
  );
}

/** The maison monogram — a gold-ruled medallion around a didone G. */
export function Monogram({ size = 46 }: { size?: number }) {
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label="Monogramme Glacier" style={{ display: 'block' }}>
      <circle cx="100" cy="100" r="95" fill="none" stroke="var(--gold)" strokeWidth="1" />
      <circle cx="100" cy="100" r="88" fill="none" stroke="var(--gold)" strokeWidth="1.6" />
      <text x="100" y="38" textAnchor="middle" fill="var(--gold)" fontFamily="var(--font-display)" fontSize="16">
        ✦
      </text>
      <text
        x="100"
        y="132"
        textAnchor="middle"
        fill="var(--text-strong)"
        fontFamily="var(--font-display)"
        fontWeight="500"
        fontSize="104"
      >
        G
      </text>
      <text
        x="100"
        y="168"
        textAnchor="middle"
        fill="var(--text-muted)"
        fontFamily="var(--font-body)"
        fontWeight="500"
        fontSize="10"
        letterSpacing="4"
      >
        EST. MMXIX
      </text>
    </svg>
  );
}
