import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ChatWidget, useAgoClient, useAgoFunction, useAgoNavigation } from '@useago/sdk/react';
import { initDevPanel } from '@useago/sdk/devtools';
import IceCream, { IceCreamSvg, IceCreamState } from './IceCream';
import {
  buildIceCreamFunctions,
  CartItem,
  computeCartTotal,
  computePrice,
} from './functions';
import { CONES, FLAVORS, TOPPINGS } from './flavors';
import { IngredientsContent } from './IngredientsPage';
import { OriginsIndex, OriginDetail } from './OriginsPage';
import { ORIGINS } from './origins';

const INITIAL_CURRENT: IceCreamState = {
  cone: 'cone',
  scoops: [],
  toppings: [],
};

// Les routes sont définies une seule fois ici. Le router (<Routes>) et la
// navigation de l'agent (useAgoNavigation) lisent tous les deux le chemin et la
// description sur cet objet — React Router ne permet pas de porter une
// description sur <Route> directement.
const ROUTES = {
  shop: {
    name: 'shop',
    path: '/',
    description:
      'Boutique : écran principal pour composer une glace, ajouter des boules, des toppings, gérer le panier et passer commande.',
  },
  ingredients: {
    name: 'ingredients',
    path: '/ingredients',
    description:
      "Page Ingrédients & allergènes : liste complète des parfums, toppings et contenants avec leurs allergènes (lait, œufs, fruits à coque, arachides, gluten, soja, sulfites). À ouvrir dès qu'un client évoque une allergie, un régime alimentaire, ou demande la composition.",
  },
  origins: {
    name: 'origins',
    path: '/origines',
    description:
      "Page Origines des ingrédients : index des terroirs et producteurs (vanille de Tahiti, pistache de Bronte, citron de Menton, mangue Alphonso, noisette du Piémont, cacao d'Équateur, fraise Gariguette, café Sidamo). À ouvrir si le client demande d'où viennent les ingrédients.",
  },
} as const;

// Route de détail (rendu seulement) : l'agent atteint une origine précise via
// les entrées dérivées de ORIGINS, pas via le chemin paramétré `:id`.
const ORIGIN_DETAIL_PATH = '/origines/:id';

export default function App() {
  const [current, setCurrent] = useState<IceCreamState>(INITIAL_CURRENT);
  const [cart, setCart] = useState<CartItem[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const client = useAgoClient();

  // Dev panel: lists the registered functions, shows the live context snapshot,
  // and logs every function the agent calls. Open the app with ?dev to enable it.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('dev')) {
      initDevPanel({ client });
    }
  }, [client]);

  const currentRef = useRef(current);
  currentRef.current = current;
  const cartRef = useRef(cart);
  cartRef.current = cart;

  // Expose the live order state as dynamic context. It is re-evaluated on every
  // snapshot, so the dev panel's JSON pane shows it (and the agent receives it
  // with every message instead of having to call getState).
  useEffect(() => {
    client.addDynamicContext('order', () => {
      const cur = currentRef.current;
      const items = cartRef.current;
      return {
        name: 'Commande',
        description: 'Glace en cours de composition, panier et totaux (euros).',
        data: {
          current: cur,
          cart: items,
          currentPriceEuros: computePrice(cur),
          cartTotalEuros: computeCartTotal(items),
        },
      };
    });
    return () => {
      client.removeDynamicContext('order');
    };
  }, [client]);

  const fns = useMemo(
    () =>
      buildIceCreamFunctions({
        get: () => ({ current: currentRef.current, cart: cartRef.current }),
        // Update the ref synchronously, then mirror into React state. The agent
        // often fires several functions in the same tick (e.g. setCone +
        // updateScoops); without the immediate ref write each handler reads the
        // same stale value and the later setCurrent clobbers the earlier one.
        setCurrent: (next) => {
          currentRef.current = next;
          setCurrent(next);
        },
        setCart: (next) => {
          cartRef.current = next;
          setCart(next);
        },
      }),
    [],
  );

  useAgoFunction(fns.setCone.name, fns.setCone);
  useAgoFunction(fns.updateScoops.name, fns.updateScoops);
  useAgoFunction(fns.updateToppings.name, fns.updateToppings);
  useAgoFunction(fns.resetCurrent.name, fns.resetCurrent);
  useAgoFunction(fns.addToCart.name, fns.addToCart);
  useAgoFunction(fns.updateCart.name, fns.updateCart);
  useAgoFunction(fns.getState.name, fns.getState);
  useAgoFunction(fns.placeOrder.name, fns.placeOrder);

  const originRoutes = useMemo(
    () =>
      Object.values(ORIGINS).map((o) => ({
        name: `origin-${o.id}`,
        path: `/origines/${o.id}`,
        description: `${o.ingredient} de ${o.terroir} (${o.country}). ${o.tagline}`,
      })),
    [],
  );

  useAgoNavigation(navigate, [...Object.values(ROUTES), ...originRoutes]);

  const currentPrice = computePrice(current);
  const cartTotal = computeCartTotal(cart);
  const grandTotal = Math.round((cartTotal + currentPrice) * 100) / 100;

  const isShop = location.pathname === ROUTES.shop.path;

  return (
    <div className="glacerie-shell">
      <AppHeader isShop={isShop} cart={cart} current={current} grandTotal={grandTotal} />

      <main className="glacerie-main">
        <aside className="glacerie-chat">
          <ChatWidget
            title="Glacière AGO"
            welcomeMessage="Bonjour ! Je suis votre glacier. Quelle glace vous tente aujourd'hui ? Je peux composer plusieurs glaces, les ajouter au panier, ou vous renseigner sur les ingrédients, les allergènes et l'origine de nos produits — dites-moi si vous avez une allergie ou si vous voulez en savoir plus sur la vanille de Tahiti."
            placeholder="Ex. : 2 boules pistache et chocolat avec chantilly…"
            height="100%"
            allowFiles={false}
          />
        </aside>

        <section className="glacerie-stage">
          <Routes>
            <Route
              path={ROUTES.shop.path}
              element={
                <>
                  <CartStrip cart={cart} />
                  <IceCream state={current} />
                  <Recap
                    current={current}
                    currentPrice={currentPrice}
                    cart={cart}
                    cartTotal={cartTotal}
                    grandTotal={grandTotal}
                  />
                </>
              }
            />
            <Route path={ROUTES.ingredients.path} element={<IngredientsContent />} />
            <Route path={ROUTES.origins.path} element={<OriginsIndex />} />
            <Route path={ORIGIN_DETAIL_PATH} element={<OriginDetail />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </section>
      </main>
    </div>
  );
}

function AppHeader({
  isShop,
  cart,
  current,
  grandTotal,
}: {
  isShop: boolean;
  cart: CartItem[];
  current: IceCreamState;
  grandTotal: number;
}) {
  if (isShop) {
    return (
      <header className="glacerie-header">
        <div className="glacerie-brand">
          <span className="glacerie-logo">🍦</span>
          <div>
            <h1>La Glacerie AGO</h1>
            <p className="glacerie-tagline">Composez vos glaces avec l'assistant — ajoutez-en plusieurs au panier.</p>
          </div>
        </div>
        <div className="glacerie-header-right">
          <Link to={ROUTES.origins.path} className="nav-button">Origines</Link>
          <Link to={ROUTES.ingredients.path} className="nav-button">Ingrédients & allergènes</Link>
          <div className="glacerie-price">
            <span className="glacerie-price-label">
              Total {cart.length > 0 ? `(${cart.length} au panier${current.scoops.length > 0 ? ' + en cours' : ''})` : ''}
            </span>
            <span className="glacerie-price-value">{grandTotal.toFixed(2)} €</span>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="glacerie-header">
      <div className="glacerie-brand">
        <span className="glacerie-logo">🧾</span>
        <div>
          <h1>La Glacerie AGO</h1>
          <p className="glacerie-tagline">Explorez nos ingrédients, allergènes et origines.</p>
        </div>
      </div>
      <div className="glacerie-header-right">
        <Link to={ROUTES.ingredients.path} className="nav-button">Ingrédients</Link>
        <Link to={ROUTES.origins.path} className="nav-button">Origines</Link>
        <Link to={ROUTES.shop.path} className="nav-button nav-button--primary">← Retour à la boutique</Link>
      </div>
    </header>
  );
}

function NotFound() {
  return (
    <div className="origins-main">
      <section className="origins-intro">
        <h2>Page introuvable</h2>
        <p>
          Cette page n'existe pas. <Link to={ROUTES.shop.path}>Retour à la boutique</Link>.
        </p>
      </section>
    </div>
  );
}

function Recap({
  current,
  currentPrice,
  cart,
  cartTotal,
  grandTotal,
}: {
  current: IceCreamState;
  currentPrice: number;
  cart: CartItem[];
  cartTotal: number;
  grandTotal: number;
}) {
  return (
    <div className="recap-card">
      <h2>Votre commande</h2>

      <div className="recap-section">
        <div className="recap-section-title">
          <span>Panier</span>
          <span className="recap-section-meta">
            {cart.length === 0 ? 'vide' : `${cart.length} glace${cart.length > 1 ? 's' : ''}`}
          </span>
        </div>
        {cart.length === 0 ? (
          <p className="recap-empty">Aucune glace ajoutée. Composez-en une, puis dites « ajoute au panier ».</p>
        ) : (
          <ul className="cart-list">
            {cart.map((item, i) => (
              <li key={item.id} className="cart-item">
                <span className="cart-item-pos">{i + 1}</span>
                <div className="cart-item-body">
                  <div className="cart-item-title">
                    {item.scoops.length > 0
                      ? item.scoops.map((id) => FLAVORS[id]?.name ?? id).join(' + ')
                      : '—'}
                  </div>
                  <div className="cart-item-sub">
                    {CONES[item.cone].name}
                    {item.toppings.length > 0 && ' · ' + item.toppings.map((id) => TOPPINGS[id]?.name ?? id).join(', ')}
                  </div>
                </div>
                <span className="cart-item-price">{computePrice(item).toFixed(2)} €</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="recap-section">
        <div className="recap-section-title">
          <span>En cours de composition</span>
          <span className="recap-section-meta">{currentPrice.toFixed(2)} €</span>
        </div>
        <ul className="recap-list">
          <li>
            <span className="recap-label">Contenant</span>
            <span className="recap-value">{CONES[current.cone].name}</span>
          </li>
          <li>
            <span className="recap-label">Boules ({current.scoops.length})</span>
            <span className="recap-value">
              {current.scoops.length === 0
                ? '—'
                : current.scoops.map((id) => FLAVORS[id]?.name ?? id).join(', ')}
            </span>
          </li>
          <li>
            <span className="recap-label">Toppings</span>
            <span className="recap-value">
              {current.toppings.length === 0
                ? '—'
                : current.toppings.map((id) => TOPPINGS[id]?.name ?? id).join(', ')}
            </span>
          </li>
        </ul>
      </div>

      <div className="recap-total">
        <span>Total</span>
        <span>{grandTotal.toFixed(2)} €</span>
      </div>
      {cart.length > 0 && (
        <div className="recap-subtotal">
          <span>Panier</span>
          <span>{cartTotal.toFixed(2)} €</span>
        </div>
      )}
    </div>
  );
}

function CartStrip({ cart }: { cart: CartItem[] }) {
  if (cart.length === 0) return null;
  return (
    <div className="cart-strip">
      <div className="cart-strip-label">Panier ({cart.length})</div>
      <div className="cart-strip-row">
        {cart.map((item, i) => (
          <div key={item.id} className="cart-strip-item" title={`Glace ${i + 1}`}>
            <div className="cart-strip-svg">
              <IceCreamSvg state={item} />
            </div>
            <div className="cart-strip-num">{i + 1}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
