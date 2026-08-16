import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Flavor } from "./types";

export type CartItem = Pick<Flavor, "id" | "name" | "price" | "imageUrl" | "stock"> & { quantity: number };

type CartContextValue = {
  items: CartItem[];
  count: number;
  total: number;
  add: (flavor: Flavor, quantity?: number) => void;
  setQuantity: (id: number, quantity: number) => void;
  remove: (id: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const KEY = "geladinhos-casa-cart";

function loadCart(): CartItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(loadCart);
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(items)), [items]);

  const value = useMemo<CartContextValue>(() => ({
    items,
    count: items.reduce((sum, item) => sum + item.quantity, 0),
    total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    add(flavor, quantity = 1) {
      setItems((current) => {
        const existing = current.find((item) => item.id === flavor.id);
        const nextQuantity = Math.min(flavor.stock, (existing?.quantity || 0) + Math.max(1, quantity));
        if (existing) return current.map((item) => item.id === flavor.id ? { ...item, ...flavor, quantity: nextQuantity } : item);
        return [...current, { id: flavor.id, name: flavor.name, price: flavor.price, imageUrl: flavor.imageUrl, stock: flavor.stock, quantity: nextQuantity }];
      });
    },
    setQuantity(id, quantity) {
      setItems((current) => current
        .map((item) => item.id === id ? { ...item, quantity: Math.max(0, Math.min(item.stock, quantity)) } : item)
        .filter((item) => item.quantity > 0));
    },
    remove(id) { setItems((current) => current.filter((item) => item.id !== id)); },
    clear() { setItems([]); },
  }), [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error("CartProvider ausente.");
  return value;
}
