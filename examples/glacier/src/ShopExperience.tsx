import { Link } from 'react-router-dom';
import { computePrice, type CartItem } from './functions';
import { CONES, FLAVORS, TOPPINGS } from './flavors';
import type { IceCreamState } from './IceCream';
import { PriceTag } from './ui';

const FEATURED_FLAVOR_IDS = ['pistachio', 'vanilla', 'raspberry', 'lemon'] as const;

interface ShopExperienceProps {
  current: IceCreamState;
  currentPrice: number;
  cart: CartItem[];
  cartTotal: number;
  grandTotal: number;
  onAddCurrent: () => void;
  onRemoveCartItem: (id: string) => void;
  onClearCart: () => void;
  onFocusChat: () => void;
}

export function ShopExperience({
  current,
  currentPrice,
  cart,
  cartTotal,
  grandTotal,
  onAddCurrent,
  onRemoveCartItem,
  onClearCart,
  onFocusChat,
}: ShopExperienceProps) {
  return (
    <div className="gl-shop-experience">
      <section className="gl-shop-intro">
        <div>
          <span className="gl-shop-kicker">Atelier de composition · Lyon</span>
          <h1>
            Une glace,
            <em> à votre mesure.</em>
          </h1>
        </div>
        <p>
          Décrivez une envie au glacier. Chaque choix apparaît ici, du premier parfum jusqu’au dernier éclat.
        </p>
      </section>

      <div className="gl-shop-workspace">
        <div className="gl-shop-canvas-column">
          <CreationStudio state={current} price={currentPrice} onFocusChat={onFocusChat} />
          <FlavorPalette />
        </div>

        <OrderCart
          current={current}
          currentPrice={currentPrice}
          cart={cart}
          cartTotal={cartTotal}
          grandTotal={grandTotal}
          onAddCurrent={onAddCurrent}
          onRemoveCartItem={onRemoveCartItem}
          onClearCart={onClearCart}
          onFocusChat={onFocusChat}
        />
      </div>
    </div>
  );
}

function CreationStudio({
  state,
  price,
  onFocusChat,
}: {
  state: IceCreamState;
  price: number;
  onFocusChat: () => void;
}) {
  const hasScoops = state.scoops.length > 0;
  const topFlavor = hasScoops ? FLAVORS[state.scoops[state.scoops.length - 1]] : undefined;
  const title = hasScoops
    ? state.scoops.map((id) => FLAVORS[id]?.name ?? id).join(' · ')
    : 'À vous de composer.';

  return (
    <section className="gl-creation-studio" aria-labelledby="creation-title">
      <header className="gl-creation-header">
        <div>
          <span className="gl-shop-kicker">Création en cours</span>
          <h2 id="creation-title">{title}</h2>
        </div>
        <PriceTag amount={price} size="lg" />
      </header>

      {hasScoops && topFlavor ? (
        <div className="gl-creation-active">
          <img
            src={topFlavor.imageSrc}
            alt={topFlavor.imageAlt}
            className="gl-creation-hero-image"
            decoding="async"
          />
          <div className="gl-creation-image-wash" aria-hidden />
          <div className="gl-creation-caption">
            <span>Dernière boule</span>
            <strong>{topFlavor.name}</strong>
            <small>
              {state.scoops.length} boule{state.scoops.length > 1 ? 's' : ''} · {CONES[state.cone].name}
            </small>
          </div>
          <img
            src={CONES[state.cone].imageSrc}
            alt={CONES[state.cone].imageAlt}
            className="gl-creation-container-image"
            decoding="async"
          />
        </div>
      ) : (
        <button type="button" className="gl-creation-empty" onClick={onFocusChat}>
          <span className="gl-creation-mosaic" aria-hidden>
            {FEATURED_FLAVOR_IDS.map((id) => (
              <img key={id} src={FLAVORS[id].imageSrc} alt="" />
            ))}
          </span>
          <span className="gl-creation-image-wash" aria-hidden />
          <span className="gl-creation-empty-copy">
            <small>Le glacier vous écoute</small>
            <strong>« Deux boules pistache et chocolat, en cornet. »</strong>
            <em>Commencer dans le chat →</em>
          </span>
        </button>
      )}

      <CompositionLedger state={state} />
    </section>
  );
}

function CompositionLedger({ state }: { state: IceCreamState }) {
  const ingredients = [
    {
      key: `cone-${state.cone}`,
      label: 'Contenant',
      name: CONES[state.cone].name,
      imageSrc: CONES[state.cone].imageSrc,
    },
    ...state.scoops.map((id, index) => ({
      key: `scoop-${index}-${id}`,
      label: `Boule ${index + 1}`,
      name: FLAVORS[id]?.name ?? id,
      imageSrc: FLAVORS[id]?.imageSrc,
    })),
    ...state.toppings.map((id) => ({
      key: `topping-${id}`,
      label: 'Finition',
      name: TOPPINGS[id]?.name ?? id,
      imageSrc: TOPPINGS[id]?.imageSrc,
    })),
  ];

  return (
    <div className="gl-composition-ledger" aria-label="Détail de la création">
      {ingredients.map((ingredient) => (
        <div className="gl-composition-token" key={ingredient.key}>
          <img src={ingredient.imageSrc} alt="" loading="lazy" decoding="async" />
          <span>
            <small>{ingredient.label}</small>
            <strong>{ingredient.name}</strong>
          </span>
        </div>
      ))}
      {state.scoops.length === 0 && (
        <p className="gl-composition-hint">Les parfums et finitions viendront compléter ce rail.</p>
      )}
    </div>
  );
}

function FlavorPalette() {
  return (
    <section className="gl-flavor-palette" aria-labelledby="palette-title">
      <div className="gl-palette-heading">
        <div>
          <span className="gl-shop-kicker">La sélection du jour</span>
          <h2 id="palette-title">Quatre façons de commencer</h2>
        </div>
        <Link to="/parfums">Voir les dix parfums</Link>
      </div>
      <div className="gl-palette-grid">
        {FEATURED_FLAVOR_IDS.map((id) => {
          const flavor = FLAVORS[id];
          return (
            <Link to="/parfums" className="gl-palette-card" key={id}>
              <img src={flavor.imageSrc} alt="" loading="lazy" decoding="async" />
              <span>{flavor.name}</span>
              <small>{flavor.pricePerScoop.toFixed(2).replace('.', ',')} €</small>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function OrderCart({
  current,
  currentPrice,
  cart,
  cartTotal,
  grandTotal,
  onAddCurrent,
  onRemoveCartItem,
  onClearCart,
  onFocusChat,
}: Omit<ShopExperienceProps, 'onClearCart'> & { onClearCart: () => void }) {
  const hasCurrent = current.scoops.length > 0;
  const orderCount = cart.length + (hasCurrent ? 1 : 0);

  return (
    <aside className="gl-order-cart" aria-labelledby="order-cart-title">
      <header className="gl-order-cart-header">
        <div>
          <span>Ticket de commande</span>
          <h2 id="order-cart-title">Votre panier</h2>
        </div>
        <strong>{orderCount.toString().padStart(2, '0')}</strong>
      </header>

      <div className="gl-order-cart-body">
        {hasCurrent ? (
          <CurrentTicketItem state={current} price={currentPrice} />
        ) : cart.length > 0 ? (
          <div className="gl-ticket-next">
            <div>
              <span>Nouvelle création</span>
              <strong>Ajouter une autre glace</strong>
            </div>
            <button type="button" onClick={onFocusChat}>Composer</button>
          </div>
        ) : (
          <div className="gl-ticket-empty">
            <div className="gl-ticket-empty-images" aria-hidden>
              {FEATURED_FLAVOR_IDS.slice(0, 3).map((id) => (
                <img key={id} src={FLAVORS[id].imageSrc} alt="" />
              ))}
            </div>
            <span>Le ticket est encore vierge.</span>
            <p>Votre création apparaîtra ici pendant que vous échangez avec le glacier.</p>
          </div>
        )}

        {cart.length > 0 && (
          <section className="gl-saved-order" aria-labelledby="saved-order-title">
            <div className="gl-saved-order-heading">
              <h3 id="saved-order-title">Ajouté au panier</h3>
              <button type="button" onClick={onClearCart}>Tout retirer</button>
            </div>
            <ul>
              {cart.map((item, index) => (
                <SavedTicketItem
                  key={item.id}
                  item={item}
                  index={index}
                  onRemove={() => onRemoveCartItem(item.id)}
                />
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="gl-order-cart-footer">
        <div className="gl-order-total-detail">
          <span>Panier enregistré</span>
          <span>{cartTotal.toFixed(2).replace('.', ',')} €</span>
        </div>
        <div className="gl-order-total">
          <span>Total provisoire</span>
          <PriceTag amount={grandTotal} size="lg" />
        </div>
        <button
          type="button"
          className="gl-ticket-primary"
          disabled={!hasCurrent}
          onClick={onAddCurrent}
        >
          {hasCurrent ? 'Ajouter cette glace' : 'Choisissez un parfum'}
        </button>
        <button
          type="button"
          className="gl-ticket-secondary"
          disabled={grandTotal === 0}
          onClick={onFocusChat}
        >
          Finaliser avec le glacier
        </button>
      </footer>
    </aside>
  );
}

function CurrentTicketItem({ state, price }: { state: IceCreamState; price: number }) {
  return (
    <section className="gl-current-ticket" aria-label="Glace en préparation">
      <div className="gl-current-ticket-label">
        <span>En préparation</span>
        <PriceTag amount={price} size="sm" />
      </div>
      <h3>{state.scoops.map((id) => FLAVORS[id]?.name ?? id).join(' · ')}</h3>
      <TicketCompositionStrip state={state} />
    </section>
  );
}

function SavedTicketItem({ item, index, onRemove }: { item: CartItem; index: number; onRemove: () => void }) {
  const price = computePrice(item);

  return (
    <li className="gl-saved-ticket-item">
      <div className="gl-saved-ticket-summary">
        <div>
          <small>Glace {index + 1}</small>
          <strong>{item.scoops.map((id) => FLAVORS[id]?.name ?? id).join(' · ')}</strong>
        </div>
        <div className="gl-saved-ticket-actions">
          <span>{price.toFixed(2).replace('.', ',')} €</span>
          <button type="button" onClick={onRemove} aria-label={`Retirer la glace ${index + 1}`}>
            ×
          </button>
        </div>
      </div>
      <TicketCompositionStrip state={item} />
    </li>
  );
}

function TicketCompositionStrip({ state }: { state: IceCreamState }) {
  const parts = [
    {
      key: `container-${state.cone}`,
      label: 'Contenant',
      name: CONES[state.cone].name,
      imageSrc: CONES[state.cone].imageSrc,
    },
    ...state.scoops.map((id, index) => ({
      key: `flavor-${index}-${id}`,
      label: state.scoops.length > 1 ? `Boule ${index + 1}` : 'Parfum',
      name: FLAVORS[id]?.name ?? id,
      imageSrc: FLAVORS[id]?.imageSrc,
    })),
    ...state.toppings.map((id, index) => ({
      key: `topping-${index}-${id}`,
      label: 'Topping',
      name: TOPPINGS[id]?.name ?? id,
      imageSrc: TOPPINGS[id]?.imageSrc,
    })),
  ];

  return (
    <div className="gl-ticket-composition" aria-label="Composition détaillée">
      {parts.map((part) => (
        <div className="gl-ticket-part" key={part.key}>
          <img src={part.imageSrc} alt="" loading="lazy" decoding="async" />
          <span>
            <small>{part.label}</small>
            <strong title={part.name}>{part.name}</strong>
          </span>
        </div>
      ))}
    </div>
  );
}
