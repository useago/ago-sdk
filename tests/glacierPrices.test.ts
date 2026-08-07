import { describe, it, expect, vi, afterEach } from "vitest";
import { lookupFlavorPrices } from "../examples/glacier/src/functions";
import { FLAVORS } from "../examples/glacier/src/flavors";

const REMOTE = {
  vanilla: 3.5,
  chocolate: 3.8,
  strawberry: 3.6,
  pistachio: 4.2,
  salted_caramel: 4.0,
  lemon: 3.4,
  mango: 3.9,
  raspberry: 3.8,
  coffee: 3.7,
};

function stubFetch() {
  const mock = vi.fn(
    async () => ({ ok: true, json: async () => REMOTE }) as Response
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Grid = {
  ok: boolean;
  devise: string;
  parfums: {
    id: string;
    nom: string;
    prixMaisonEuros: number;
    coursDuJourEuros: number | null;
  }[];
};

describe("lookupFlavorPrices", () => {
  it("prend zero argument et renvoie toute la carte en un appel", async () => {
    const fetchMock = stubFetch();

    expect(lookupFlavorPrices.parameters.properties).toEqual({});
    expect(lookupFlavorPrices.parameters.required).toBeUndefined();

    const res = (await lookupFlavorPrices.handler({})) as Grid;

    expect(res.ok).toBe(true);
    expect(res.devise).toBe("EUR");
    expect(res.parfums).toHaveLength(Object.keys(FLAVORS).length);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("donne les deux prix par parfum, sans classement pre-mache", async () => {
    stubFetch();
    const res = (await lookupFlavorPrices.handler({})) as Grid & Record<string, unknown>;

    for (const p of res.parfums) {
      expect(typeof p.prixMaisonEuros).toBe("number");
      expect(
        p.coursDuJourEuros === null || typeof p.coursDuJourEuros === "number"
      ).toBe(true);
    }

    // Le raisonnement reste a la charge de l'agent : on ne lui sert pas la
    // reponse. Pas de tri impose, pas de "moinsCher".
    expect(res.moinsCher).toBeUndefined();
    expect(res.deuxMoinsChers).toBeUndefined();
    expect(res.tri).toBeUndefined();
    expect(res.parfums.map((p) => p.id)).toEqual(Object.keys(FLAVORS));
  });

  it("la carte contient de quoi repondre a « les 2 moins chers »", async () => {
    stubFetch();
    const res = (await lookupFlavorPrices.handler({})) as Grid;

    // Ce que l'agent doit pouvoir deduire lui-meme des donnees renvoyees.
    const parMaison = [...res.parfums].sort(
      (a, b) => a.prixMaisonEuros - b.prixMaisonEuros
    );
    expect(parMaison[0].prixMaisonEuros).toBe(2.5);
    expect(parMaison[1].prixMaisonEuros).toBe(2.5);

    const cotes = res.parfums.filter((p) => p.coursDuJourEuros !== null);
    expect(cotes).toHaveLength(9);
    const parCours = [...cotes].sort(
      (a, b) => (a.coursDuJourEuros as number) - (b.coursDuJourEuros as number)
    );
    expect(parCours[0].id).toBe("lemon");
  });

  it("un parfum non cote vaut null, il n'est pas invente", async () => {
    stubFetch();
    const res = (await lookupFlavorPrices.handler({})) as Grid;
    const mint = res.parfums.find((p) => p.id === "mint");
    expect(mint?.coursDuJourEuros).toBeNull();
    expect(mint?.prixMaisonEuros).toBe(2.5);
  });

  it("un service en panne remonte l'erreur au lieu de prix inventes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 }) as Response)
    );
    const res = (await lookupFlavorPrices.handler({})) as {
      ok: boolean;
      error: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("503");
  });
});
