import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { localDemoStore } from "./demo";
import type { Customer, StorePayload } from "./types";

type StoreContextValue = StorePayload & {
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  setCustomer: (customer: Customer | null) => void;
};

const StoreContext = createContext<StoreContextValue | null>(null);
const STORE_UPDATED_EVENT = "store-updated";
const STORE_CACHE_KEY = "geladinhos-store-cache";
const STORE_CACHE_TTL_MS = 30_000;

const empty: StorePayload = {
  config: {
    storeName: "Geladinhos Gourmet", open: true, requireRegistration: false, requireAddress: true,
    infinitePayActive: true, paymentBeforeOrder: false, manualPixActive: false,
    whatsappSupportActive: false, loyaltyActive: false, deliveryEnabled: true,
    freeDelivery: false, deliveryFee: 0, whatsappNumber: "", closedMessage: "Estamos fechados agora. Você pode conhecer os sabores e voltar quando a loja abrir.", pix: null,
  },
  flavors: [],
  customer: null,
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<StorePayload>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState(0);

  useEffect(() => {
    try {
      const cached = localStorage.getItem(STORE_CACHE_KEY);
      if (!cached) return;
      const parsed = JSON.parse(cached) as { timestamp?: number; data?: StorePayload };
      if (!parsed?.data || !parsed.timestamp) return;
      if (Date.now() - parsed.timestamp > STORE_CACHE_TTL_MS) return;
      setData(parsed.data);
      setLoading(false);
      setLastLoadedAt(parsed.timestamp);
    } catch {
      // Cache inválido: seguimos com carregamento normal.
    }
  }, []);

  const reload = useCallback(async () => {
    setError("");
    try {
      const next = await api<StorePayload>("/store");
      setData(next);
      const timestamp = Date.now();
      setLastLoadedAt(timestamp);
      try {
        localStorage.setItem(STORE_CACHE_KEY, JSON.stringify({ timestamp, data: next }));
      } catch {
        // Se o navegador bloquear storage, seguimos normalmente.
      }
    } catch (reason) {
      if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
        setData(localDemoStore);
        setError("");
        return;
      }
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar a loja.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const refresh = () => {
      if (Date.now() - lastLoadedAt < 5000) return;
      void reload();
    };
    window.addEventListener(STORE_UPDATED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(STORE_UPDATED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [reload, lastLoadedAt]);
  const value = useMemo<StoreContextValue>(() => ({
    ...data, loading, error, reload,
    setCustomer(customer) { setData((current) => ({ ...current, customer })); },
  }), [data, loading, error, reload]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("StoreProvider ausente.");
  return value;
}

export function notifyStoreUpdated() {
  window.dispatchEvent(new Event(STORE_UPDATED_EVENT));
}
