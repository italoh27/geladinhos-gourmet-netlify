import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Loading, Notice } from "../components/Loading";
import { api, currency, dateTime, post } from "../lib/api";
import { useStore } from "../lib/store";
import type { Order } from "../lib/types";

const statusLabels: Record<string, string> = { pendente: "Pedido recebido", em_preparacao: "Em preparação", saiu_entrega: "Saiu para entrega", entregue: "Entregue", cancelado: "Cancelado" };

export function OrderPage() {
  const { config } = useStore();
  const { id } = useParams();
  const [search] = useSearchParams();
  const token = search.get("token") || localStorage.getItem(`pedido-token-${id}`) || "";
  const [order, setOrder] = useState<Order | null>(null);
  const [whatsappUrl, setWhatsappUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const access = useMemo(() => `token=${encodeURIComponent(token)}`, [token]);

  const load = useCallback(async (refresh = false) => {
    try {
      const result = await api<{ order: Order; whatsappUrl: string }>(`/orders/${id}?${access}${refresh ? "&refresh=1" : ""}`);
      setOrder(result.order);
      setWhatsappUrl(result.whatsappUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível consultar o pedido.");
    } finally {
      setLoading(false);
    }
  }, [access, id]);

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => { if (order?.paymentStatus !== "pago" && order?.paymentStatus !== "cancelado") void load(true); }, 5000);
    return () => window.clearInterval(timer);
  }, [load, order?.paymentStatus]);

  if (loading) return <Loading label="Consultando seu pedido" />;
  if (error || !order) return <section className="narrow-page"><Notice kind="error">{error || "Pedido não encontrado."}</Notice><Link className="ghost-button" to="/">Voltar para loja</Link></section>;
  const paid = order.paymentStatus === "pago";
  const waitingPayment = order.paymentStatus === "aguardando_pagamento";
  const finished = paid || ["cancelado", "expirado"].includes(order.paymentStatus);
  const visibleStatus = waitingPayment ? "Aguardando pagamento" : statusLabels[order.status];
  return (
    <section className="order-page narrow-page page-stack">
      {paid && <div className="thank-you glass-card"><span>✓</span><div><h1>Obrigado pelo seu pedido, {order.customer.name}!</h1></div></div>}
      {order.stockConflict && <Notice kind="error">Seu pagamento foi confirmado depois que a reserva venceu e um item ficou sem estoque. Fale com a loja para receber uma substituição ou reembolso.</Notice>}
      {!paid && waitingPayment && (
        <div className="payment-reference glass-card">
          <span>Referência do pedido</span><h1>#{order.id}</h1>
          {order.paymentLink && <a className="primary-button" href={order.paymentLink}>Pagar com a InfinitePay</a>}
          {config.manualPixActive && config.pix && <div className="manual-pix"><strong>Ou pague por Pix</strong><span>Chave: {config.pix.key}</span>{config.pix.name && <span>Nome: {config.pix.name}</span>}{config.pix.bank && <span>Banco: {config.pix.bank}</span>}</div>}
          {order.paymentLink && <p>A confirmação pela InfinitePay é automática. O estoque fica reservado por 15 minutos.</p>}
        </div>
      )}
      {!paid && finished && <Notice kind="error">Pagamento cancelado ou expirado. Os itens foram devolvidos ao estoque.</Notice>}
      <article className="order-summary glass-card">
        <div className="section-title"><div><span>Pedido #{order.id}</span><h2>{visibleStatus}</h2></div><b className={`badge badge-${order.paymentStatus}`}>{paid ? "Pago" : order.paymentStatus.replaceAll("_", " ")}</b></div>
        <p className="muted">Criado em {dateTime(order.createdAt)}</p>
        <div className="order-items">{order.items.map((item, index) => <p key={`${item.name}-${index}`}><span>{item.quantity}× {item.name}</span><strong>{currency(item.total)}</strong></p>)}</div>
        <div className="totals"><p><span>Produtos</span><strong>{currency(order.subtotal)}</strong></p><p><span>Entrega</span><strong>{order.deliveryFee ? currency(order.deliveryFee) : "Grátis"}</strong></p><p className="grand-total"><span>Total</span><strong>{currency(order.total)}</strong></p></div>
        <div className="button-row">
          {paid && whatsappUrl && <a className="primary-button" href={whatsappUrl} target="_blank" rel="noreferrer">Enviar pedido para a loja</a>}
          {!finished && <button className="danger-button" type="button" onClick={async () => { await post(`/orders/${order.id}/cancel`); void load(); }}>Cancelar pagamento</button>}
          <Link className="ghost-button" to="/">Voltar para loja</Link>
        </div>
      </article>
    </section>
  );
}
