import type { StorePayload } from "./types";

const flavors = [
  [1, "Ninho com Nutella", 7, 8, "card_ninho_com_nutela_gourmet.webp"],
  [2, "Ninho com Morango", 7, 7, "card_ninho_com_morango_gourmet.webp"],
  [3, "Romeu e Julieta", 7, 5, "card_romeu_julieta_gourmet.webp"],
  [4, "Maracujá Trufado", 7, 9, "card_maracuja_trufado_gourmet_v2.webp"],
  [5, "Paçoca", 5, 12, "card_pacoca_gourmet.webp"],
  [6, "Pudim", 5, 10, "card_pudim_gourmet.webp"],
  [7, "Cocada", 5, 8, "card_cocada_gourmet.webp"],
  [8, "Delícia de Abacaxi", 5, 6, "card_delicia_de_abacaxi_gourmet.webp"],
  [9, "Prestígio", 7, 7, "card_prestigio_gourmet.webp"],
  [10, "Ninho", 5, 11, "card_ninho_gourmet.webp"],
  [11, "Maracujá", 5, 9, "card_maracuja_gourmet_v2.webp"],
  [12, "Morango com Chocolate", 7, 6, "card_morango_com_chocolate_gourmet.webp"],
] as const;

export const localDemoStore: StorePayload = {
  config: {
    storeName: "Geladinhos Gourmet",
    open: true,
    requireRegistration: false,
    requireAddress: true,
    infinitePayActive: true,
    paymentBeforeOrder: true,
    manualPixActive: false,
    whatsappSupportActive: true,
    loyaltyActive: true,
    deliveryEnabled: true,
    freeDelivery: false,
    deliveryFee: 3,
    whatsappNumber: "",
    closedMessage: "Estamos fechados agora. Você pode conhecer os sabores e voltar quando a loja abrir.",
    pix: null,
  },
  flavors: flavors.map(([id, name, price, stock, image]) => ({
    id,
    name,
    price,
    stock,
    active: true,
    imageUrl: `/sabores/${image}`,
  })),
  customer: null,
};
