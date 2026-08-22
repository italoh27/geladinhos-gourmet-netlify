import { query, transaction } from "./db";
import { commitStock, getOrder } from "./orders";
import { processOrderLoyalty } from "./loyalty";
import { notifyN8n } from "./n8n";

type CheckoutOrder = Awaited<ReturnType<typeof getOrder>> & {
  id: number;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  postal_code: string;
  street: string;
  number: string;
  neighborhood: string;
  complement: string;
  reference: string;
  delivery_fee: number;
  items: Array<{ name: string; price: number; quantity: number }>;
};

function siteUrl() {
  return (process.env.PUBLIC_SITE_URL || process.env.URL || "").replace(/\/$/, "");
}

export function infinitePayEnabled() {
  return Boolean((process.env.INFINITEPAY_HANDLE || "").trim());
}

export async function createInfinitePayCheckout(orderId: number) {
  const order = (await getOrder(orderId)) as CheckoutOrder | null;
  if (!order) throw new Error("Pedido não encontrado.");
  const handle = (process.env.INFINITEPAY_HANDLE || "").trim();
  if (!handle) return "";

  const items = order.items.map((item) => ({
    quantity: Number(item.quantity),
    price: Math.round(Number(item.price) * 100),
    description: item.name,
  }));
  if (Number(order.delivery_fee) > 0) {
    items.push({ quantity: 1, price: Math.round(Number(order.delivery_fee) * 100), description: "Taxa de entrega" });
  }

  const complement = [order.complement, order.reference ? `Referência: ${order.reference}` : ""].filter(Boolean).join(" | ");
  const payload: Record<string, unknown> = {
    handle,
    items,
    order_nsu: String(order.id),
    redirect_url: `${siteUrl()}/pedido/${order.id}/retorno`,
    webhook_url: `${siteUrl()}/api/payments/infinitepay/webhook`,
    customer: {
      name: order.customer_name || "Cliente",
      phone_number: order.customer_phone,
      ...(order.customer_email ? { email: order.customer_email } : {}),
    },
  };
  if (order.postal_code && order.street && order.number && order.neighborhood) {
    payload.address = {
      cep: order.postal_code,
      street: order.street,
      number: order.number,
      neighborhood: order.neighborhood,
      complement,
    };
  }

  const response = await fetch("https://api.checkout.infinitepay.io/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`InfinitePay indisponível (${response.status}).`);
  const data = (await response.json()) as Record<string, unknown>;
  const checkoutUrl = String(data.checkout_url || data.url || data.link || "");
  if (!checkoutUrl) throw new Error("A InfinitePay não retornou o link de pagamento.");
  await query(
    "UPDATE orders SET payment_link = $2, payment_slug = $3, updated_at = NOW() WHERE id = $1",
    [orderId, checkoutUrl, String(data.slug || data.invoice_slug || "")],
  );
  return checkoutUrl;
}

export async function checkInfinitePay(orderId: number, transactionNsu = "", slug = "") {
  const handle = (process.env.INFINITEPAY_HANDLE || "").trim();
  if (!handle) return null;
  const response = await fetch("https://api.checkout.infinitepay.io/payment_check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle,
      order_nsu: String(orderId),
      ...(transactionNsu ? { transaction_nsu: transactionNsu } : {}),
      ...(slug ? { slug } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}

export async function applyInfinitePayStatus(orderId: number, payload: Record<string, unknown>) {
  const paid = Boolean(payload.paid);
  const transactionNsu = String(payload.transaction_nsu || "");
  const receiptUrl = String(payload.receipt_url || "");
  const paymentMethod = String(payload.capture_method || payload.payment_method || "");
  const slug = String(payload.slug || payload.invoice_slug || "");

  return transaction(async (client) => {
    const result = await client.query<{
      id: number; customer_id: number | null; payment_status: string; stock_returned: boolean; loyalty_counted: boolean; total: number;
    }>("SELECT id, customer_id, payment_status, stock_returned, loyalty_counted,total::FLOAT FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const order = result.rows[0];
    if (!order) return false;
    if (order.payment_status === "pago" && !order.stock_returned) return true;
    if (order.payment_status === "pago" && order.stock_returned && !paid) return true;
    const chargedAmount = Number(payload.amount || 0);
    const expectedAmount = Math.round(Number(order.total) * 100);
    if (paid && (!Number.isInteger(chargedAmount) || chargedAmount !== expectedAmount)) {
      await client.query(
        "INSERT INTO payment_logs (order_id,payment_id,status,raw_payload) VALUES ($1,$2,'amount_mismatch',$3::JSONB)",
        [orderId, transactionNsu, JSON.stringify(payload)],
      );
      return false;
    }
    if (paid && transactionNsu) {
      const duplicate = await client.query("SELECT id FROM orders WHERE transaction_nsu=$1 AND id<>$2", [transactionNsu, orderId]);
      if (duplicate.rows[0]) return false;
    }

    const stockCommitted = paid ? await commitStock(client, orderId) : !order.stock_returned;

    await client.query(
      `UPDATE orders SET payment_status = $2, payment_method = $3, transaction_nsu = $4,
              payment_slug = $5, payment_id = $4, visible_to_admin = CASE WHEN $2 = 'pago' THEN TRUE ELSE visible_to_admin END,
              stock_returned = CASE WHEN $2 = 'pago' AND $6 THEN FALSE ELSE stock_returned END,
              status = CASE WHEN $2 = 'pago' AND $6 THEN 'pendente' ELSE status END,
              paid_at = CASE WHEN $2 = 'pago' THEN NOW() ELSE paid_at END, updated_at = NOW()
        WHERE id = $1`,
      [orderId, paid ? "pago" : "aguardando_pagamento", paymentMethod, transactionNsu, slug, stockCommitted],
    );
    await client.query(
      "INSERT INTO payment_logs (order_id, payment_id, status, raw_payload) VALUES ($1,$2,$3,$4::JSONB)",
      [orderId, transactionNsu, paid ? (stockCommitted ? "paid" : "paid_stock_conflict") : "pending", JSON.stringify({ ...payload, receipt_url: receiptUrl })],
    );
    if (paid && stockCommitted && order.customer_id) await processOrderLoyalty(client, orderId);
    if (paid) {
      void notifyN8n({
        event: "order.paid",
        source: "payment_webhook",
        order: {
          id: orderId,
          payment_status: "pago",
          status: "pendente",
          total: Number(order.total),
        },
      });
    }
    return paid;
  });
}
