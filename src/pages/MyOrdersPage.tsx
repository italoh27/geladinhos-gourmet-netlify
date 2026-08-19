import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Loading, Notice } from "../components/Loading";
import { PasswordField } from "../components/PasswordField";
import { api, currency, dateTime, post } from "../lib/api";
import { useStore } from "../lib/store";
import type { Order } from "../lib/types";

export function MyOrdersPage() {
  const { customer, setCustomer, config } = useStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loyalty, setLoyalty] = useState({ progress_5: 0, progress_7: 0, rewards_5: 0, rewards_7: 0 });
  const [showPassword, setShowPassword] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!customer) { setLoading(false); return; }
    api<{ orders: Order[]; loyalty: typeof loyalty }>("/orders/mine").then((result) => { setOrders(result.orders); setLoyalty(result.loyalty); }).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, [customer]);
  async function changePassword(event: FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    if (passwords.newPassword !== passwords.confirm) { setError("A confirmação da senha não confere."); return; }
    try {
      await post("/auth/change-password", passwords);
      setMessage("Senha alterada com sucesso."); setPasswords({ currentPassword: "", newPassword: "", confirm: "" }); setShowPassword(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível alterar a senha."); }
  }
  if (!customer) return <section className="narrow-page"><Notice>Entre na sua conta para acompanhar seus pedidos.</Notice><Link className="primary-button" to="/cliente?voltar=/meus-pedidos">Entrar ou cadastrar</Link></section>;
  if (loading) return <Loading label="Buscando seus pedidos" />;
  return (
    <section className="orders-page page-stack">
      <div className="section-title glass-card page-heading"><div><span>Olá, {customer.name}</span><h1>Meus pedidos</h1></div><button className="ghost-button" type="button" onClick={async () => { await post("/auth/logout"); setCustomer(null); }}>Sair</button></div>
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      {config.loyaltyActive && (
        <section className="manager glass-card loyalty-customer-card">
          <div className="section-title"><div><span>Campanha de fidelidade</span><h2>Seu progresso</h2></div></div>
          <div className="analytics-grid"><article><span>Geladinhos de R$ 5</span><strong>{loyalty.progress_5}/10</strong><small>{loyalty.rewards_5} brinde(s)</small></article><article><span>Geladinhos de R$ 7</span><strong>{loyalty.progress_7}/10</strong><small>{loyalty.rewards_7} brinde(s)</small></article></div>
        </section>
      )}
      <section className="manager glass-card password-change-card">
        <div className="section-title"><div><span>Segurança</span><h2>Alterar senha</h2></div><button className="text-button" type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Ocultar" : "Mostrar"}</button></div>
        {showPassword && <form className="auth-form password-change-form" onSubmit={changePassword}><label>Senha atual<PasswordField value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} autoComplete="current-password" required /></label><label>Nova senha<PasswordField value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} autoComplete="new-password" minLength={6} required /></label><label>Confirmar nova senha<PasswordField value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} autoComplete="new-password" minLength={6} required /></label><button className="primary-button">Salvar nova senha</button></form>}
      </section>
      <div className="customer-order-list">{orders.map((order) => (
        <Link className="customer-order glass-card" to={`/pedido/${order.id}?token=${encodeURIComponent(order.token)}`} key={order.id}>
          <div><span>Pedido #{order.id}</span><h2>{dateTime(order.createdAt)}</h2></div>
          <div><b className={`badge badge-${order.paymentStatus}`}>{order.paymentStatus === "pago" ? "Pago" : "Pendente"}</b><strong>{currency(order.total)}</strong></div>
        </Link>
      ))}</div>
      {!orders.length && <Notice>Você ainda não realizou nenhum pedido.</Notice>}
      <Link className="ghost-button back-button" to="/">← Voltar para loja</Link>
    </section>
  );
}
