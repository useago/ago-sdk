import { Allergen, CONES, FLAVORS, TOPPINGS } from './flavors';

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
  if (allergens.length === 0) {
    return <span className="allergen-none">Sans allergène déclaré</span>;
  }
  return (
    <ul className="allergen-list">
      {allergens.map((a) => (
        <li key={a} className="allergen-badge" title={`Allergène : ${a}`}>
          <span className="allergen-icon" aria-hidden>{ALLERGEN_ICONS[a]}</span>
          <span className="allergen-name">{a}</span>
        </li>
      ))}
    </ul>
  );
}

interface Item {
  id: string;
  name: string;
  description: string;
  allergens: Allergen[];
  color?: string;
}

function IngredientCard({ item }: { item: Item }) {
  return (
    <article className="ingredient-card">
      <header className="ingredient-card-header">
        {item.color && (
          <span
            className="ingredient-swatch"
            style={{ background: item.color }}
            aria-hidden
          />
        )}
        <h3>{item.name}</h3>
      </header>
      <p className="ingredient-desc">{item.description}</p>
      <AllergenBadges allergens={item.allergens} />
    </article>
  );
}

export function IngredientsContent() {
  const flavors = Object.values(FLAVORS);
  const toppings = Object.values(TOPPINGS);
  const cones = Object.entries(CONES).map(([id, c]) => ({ id, ...c }));

  return (
    <div className="ingredients-main">
      <section className="ingredients-section ingredients-warning">
        <strong>À noter :</strong> notre laboratoire manipule du lait, des œufs,
        des fruits à coque, du gluten et du soja. Des traces sont possibles
        dans tous les produits. Demandez-nous en cas de doute.
      </section>

      <section className="ingredients-section">
        <h2>Parfums</h2>
        <div className="ingredient-grid">
          {flavors.map((f) => (
            <IngredientCard key={f.id} item={f} />
          ))}
        </div>
      </section>

      <section className="ingredients-section">
        <h2>Toppings</h2>
        <div className="ingredient-grid">
          {toppings.map((t) => (
            <IngredientCard key={t.id} item={t} />
          ))}
        </div>
      </section>

      <section className="ingredients-section">
        <h2>Contenants</h2>
        <div className="ingredient-grid">
          {cones.map((c) => (
            <IngredientCard key={c.id} item={c} />
          ))}
        </div>
      </section>
    </div>
  );
}
