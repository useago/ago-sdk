import { CONES, ConeType, FLAVORS, TOPPINGS } from './flavors';

export interface IceCreamState {
  cone: ConeType;
  scoops: string[];
  toppings: string[];
}

interface Props {
  state: IceCreamState;
}

export default function IceCream({ state }: Props) {
  return (
    <div className="ice-cream-stage">
      <IceCreamSvg state={state} showPlaceholder />
      <IceCreamMeta state={state} />
    </div>
  );
}

export function IceCreamSvg({ state, showPlaceholder = false }: { state: IceCreamState; showPlaceholder?: boolean }) {
  const { cone, scoops, toppings } = state;

  const cx = 200;
  const baseY = cone === 'cup' ? 240 : 220;
  const scoopRadius = 52;
  const scoopOverlap = 28;

  const scoopElements = scoops.map((flavorId, idx) => {
    const flavor = FLAVORS[flavorId] ?? FLAVORS.vanilla;
    const cy = baseY - idx * (scoopRadius * 2 - scoopOverlap);
    return (
      <g key={`scoop-${idx}`}>
        <circle cx={cx} cy={cy} r={scoopRadius} fill={flavor.color} stroke="#00000020" strokeWidth={1.5} />
        {/* Highlight */}
        <ellipse cx={cx - 18} cy={cy - 22} rx={14} ry={9} fill="#ffffff55" />
        {/* Speckles for stracciatella-like flavors */}
        {flavor.speckle && (
          <g fill={flavor.speckle}>
            <circle cx={cx - 22} cy={cy + 8} r={2.5} />
            <circle cx={cx + 12} cy={cy - 6} r={2} />
            <circle cx={cx + 22} cy={cy + 14} r={2.8} />
            <circle cx={cx - 8} cy={cy + 22} r={2} />
            <circle cx={cx + 4} cy={cy + 4} r={1.6} />
            <circle cx={cx - 30} cy={cy - 8} r={1.8} />
          </g>
        )}
        {/* Drips on the bottom-most scoop */}
        {idx === 0 && cone !== 'cup' && (
          <>
            <path
              d={`M ${cx - 38} ${cy + 8} Q ${cx - 42} ${cy + 28} ${cx - 36} ${cy + 36} Q ${cx - 30} ${cy + 28} ${cx - 28} ${cy + 8}`}
              fill={flavor.color}
              stroke="#00000020"
              strokeWidth={1}
            />
            <path
              d={`M ${cx + 28} ${cy + 12} Q ${cx + 34} ${cy + 32} ${cx + 40} ${cy + 24} Q ${cx + 38} ${cy + 16} ${cx + 36} ${cy + 8}`}
              fill={flavor.color}
              stroke="#00000020"
              strokeWidth={1}
            />
          </>
        )}
      </g>
    );
  });

  const topY = baseY - (scoops.length - 1) * (scoopRadius * 2 - scoopOverlap) - scoopRadius;

  return (
    <svg
      viewBox="0 0 400 520"
      className="ice-cream-svg"
      xmlns="http://www.w3.org/2000/svg"
    >
      <ellipse cx={cx} cy={490} rx={110} ry={14} fill="#00000015" />

      {cone === 'cone' && <Cone />}
      {cone === 'waffle-cup' && <WaffleCup />}
      {cone === 'cup' && <Cup />}

      {scoopElements}

      {scoops.length > 0 && (
        <Toppings cx={cx} topY={topY} toppings={toppings} />
      )}

      {showPlaceholder && scoops.length === 0 && (
        <text
          x={cx}
          y={180}
          textAnchor="middle"
          fontSize="18"
          fill="#94a3b8"
          fontFamily="IBM Plex Sans"
        >
          Demandez à AGO de composer votre glace…
        </text>
      )}
    </svg>
  );
}

function IceCreamMeta({ state }: { state: IceCreamState }) {
  const { cone, scoops, toppings } = state;
  return (
    <div className="ice-cream-meta">
      <Pill label={CONES[cone].name} tone="neutral" />
      {scoops.map((id, i) => (
        <Pill key={i} label={FLAVORS[id]?.name ?? id} tone="flavor" color={FLAVORS[id]?.color} />
      ))}
      {toppings.map((id, i) => (
        <Pill key={`t-${i}`} label={TOPPINGS[id]?.name ?? id} tone="topping" />
      ))}
    </div>
  );
}

function Pill({ label, tone, color }: { label: string; tone: 'neutral' | 'flavor' | 'topping'; color?: string }) {
  return (
    <span className={`pill pill--${tone}`}>
      {color && <span className="pill-dot" style={{ backgroundColor: color }} />}
      {label}
    </span>
  );
}

function Cone() {
  return (
    <g>
      {/* Triangle cone */}
      <polygon
        points="148,260 252,260 200,460"
        fill="#d99a55"
        stroke="#7a4d20"
        strokeWidth={1.5}
      />
      {/* Waffle pattern */}
      <g stroke="#7a4d20" strokeWidth={1} opacity={0.7}>
        <line x1="160" y1="280" x2="240" y2="280" />
        <line x1="166" y1="305" x2="234" y2="305" />
        <line x1="172" y1="330" x2="228" y2="330" />
        <line x1="178" y1="355" x2="222" y2="355" />
        <line x1="184" y1="380" x2="216" y2="380" />
        <line x1="190" y1="405" x2="210" y2="405" />
        <line x1="170" y1="270" x2="195" y2="450" />
        <line x1="200" y1="265" x2="200" y2="460" />
        <line x1="230" y1="270" x2="205" y2="450" />
      </g>
      {/* Top rim */}
      <ellipse cx="200" cy="260" rx="52" ry="9" fill="#c98648" stroke="#7a4d20" strokeWidth="1.5" />
    </g>
  );
}

function WaffleCup() {
  return (
    <g>
      <path
        d="M 140 270 L 260 270 L 248 440 Q 200 460 152 440 Z"
        fill="#d99a55"
        stroke="#7a4d20"
        strokeWidth={1.5}
      />
      <g stroke="#7a4d20" strokeWidth={0.8} opacity={0.7}>
        <line x1="150" y1="300" x2="250" y2="300" />
        <line x1="152" y1="330" x2="248" y2="330" />
        <line x1="154" y1="360" x2="246" y2="360" />
        <line x1="156" y1="390" x2="244" y2="390" />
        <line x1="170" y1="280" x2="160" y2="440" />
        <line x1="200" y1="280" x2="200" y2="450" />
        <line x1="230" y1="280" x2="240" y2="440" />
      </g>
      <ellipse cx="200" cy="270" rx="60" ry="10" fill="#c98648" stroke="#7a4d20" strokeWidth="1.5" />
    </g>
  );
}

function Cup() {
  return (
    <g>
      <path
        d="M 130 280 L 270 280 L 256 450 Q 200 470 144 450 Z"
        fill="#fafafa"
        stroke="#94a3b8"
        strokeWidth={1.5}
      />
      <ellipse cx="200" cy="280" rx="70" ry="11" fill="#ffffff" stroke="#94a3b8" strokeWidth="1.5" />
      <text
        x="200"
        y="380"
        textAnchor="middle"
        fontSize="18"
        fontFamily="Fraunces"
        fontWeight="600"
        fill="#03182f"
      >
        glacier
      </text>
    </g>
  );
}

function Toppings({ cx, topY, toppings }: { cx: number; topY: number; toppings: string[] }) {
  return (
    <g>
      {toppings.includes('chocolate-sauce') && (
        <path
          d={`M ${cx - 50} ${topY + 20} Q ${cx - 30} ${topY - 5} ${cx} ${topY + 10} Q ${cx + 30} ${topY + 25} ${cx + 50} ${topY + 5} L ${cx + 48} ${topY + 28} Q ${cx + 30} ${topY + 50} ${cx} ${topY + 35} Q ${cx - 30} ${topY + 22} ${cx - 52} ${topY + 42} Z`}
          fill="#3a1e0d"
          opacity={0.92}
        />
      )}
      {toppings.includes('caramel-sauce') && (
        <path
          d={`M ${cx - 48} ${topY + 28} Q ${cx - 25} ${topY + 5} ${cx + 5} ${topY + 18} Q ${cx + 30} ${topY + 30} ${cx + 50} ${topY + 12} L ${cx + 46} ${topY + 36} Q ${cx + 25} ${topY + 56} ${cx} ${topY + 42} Q ${cx - 25} ${topY + 30} ${cx - 50} ${topY + 50} Z`}
          fill="#c47a2a"
          opacity={0.85}
        />
      )}

      {toppings.includes('whipped-cream') && (
        <g>
          <circle cx={cx} cy={topY - 18} r={20} fill="#fff8f0" stroke="#e0d0b8" strokeWidth={1} />
          <circle cx={cx - 14} cy={topY - 8} r={14} fill="#fff8f0" stroke="#e0d0b8" strokeWidth={1} />
          <circle cx={cx + 14} cy={topY - 8} r={14} fill="#fff8f0" stroke="#e0d0b8" strokeWidth={1} />
          <circle cx={cx} cy={topY - 35} r={12} fill="#fffaf2" stroke="#e0d0b8" strokeWidth={1} />
        </g>
      )}

      {toppings.includes('cherry') && (
        <g>
          <circle cx={cx} cy={topY - 50} r={10} fill="#d7263d" stroke="#7a1023" strokeWidth={1} />
          <ellipse cx={cx - 3} cy={topY - 53} rx={3} ry={2} fill="#ff8a9a" />
          <path d={`M ${cx} ${topY - 60} Q ${cx + 6} ${topY - 78} ${cx + 12} ${topY - 75}`} fill="none" stroke="#3a6b1a" strokeWidth={2} strokeLinecap="round" />
          <ellipse cx={cx + 13} cy={topY - 76} rx={4} ry={2.5} fill="#5a8a2a" transform={`rotate(30 ${cx + 13} ${topY - 76})`} />
        </g>
      )}

      {toppings.includes('sprinkles') && (
        <g>
          {SPRINKLE_POSITIONS.map((p, i) => (
            <rect
              key={i}
              x={cx + p.dx - 1.5}
              y={topY + p.dy}
              width={3}
              height={7}
              rx={1.5}
              fill={p.color}
              transform={`rotate(${p.r} ${cx + p.dx} ${topY + p.dy + 3.5})`}
            />
          ))}
        </g>
      )}

      {toppings.includes('nuts') && (
        <g fill="#a06030" stroke="#5a3010" strokeWidth={0.5}>
          <ellipse cx={cx - 28} cy={topY + 8} rx={5} ry={3.5} transform={`rotate(20 ${cx - 28} ${topY + 8})`} />
          <ellipse cx={cx - 8} cy={topY - 4} rx={5} ry={3.5} transform={`rotate(-15 ${cx - 8} ${topY - 4})`} />
          <ellipse cx={cx + 16} cy={topY + 4} rx={5} ry={3.5} transform={`rotate(40 ${cx + 16} ${topY + 4})`} />
          <ellipse cx={cx + 30} cy={topY - 6} rx={5} ry={3.5} transform={`rotate(-30 ${cx + 30} ${topY - 6})`} />
          <ellipse cx={cx - 18} cy={topY + 18} rx={5} ry={3.5} transform={`rotate(60 ${cx - 18} ${topY + 18})`} />
          <ellipse cx={cx + 6} cy={topY + 14} rx={5} ry={3.5} transform={`rotate(-50 ${cx + 6} ${topY + 14})`} />
        </g>
      )}
    </g>
  );
}

const SPRINKLE_POSITIONS = [
  { dx: -34, dy: 4, r: 25, color: '#ff5e8a' },
  { dx: -22, dy: -8, r: -40, color: '#3aa6ff' },
  { dx: -10, dy: 8, r: 60, color: '#ffd13a' },
  { dx: 4, dy: -10, r: -20, color: '#5ed46b' },
  { dx: 18, dy: 6, r: 40, color: '#a060ff' },
  { dx: 30, dy: -4, r: -55, color: '#ff8a3a' },
  { dx: -28, dy: 18, r: 10, color: '#5ed46b' },
  { dx: 14, dy: 18, r: -30, color: '#ff5e8a' },
  { dx: -4, dy: 22, r: 70, color: '#3aa6ff' },
  { dx: 26, dy: 16, r: -15, color: '#ffd13a' },
];
