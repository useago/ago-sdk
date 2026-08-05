import { Allergen, CONES, FLAVORS, TOPPINGS } from './flavors';
import { Badge, Card, Eyebrow, SectionHeading } from './ui';

const ALLERGEN_ICONS: Record<Allergen, string> = {
  'lait': '🥛',
  'œufs': '🥚',
  'fruits à coque': '🌰',
  'arachides': '🥜',
  'gluten': '🌾',
  'soja': '🫘',
  'sulfites': '🧪',
};

function AllergenBadges({ allergens }: { allergens: Allergen[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: 'auto' }}>
      {allergens.length === 0 ? (
        <Badge tone="safe">Sans allergène déclaré</Badge>
      ) : (
        allergens.map((a) => (
          <Badge key={a} tone="allergen">
            <span aria-hidden>{ALLERGEN_ICONS[a]}</span>
            {a}
          </Badge>
        ))
      )}
    </div>
  );
}

interface Item {
  id: string;
  name: string;
  description: string;
  allergens: Allergen[];
  color?: string;
  speckle?: string;
  imageSrc: string;
  imageAlt: string;
}

function IngredientCard({ item }: { item: Item }) {
  return (
    <Card padded={false} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="gl-ingredient-card-media" style={{ aspectRatio: '16 / 9', overflow: 'hidden' }}>
        <img
          src={item.imageSrc}
          alt={item.imageAlt}
          loading="lazy"
          decoding="async"
          className="gl-ingredient-card-image"
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '18px 20px 20px', flex: 1 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h3
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '22px',
              fontWeight: 600,
              lineHeight: 1.1,
              color: 'var(--text-strong)',
              margin: 0,
            }}
          >
            {item.name}
          </h3>
        </header>
        <p style={{ fontSize: '13.5px', lineHeight: 1.6, color: 'var(--text-muted)', flex: 1 }}>{item.description}</p>
        <AllergenBadges allergens={item.allergens} />
      </div>
    </Card>
  );
}

function Group({ title, items }: { title: string; items: Item[] }) {
  return (
    <section>
      <Eyebrow style={{ marginBottom: '18px' }}>{title}</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '18px' }}>
        {items.map((item) => (
          <IngredientCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

export function IngredientsContent() {
  const flavors = Object.values(FLAVORS);
  const toppings = Object.values(TOPPINGS);
  const cones = Object.entries(CONES).map(([id, c]) => ({ id, ...c }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '48px' }}>
      <SectionHeading
        eyebrow="Transparence"
        title="Ingrédients & allergènes"
        lede="Tout ce qui entre dans un bac, et ce qu'il contient. Dites-nous votre allergie : l'assistant filtre la carte pour vous."
      />

      <div
        style={{
          background: 'var(--warn-soft)',
          border: '1px solid var(--warn-border)',
          borderRadius: 'var(--r-lg)',
          padding: '18px 22px',
          fontSize: '14px',
          lineHeight: 1.6,
          color: 'var(--warn)',
        }}
      >
        <strong style={{ fontWeight: 600 }}>À noter :</strong> notre laboratoire manipule du lait, des œufs, des fruits
        à coque, du gluten et du soja. Des traces sont possibles dans tous les produits. Demandez-nous en cas de doute.
      </div>

      <Group title="Parfums" items={flavors} />
      <Group title="Toppings" items={toppings} />
      <Group title="Contenants" items={cones} />
    </div>
  );
}
