import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  SEED_DELIVERIES,
  quote,
  townOf,
  type Delivery,
  type Size,
  type Slot,
  type Status,
} from "./data";

export interface Draft {
  from: string;
  to: string;
  size: Size;
  description: string;
  slot: Slot;
}

const EMPTY_DRAFT: Draft = { from: "", to: "", size: "M", description: "", slot: "asap" };

interface Store {
  deliveries: Delivery[];
  draft: Draft;
  updateDraft: (patch: Partial<Draft>) => void;
  /** Book the draft; returns the new delivery's id. */
  confirmDraft: () => string;
}

const StoreContext = createContext<Store | null>(null);

const NEXT_STATUS: Partial<Record<Status, Status>> = {
  searching: "assigned",
  assigned: "picked_up",
  picked_up: "delivered",
};

// The draft lives here (not in the form screen) so what the assistant filled
// survives leaving the screen.
export function StoreProvider({ children }: { children: ReactNode }) {
  const [deliveries, setDeliveries] = useState<Delivery[]>(SEED_DELIVERIES);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  // Fake progress: every 45 s, booked deliveries move one step forward.
  useEffect(() => {
    const timer = setInterval(() => {
      setDeliveries((list) =>
        list.map((d) => {
          if (!d.id.startsWith("TT-5")) return d;
          const status = NEXT_STATUS[d.status];
          if (!status) return d;
          return {
            ...d,
            status,
            etaMinutes: status === "delivered" ? 0 : Math.max(5, d.etaMinutes - 20),
            coTransporter: d.coTransporter ?? { name: "Sofiane", vehicle: "Citroën Berlingo", rating: 4.8 },
          };
        }),
      );
    }, 45000);
    return () => clearInterval(timer);
  }, []);

  const store: Store = {
    deliveries,
    draft,
    updateDraft: (patch) => setDraft((d) => ({ ...d, ...patch })),
    confirmDraft: () => {
      const id = `TT-5${String(Date.now()).slice(-3)}`;
      const { price } = quote(draft.size, townOf(draft.to));
      setDeliveries((list) => [
        { ...draft, id, price, status: "searching", etaMinutes: 75 },
        ...list,
      ]);
      setDraft(EMPTY_DRAFT);
      return id;
    },
  };

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <StoreProvider>");
  return store;
}
