export type Flavor = {
  id: number;
  name: string;
  price: number;
  stock: number;
  active: boolean;
  imageUrl: string;
};

export type StoreConfig = {
  storeName: string;
  open: boolean;
  requireRegistration: boolean;
  requireAddress: boolean;
  infinitePayActive: boolean;
  paymentBeforeOrder: boolean;
  manualPixActive: boolean;
  whatsappSupportActive: boolean;
  loyaltyActive: boolean;
  deliveryEnabled: boolean;
  freeDelivery: boolean;
  deliveryFee: number;
  whatsappNumber: string;
  pix: { key: string; name: string; bank: string } | null;
};

export type Customer = { id: number; name: string; phone: string; email: string };

export type OrderItem = { id?: number; flavorId?: number; name: string; price: number; quantity: number; total: number };

export type Order = {
  id: number;
  token: string;
  customerId: number | null;
  customer: { name: string; phone: string; email: string };
  address: {
    postalCode: string; street: string; number: string; neighborhood: string;
    city: string; complement: string; reference: string;
  };
  status: "pendente" | "em_preparacao" | "saiu_entrega" | "entregue" | "cancelado";
  paymentStatus: "aguardando_pagamento" | "pago" | "cancelado" | "expirado";
  paymentMethod: string;
  paymentLink: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  stockReturned: boolean;
  stockConflict?: boolean;
  reservationExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
};

export type StorePayload = { config: StoreConfig; flavors: Flavor[]; customer: Customer | null };
