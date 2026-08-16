import { query, transaction, type DbClient } from "./db";

export async function releaseExpiredReservations() {
  await transaction(async (client) => {
    const expired = await client.query<{ id: number }>(
      `SELECT id FROM orders
        WHERE payment_status = 'aguardando_pagamento'
          AND stock_returned = FALSE
          AND reservation_expires_at IS NOT NULL
          AND reservation_expires_at <= NOW()
        FOR UPDATE SKIP LOCKED`,
    );
    for (const order of expired.rows) {
      await returnStock(client, order.id, "expirado");
    }
  });
}

export async function returnStock(client: DbClient, orderId: number, paymentStatus: "cancelado" | "expirado" = "cancelado") {
  const order = await client.query<{ stock_returned: boolean }>("SELECT stock_returned FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
  if (!order.rows[0] || order.rows[0].stock_returned) return;
  await client.query(
    `UPDATE flavors f SET stock = f.stock + i.quantity, updated_at = NOW()
       FROM order_items i WHERE i.order_id = $1 AND i.flavor_id = f.id`,
    [orderId],
  );
  await client.query(
    `UPDATE orders SET stock_returned = TRUE, payment_status = $2,
            status = CASE WHEN status = 'entregue' THEN status ELSE 'cancelado' END, updated_at = NOW()
      WHERE id = $1`,
    [orderId, paymentStatus],
  );
}

export async function getOrder(orderId: number) {
  const { rows } = await query(
    `SELECT o.*,
            COALESCE(JSON_AGG(JSON_BUILD_OBJECT(
              'id', i.id, 'flavorId', i.flavor_id, 'name', i.flavor_name,
              'price', i.unit_price::FLOAT, 'quantity', i.quantity, 'total', i.line_total::FLOAT
            ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM orders o LEFT JOIN order_items i ON i.order_id = o.id
      WHERE o.id = $1 GROUP BY o.id`,
    [orderId],
  );
  return rows[0] || null;
}
