import { useEffect, useMemo, useRef, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  ChatWidget,
  useAgoAutoContinueAfterNavigation,
  useAgoClient,
  useAgoFunction,
  useAgoNavigation,
  useAgoPageState,
  type AgoStateControl,
} from '@useago/sdk/react';
import { initDevPanel } from '@useago/sdk/devtools';
import FlavorsPage from './FlavorsPage';
import {
  buildIceCreamControls,
  buildIceCreamFunctions,
  computeCartTotal,
  computePrice,
  lookupWikipediaArticle,
  type CartItem,
  type IceCreamState,
  type OrderStore,
} from './functions';
import { IngredientsContent } from './IngredientsPage';
import { OriginsIndex, OriginDetail } from './OriginsPage';
import { ORIGINS } from './origins';
import { AnnounceBar, BoutiqueFooter, BoutiqueHeader } from './Chrome';
import { ShopExperience } from './ShopExperience';
import { ButtonLink, SectionHeading } from './ui';

const INITIAL_CURRENT: IceCreamState = {
  cone: 'cone',
  scoops: [],
  toppings: [],
};

// Les routes exposées à l'agent sont définies ici. Le router (<Routes>) et la
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
  flavors: {
    name: 'flavors',
    path: '/parfums',
    description:
      "Page Parfums : liste filtrable/triable des parfums. À ouvrir si le client veut parcourir, filtrer (sans lactose, sans fruits à coque, sans gluten) ou trier les parfums. Une fois sur cette page, ses filtres/tri/affichage sont modifiables via setPageState.",
  },
} as const;

// Route de détail paramétrée : une seule entrée couvre toutes les fiches.
// `:id` devient un argument `id` de navigateToPage, que l'agent passe au
// premier niveau ({ page: "originDetail", id: "vanille-tahiti" }). Comme il
// choisit une origine par son sens ("d'où vient la vanille ?"), les ids valides
// vivent dans la description, dérivés des données pour rester en phase.
const ORIGIN_DETAIL_PATH = '/origines/:id';
const ORIGIN_DETAIL_ROUTE = {
  name: 'originDetail',
  path: ORIGIN_DETAIL_PATH,
  description: `Fiche détaillée d'une origine : producteur, terroir, anecdotes. Valeurs possibles pour l'argument id : ${Object.values(
    ORIGINS,
  )
    .map((o) => `"${o.id}" (${o.ingredient}, ${o.terroir})`)
    .join(', ')}.`,
};

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

  // The store is the single source of truth shared by the cart functions and
  // the page-state controls. It updates the ref synchronously, then mirrors
  // into React state. The agent often fires several changes in the same tick
  // (e.g. setPageState with cone + scoops, then addToCart); without the
  // immediate ref write each handler reads the same stale value and the later
  // setCurrent clobbers the earlier one.
  const store = useMemo<OrderStore>(
    () => ({
      get: () => ({ current: currentRef.current, cart: cartRef.current }),
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

  const fns = useMemo(() => buildIceCreamFunctions(store), [store]);
  const controls = useMemo(() => buildIceCreamControls(store), [store]);

  // The composition (cone/scoops/toppings) now reaches the agent through the
  // page-state controls' get(). This dynamic context carries the rest of the
  // order — the cart and the running totals — which aren't editable controls.
  useEffect(() => {
    client.addDynamicContext('order', () => {
      const cur = currentRef.current;
      const items = cartRef.current;
      return {
        name: 'Commande',
        description: 'Panier et totaux (euros). La glace en cours est exposée via le page state.',
        data: {
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

  // Cone/scoops/toppings are editable page state, but registered ONLY on the
  // shop page (see <ShopStateBridge /> below) — you compose an ice cream where
  // it's visible. So "je veux une glace pistache" from the parfums or origines
  // page makes the agent navigate to the shop first; useAgoAutoContinueAfterNavigation
  // then composes it in the same gesture.

  useAgoFunction(fns.resetCurrent.name, fns.resetCurrent);
  useAgoFunction(fns.addToCart.name, fns.addToCart);
  useAgoFunction(fns.updateCart.name, fns.updateCart);
  useAgoFunction(fns.getState.name, fns.getState);
  useAgoFunction(fns.placeOrder.name, fns.placeOrder);
  // Démo du garde-fou maxFunctionResultBytes : renvoie la réponse brute (et
  // volumineuse) d'une API publique, que le SDK tronque avant l'envoi au LLM.
  useAgoFunction(lookupWikipediaArticle.name, lookupWikipediaArticle);

  useAgoNavigation(navigate, [...Object.values(ROUTES), ORIGIN_DETAIL_ROUTE]);

  // In pause mode (see main.tsx) the backend pauses the turn on the navigation
  // call; this hook delays the SDK's auto-resume until the destination page's
  // useAgoPageState has registered — so "va sur la page parfums et montre les
  // parfums sans lactose" resolves in one user gesture, within the SAME turn.
  useAgoAutoContinueAfterNavigation();

  const currentPrice = computePrice(current);
  const cartTotal = computeCartTotal(cart);
  const grandTotal = Math.round((cartTotal + currentPrice) * 100) / 100;

  // Scroll the boutique back to the top when the agent (or the reader) changes
  // page — the header is sticky, the content is not.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  const focusChat = () => {
    const input = document.querySelector<HTMLTextAreaElement>('.gl-chat .ago-chat-input__field');
    input?.focus();
    const chatPanel = input?.closest<HTMLElement>('.gl-chat');
    if (input && chatPanel && getComputedStyle(chatPanel).position !== 'sticky') {
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const addCurrentToCart = () => {
    void fns.addToCart.handler({});
  };

  const removeCartItem = (id: string) => {
    void fns.updateCart.handler({ action: 'remove', cartItemId: id });
  };

  const clearCart = () => {
    void fns.updateCart.handler({ action: 'clear' });
  };

  return (
    <div className="gl-shell">
      <AnnounceBar />
      <BoutiqueHeader cartCount={cart.length} grandTotal={grandTotal} />

      <main className="gl-main">
        <aside className="gl-chat" aria-label="Chat avec le maître glacier">
          <div className="gl-chat-identity">
            <span className="gl-chat-seal" aria-hidden>G</span>
            <div>
              <span className="gl-chat-presence"><i /> Maître glacier disponible</span>
              <h2>Le comptoir privé</h2>
              <p>Une envie, une allergie, un souvenir : décrivez-le simplement.</p>
            </div>
          </div>
          <div className="gl-chat-widget-shell">
            <ChatWidget
              title="Composer avec le glacier"
              welcomeMessage="Bonjour. Dites-moi ce qui vous ferait plaisir — je compose la glace et votre ticket se met à jour à droite."
              placeholder="Deux boules pistache et chocolat…"
              height="100%"
              allowFiles={false}
              allowStop
            />
          </div>
          <div className="gl-chat-footnote">
            <span aria-hidden>✦</span>
            Allergènes et origines vérifiés à chaque composition
          </div>
        </aside>

        <section className="gl-stage">
          <Routes>
            <Route
              path={ROUTES.shop.path}
              element={
                <>
                  <ShopStateBridge controls={controls} />
                  <ShopExperience
                    current={current}
                    currentPrice={currentPrice}
                    cart={cart}
                    cartTotal={cartTotal}
                    grandTotal={grandTotal}
                    onAddCurrent={addCurrentToCart}
                    onRemoveCartItem={removeCartItem}
                    onClearCart={clearCart}
                    onFocusChat={focusChat}
                  />
                </>
              }
            />
            <Route path={ROUTES.ingredients.path} element={<IngredientsContent />} />
            <Route path={ROUTES.flavors.path} element={<FlavorsPage />} />
            <Route path={ROUTES.origins.path} element={<OriginsIndex />} />
            <Route path={ORIGIN_DETAIL_PATH} element={<OriginDetail />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </section>
      </main>

      <BoutiqueFooter />
    </div>
  );
}

// Registers the ice-cream composition controls (cone/scoops/toppings) only while
// the shop page is mounted. Rendered inside the shop <Route>, so leaving the page
// unregisters setPageState — the agent can only compose an ice cream here.
function ShopStateBridge({ controls }: { controls: AgoStateControl[] }) {
  useAgoPageState(controls);
  return null;
}

function NotFound() {
  return (
    <div>
      <SectionHeading eyebrow="Égaré" title="Page introuvable" lede="Cette page n'existe pas." />
      <div style={{ marginTop: '32px' }}>
        <ButtonLink to={ROUTES.shop.path} variant="gold">Retour à la boutique</ButtonLink>
      </div>
    </div>
  );
}
