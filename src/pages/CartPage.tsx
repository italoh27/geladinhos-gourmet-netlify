import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Notice } from "../components/Loading";
import { QuantityControl } from "../components/QuantityControl";
import { api, currency, post } from "../lib/api";
import { useCart } from "../lib/cart";
import { useStore } from "../lib/store";
import type { Order } from "../lib/types";

type Address = { postalCode: string; street: string; number: string; neighborhood: string; city: string; complement: string; reference: string };
const emptyAddress: Address = { postalCode: "", street: "", number: "", neighborhood: "", city: "", complement: "", reference: "" };
const CHECKOUT_DRAFT_KEY = "gg_checkout_draft";
const CUSTOMER_PROFILE_KEY = "gg_customer_profile";

type CheckoutDraft = {
  name: string;
  phone: string;
  email: string;
  address: Address;
};

export function CartPage() {
  const cart = useCart();
  const { config, customer } = useStore();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState<Address>(emptyAddress);
  const [cepState, setCepState] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const deliveryFee = config.deliveryEnabled && !config.freeDelivery ? config.deliveryFee : 0;

  useEffect(() => {
    const applyDraft = (draft: Partial<CheckoutDraft> | null) => {
      if (!draft) return;
      if (draft.name) setName(draft.name);
      if (draft.phone) setPhone(draft.phone);
      if (draft.email) setEmail(draft.email);
      if (draft.address) setAddress((current) => ({ ...current, ...draft.address }));
    };
    try {
      const savedDraft = localStorage.getItem(CHECKOUT_DRAFT_KEY);
      if (savedDraft) applyDraft(JSON.parse(savedDraft) as Partial<CheckoutDraft>);
      const savedCustomer = localStorage.getItem(CUSTOMER_PROFILE_KEY);
      if (savedCustomer) applyDraft(JSON.parse(savedCustomer) as Partial<CheckoutDraft>);
    } catch {
      // Ignora dados corrompidos e segue com os campos limpos.
    }
  }, []);

  useEffect(() => {
    if (customer) {
      setName(customer.name || "");
      setPhone(customer.phone || "");
      setEmail(customer.email || "");
      try {
        localStorage.setItem(CUSTOMER_PROFILE_KEY, JSON.stringify({
          name: customer.name || "",
          phone: customer.phone || "",
          email: customer.email || "",
        }));
      } catch {
        // Sem persistência local, o login do backend continua valendo.
      }
    }
  }, [customer]);

  useEffect(() => {
    try {
      localStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify({ name, phone, email, address }));
    } catch {
      // Se o navegador bloquear storage, seguimos normalmente.
    }
  }, [name, phone, email, address]);

  useEffect(() => {
    const digits = address.postalCode.replace(/\D/g, "");
    if (digits.length !== 8) return;
    const timer = window.setTimeout(async () => {
      setCepState("Buscando endereço…");
      try {
        const result = await api<{ street: string; neighborhood: string; city: string }>(`/cep/${digits}`);
        setAddress((current) => ({ ...current, street: result.street, neighborhood: result.neighborhood, city: result.city }));
        setCepState("Endereço encontrado");
      } catch {
        setCepState("Preencha o endereço manualmente");
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [address.postalCode]);

  async function checkout(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!cart.items.length) return;
    if (config.requireRegistration && !customer) {
      navigate("/cliente?voltar=/carrinho");
      return;
    }
    setSubmitting(true);
    try {
      const result = await post<{ order: Order; checkoutUrl: string; token: string }>("/orders/checkout", {
        items: cart.items.map((item) => ({ flavorId: item.id, quantity: item.quantity })),
        name, phone, email, address,
      });
      localStorage.setItem(`pedido-token-${result.order.id}`, result.token);
      localStorage.setItem(CUSTOMER_PROFILE_KEY, JSON.stringify({ name, phone, email }));
      cart.clear();
      navigate(`/pedido/${result.order.id}?token=${encodeURIComponent(result.token)}`, { state: { checkoutUrl: result.checkoutUrl } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o pedido.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!cart.items.length) return (
    <section className="narrow-page glass-card empty-state"><span>🛒</span><h1>Seu carrinho está vazio</h1><Link className="primary-button" to="/">Escolher sabores</Link></section>
  );

  return (
    <form className="cart-page page-grid" onSubmit={checkout}>
      <section className="glass-card cart-items">
        <div className="section-title"><div><span>Seu pedido</span><h1>Carrinho</h1></div><b>{cart.count} unidade(s)</b></div>
        {cart.items.map((item) => (
          <article className="cart-item" key={item.id}>
            <img src={item.imageUrl} alt="" width="80" height="80" />
            <div><h3>{item.name}</h3><strong>{currency(item.price * item.quantity)}</strong></div>
            <QuantityControl value={item.quantity} max={item.stock} onChange={(value) => cart.setQuantity(item.id, value)} label={`Quantidade de ${item.name}`} />
          </article>
        ))}
      </section>

      <aside className="glass-card checkout-card">
        <div className="section-title"><div><span>Finalização</span><h2>Dados do pedido</h2></div></div>
        {error && <Notice kind="error">{error}</Notice>}
        {!customer && <label>Nome<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Seu nome" /></label>}
        {!customer && <label>Telefone<input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="Opcional" /></label>}
        {!customer && <label>E-mail<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="Opcional" /></label>}
        {config.deliveryEnabled && config.requireAddress && (
          <fieldset className="address-fields">
            <legend>Endereço de entrega</legend>
            <label>CEP<input value={address.postalCode} onChange={(event) => setAddress({ ...address, postalCode: event.target.value })} inputMode="numeric" autoComplete="postal-code" required /><small>{cepState}</small></label>
            <label>Rua<input value={address.street} onChange={(event) => setAddress({ ...address, street: event.target.value })} autoComplete="address-line1" required /></label>
            <label>Número<input value={address.number} onChange={(event) => setAddress({ ...address, number: event.target.value })} required /></label>
            <label>Bairro<input value={address.neighborhood} onChange={(event) => setAddress({ ...address, neighborhood: event.target.value })} required /></label>
            <label>Cidade <small>opcional</small><input value={address.city} onChange={(event) => setAddress({ ...address, city: event.target.value })} /></label>
            <label>Complemento <small>opcional</small><input value={address.complement} onChange={(event) => setAddress({ ...address, complement: event.target.value })} autoComplete="address-line2" /></label>
            <label className="full-field">Ponto de referência <small>opcional</small><input value={address.reference} onChange={(event) => setAddress({ ...address, reference: event.target.value })} /></label>
          </fieldset>
        )}
        <div className="totals"><p><span>Produtos</span><strong>{currency(cart.total)}</strong></p><p><span>Entrega</span><strong>{deliveryFee ? currency(deliveryFee) : "Grátis"}</strong></p><p className="grand-total"><span>Total</span><strong>{currency(cart.total + deliveryFee)}</strong></p></div>
        <button className="primary-button" disabled={submitting || !config.open}>{submitting ? "Confirmando estoque…" : config.infinitePayActive ? "Continuar para pagamento" : "Criar pedido"}</button>
        <button className="ghost-button" type="button" onClick={cart.clear}>Limpar carrinho</button>
      </aside>
    </form>
  );
}
