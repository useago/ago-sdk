import { Link, useParams } from 'react-router-dom';
import { ORIGINS } from './origins';
import { FLAVORS, TOPPINGS } from './flavors';

export function OriginsIndex() {
  const origins = Object.values(ORIGINS);
  return (
    <div className="origins-main">
      <section className="origins-intro">
        <h2>D'où viennent nos ingrédients ?</h2>
        <p>
          Chaque parfum part d'un producteur, d'un terroir, d'une saison. Cliquez sur une carte pour
          lire l'histoire complète — ou demandez à l'assistant : « parle-moi de la vanille de Tahiti ».
        </p>
      </section>

      <div className="origin-grid">
        {origins.map((o) => (
          <Link key={o.id} to={`/origines/${o.id}`} className="origin-card" style={{ borderColor: o.accent }}>
            <div className="origin-card-emoji" aria-hidden style={{ background: o.accent }}>
              {o.emoji}
            </div>
            <div className="origin-card-body">
              <div className="origin-card-meta">{o.country}</div>
              <h3>{o.ingredient}</h3>
              <p className="origin-card-terroir">{o.terroir}</p>
              <p className="origin-card-tagline">{o.tagline}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function OriginDetail() {
  const { id } = useParams<{ id: string }>();
  const origin = id ? ORIGINS[id] : undefined;

  if (!origin) {
    return (
      <div className="origins-main">
        <section className="origins-intro">
          <h2>Origine introuvable</h2>
          <p>
            Cette origine n'existe pas (ou plus). <Link to="/origines">Retour à la liste</Link>.
          </p>
        </section>
      </div>
    );
  }

  const relatedFlavor = origin.relatedFlavorId ? FLAVORS[origin.relatedFlavorId] : undefined;
  const relatedTopping = origin.relatedToppingId ? TOPPINGS[origin.relatedToppingId] : undefined;

  return (
    <div className="origins-main">
      <Link to="/origines" className="origin-back">← Toutes les origines</Link>

      <article className="origin-detail">
        <header
          className="origin-detail-header"
          style={{ background: `linear-gradient(135deg, ${origin.accent} 0%, #fffaf2 100%)` }}
        >
          <div className="origin-detail-emoji" aria-hidden>{origin.emoji}</div>
          <div>
            <div className="origin-detail-country">{origin.country} · {origin.terroir}</div>
            <h2>{origin.ingredient}</h2>
            <p className="origin-detail-tagline">{origin.tagline}</p>
          </div>
        </header>

        <section className="origin-detail-story">
          <p>{origin.story}</p>
        </section>

        <section className="origin-detail-notes">
          <h3>Notre sourcing</h3>
          <ul>
            {origin.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>

        {(relatedFlavor || relatedTopping) && (
          <section className="origin-detail-link">
            <h3>On le retrouve dans</h3>
            {relatedFlavor && (
              <div className="origin-related">
                <span className="ingredient-swatch" style={{ background: relatedFlavor.color }} aria-hidden />
                <div>
                  <div className="origin-related-name">{relatedFlavor.name}</div>
                  <div className="origin-related-desc">{relatedFlavor.description}</div>
                </div>
              </div>
            )}
            {relatedTopping && (
              <div className="origin-related">
                <span className="ingredient-swatch" style={{ background: '#c89a6b' }} aria-hidden />
                <div>
                  <div className="origin-related-name">{relatedTopping.name}</div>
                  <div className="origin-related-desc">{relatedTopping.description}</div>
                </div>
              </div>
            )}
          </section>
        )}
      </article>
    </div>
  );
}
