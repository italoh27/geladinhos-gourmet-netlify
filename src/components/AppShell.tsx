import { useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useCart } from "../lib/cart";
import { useStore } from "../lib/store";

export function AppShell({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState(false);
  const { count } = useCart();
  const { config, customer } = useStore();
  const location = useLocation();
  const showWhatsApp = location.pathname === "/" && config.whatsappSupportActive && config.whatsappNumber;
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button" type="button" onClick={() => setMenu((value) => !value)} aria-expanded={menu} aria-label="Abrir menu">☰</button>
        <Link className="brand" to="/">{config.storeName}</Link>
        <Link className="cart-button" to="/carrinho" aria-label={`Carrinho com ${count} itens`}><span>🛒</span>{count > 0 && <b>{count}</b>}</Link>
        {menu && (
          <nav className="menu-panel" aria-label="Menu principal">
            <NavLink to="/" onClick={() => setMenu(false)}>Loja</NavLink>
            <NavLink to={customer ? "/meus-pedidos" : "/cliente"} onClick={() => setMenu(false)}>{customer ? "Meus pedidos" : "Entrar ou cadastrar"}</NavLink>
            <NavLink to="/admin/login" onClick={() => setMenu(false)}>Admin</NavLink>
          </nav>
        )}
      </header>
      <main>{children}</main>
      {showWhatsApp && (
        <a className="whatsapp-float" href={`https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent("Olá! Preciso de ajuda com um pedido.")}`} target="_blank" rel="noreferrer" aria-label="Fale conosco pelo WhatsApp" title="Fale conosco pelo WhatsApp"><span aria-hidden="true">💬</span></a>
      )}
    </div>
  );
}
