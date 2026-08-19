import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loading, Notice } from "../components/Loading";
import { QuantityControl } from "../components/QuantityControl";
import { currency } from "../lib/api";
import { useCart } from "../lib/cart";
import { useStore } from "../lib/store";

export function StorePage() {
  const { config, flavors, loading, error } = useStore();
  const cart = useCart();
  const carouselRef = useRef<HTMLDivElement>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const cartById = useMemo(() => new Map(cart.items.map((item) => [item.id, item.quantity])), [cart.items]);

  function scrollCarousel(direction: -1 | 1) {
    const carousel = carouselRef.current;
    if (!carousel) return;
    carousel.scrollBy({ left: direction * Math.max(280, carousel.clientWidth * 0.82), behavior: "smooth" });
  }

  if (loading) return <Loading label="Abrindo a loja" />;
  return (
    <section className="store-page page-stack">
      <header className={`hero glass-card ${config.open ? "hero-open" : "hero-closed"}`}>
        <span className={`store-status ${config.open ? "open" : "closed"}`}>{config.open ? "Loja aberta" : "Loja fechada"}</span>
        {config.open ? <h1 className="store-title">GELADINHOS GOURMET</h1> : <div className="notice store-closed-message store-closed-hero" role="status">{config.closedMessage || "Estamos fechados agora. Você pode conhecer os sabores e voltar quando a loja abrir."}</div>}
      </header>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="section-title flavor-section-title">
        <div><span>Cardápio</span><h2>Sabores disponíveis</h2></div>
        <div className="carousel-controls inline-carousel-controls">
          <button type="button" className="carousel-arrow carousel-arrow-left" aria-label="Ver sabores anteriores" onClick={() => scrollCarousel(-1)}>‹</button>
          <b>{flavors.filter((flavor) => flavor.stock > 0).length} sabores</b>
          <button type="button" className="carousel-arrow carousel-arrow-right" aria-label="Ver próximos sabores" onClick={() => scrollCarousel(1)}>›</button>
        </div>
      </div>
      <div className="flavor-carousel">
        <div ref={carouselRef} className="flavor-grid" role="region" aria-label="Carrossel de sabores" tabIndex={0}>
          {flavors.map((flavor) => {
          const inCart = cartById.get(flavor.id) || 0;
          const personalAvailable = Math.max(0, flavor.stock - inCart);
          const selected = Math.min(quantities[flavor.id] || 1, personalAvailable || 1);
          return (
            <article className="flavor-card glass-card" key={flavor.id}>
              <img src={flavor.imageUrl} alt={`Geladinho gourmet sabor ${flavor.name}`} loading="lazy" width="420" height="420" />
              <div className="flavor-copy">
                <h3>{flavor.name}</h3>
                <strong>{currency(flavor.price)}</strong>
                <p className={personalAvailable ? "stock-ok" : "stock-out"}>{personalAvailable ? `${personalAvailable} unidade(s) disponível(is)` : "Esgotado para seu carrinho"}</p>
              </div>
              <div className="flavor-actions">
                <span>Quantidade</span>
                <QuantityControl value={selected} min={personalAvailable ? 1 : 0} max={personalAvailable} onChange={(value) => setQuantities((current) => ({ ...current, [flavor.id]: value }))} />
                <button type="button" className="primary-button" disabled={!config.open || !personalAvailable} onClick={() => {
                  cart.add(flavor, selected);
                  setQuantities((current) => ({ ...current, [flavor.id]: 1 }));
                }}>Adicionar ao carrinho</button>
              </div>
            </article>
          );
          })}
        </div>
      </div>
      {cart.count > 0 && <Link className="mobile-checkout-bar" to="/carrinho"><span>{cart.count} item(ns)</span><strong>Ver carrinho · {currency(cart.total)}</strong></Link>}
    </section>
  );
}
