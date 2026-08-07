import { useCallback, useEffect, useRef, useState } from 'react';

// Un vrai appel réseau, pas un setTimeout : c'est ce qui rend la démo de
// `useAgoPageState({ data })` honnête. Entre le moment où l'agent change le
// filtre et celui où les prix arrivent, la page affiche encore les anciens.
// Sans `isLoading`, l'agent lirait ces anciens prix et les annoncerait au client.
export const MARKET_PRICES_URL =
  'https://useago.github.io/static-json-response/flavours-price.json';

/** Réponse du service de prix : identifiant de parfum -> prix en euros. */
export type MarketPrices = Record<string, number>;

// Le service publie plus de parfums que notre carte, et sous ses propres
// identifiants. Ce qui n'est pas dans la table n'a simplement pas de cours.
const MARKET_ID_BY_FLAVOR: Record<string, string> = {
  vanilla: 'vanilla',
  chocolate: 'chocolate',
  strawberry: 'strawberry',
  pistachio: 'pistachio',
  lemon: 'lemon',
  caramel: 'salted_caramel',
  mango: 'mango',
  raspberry: 'raspberry',
  coffee: 'coffee',
  // "mint" (notre Menthe glaciale) n'a pas d'équivalent au marché : le service
  // ne cote que "mint_chocolate_chip", qui est une autre recette.
};

export async function fetchMarketPrices(): Promise<MarketPrices> {
  const res = await fetch(MARKET_PRICES_URL);
  if (!res.ok) {
    throw new Error(`Le service de prix a répondu HTTP ${res.status}`);
  }
  return (await res.json()) as MarketPrices;
}

/** Cours du jour pour un parfum de notre carte, ou null s'il n'est pas coté. */
export function marketPriceOf(
  flavorId: string,
  prices: MarketPrices | null,
): number | null {
  if (!prices) return null;
  const marketId = MARKET_ID_BY_FLAVOR[flavorId];
  if (!marketId) return null;
  const price = prices[marketId];
  return typeof price === 'number' ? price : null;
}

/**
 * Charge les cours quand `enabled` passe à true, et les recharge à chaque
 * réactivation (c'est un cours du jour, pas une constante).
 *
 * `isFetching` couvre TOUT le rechargement, pas seulement le premier : c'est
 * exactement ce que `data.isLoading` attend côté SDK.
 */
export function useMarketPrices(enabled: boolean) {
  const [prices, setPrices] = useState<MarketPrices | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Une réponse lente arrivée après un changement d'avis ne doit pas écraser
  // un état plus récent.
  const runRef = useRef(0);
  // La requête en vol, partagée : l'UI et l'agent attendent la MÊME promesse,
  // donc un seul appel réseau. C'est elle que `data.get()` retourne au SDK.
  const inFlightRef = useRef<Promise<MarketPrices> | null>(null);

  const load = useCallback(() => {
    const run = ++runRef.current;
    setIsFetching(true);
    setError(null);
    const request = fetchMarketPrices();
    inFlightRef.current = request;
    request
      .then((next) => {
        if (runRef.current !== run) return;
        setPrices(next);
      })
      .catch((err: unknown) => {
        if (runRef.current !== run) return;
        setPrices(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (runRef.current !== run) return;
        inFlightRef.current = null;
        setIsFetching(false);
      });
    return request;
  }, []);

  /**
   * Les cours, sous forme de promesse : celle en vol s'il y en a une, sinon un
   * nouvel appel. C'est ce que le SDK attend pour savoir que le travail
   * déclenché par le changement d'état est terminé — pas un sondage.
   */
  const ensure = useCallback((): Promise<MarketPrices> => {
    if (inFlightRef.current) return inFlightRef.current;
    return load();
  }, [load]);

  useEffect(() => {
    if (!enabled) {
      // On repasse en tarif maison : plus rien en vol, plus rien à afficher.
      runRef.current++;
      inFlightRef.current = null;
      setIsFetching(false);
      setPrices(null);
      setError(null);
      return;
    }
    load();
  }, [enabled, load]);

  return { prices, isFetching, error, reload: load, ensure };
}
