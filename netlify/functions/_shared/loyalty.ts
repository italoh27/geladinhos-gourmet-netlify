import { HttpError } from "./http";
import { transaction, type DbClient } from "./db";

type Tier = 5 | 7;

async function refreshTier(client: DbClient, customerId: number, tier: Tier) {
  const totals = await client.query<{ purchased: number; delivered: number }>(
    `SELECT
       COALESCE(SUM(quantity) FILTER (WHERE tier=$2 AND kind IN ('purchase','adjustment','reversal')),0)::INTEGER purchased,
       COALESCE(SUM(quantity) FILTER (WHERE tier=$2 AND kind='reward_delivered'),0)::INTEGER delivered
     FROM loyalty_movements WHERE customer_id=$1`,
    [customerId, tier],
  );
  const purchased = Math.max(0, Number(totals.rows[0]?.purchased || 0));
  const delivered = Math.max(0, Number(totals.rows[0]?.delivered || 0));
  const progress = purchased % 10;
  const rewards = Math.max(0, Math.floor(purchased / 10) - delivered);
  const progressField = tier === 7 ? "progress_7" : "progress_5";
  const rewardsField = tier === 7 ? "rewards_7" : "rewards_5";
  await client.query("INSERT INTO loyalty_balances (customer_id) VALUES ($1) ON CONFLICT DO NOTHING", [customerId]);
  await client.query(
    `UPDATE loyalty_balances SET ${progressField}=$2,${rewardsField}=$3,updated_at=NOW() WHERE customer_id=$1`,
    [customerId, progress, rewards],
  );
  const pending = await client.query<{ quantity: number }>(
    "SELECT COALESCE(SUM(quantity),0)::INTEGER quantity FROM loyalty_notifications WHERE customer_id=$1 AND tier=$2 AND delivered=FALSE",
    [customerId, tier],
  );
  const pendingQuantity = Number(pending.rows[0]?.quantity || 0);
  if (pendingQuantity !== rewards) {
    await client.query("DELETE FROM loyalty_notifications WHERE customer_id=$1 AND tier=$2 AND delivered=FALSE", [customerId, tier]);
    if (rewards > 0) await client.query(
      "INSERT INTO loyalty_notifications (customer_id,tier,quantity) VALUES ($1,$2,$3)",
      [customerId, tier, rewards],
    );
  }
}

export async function processOrderLoyalty(client: DbClient, orderId: number) {
  const config = await client.query<{ loyalty_active: boolean }>("SELECT loyalty_active FROM store_config WHERE id=1");
  if (!config.rows[0]?.loyalty_active) return;
  const orderResult = await client.query<{ customer_id: number | null; loyalty_counted: boolean; payment_status: string; status: string }>(
    "SELECT customer_id,loyalty_counted,payment_status,status FROM orders WHERE id=$1 FOR UPDATE",
    [orderId],
  );
  const order = orderResult.rows[0];
  if (!order?.customer_id || order.loyalty_counted || order.payment_status !== "pago" || order.status === "cancelado") return;
  const items = await client.query<{ tier: Tier; quantity: number }>(
    `SELECT unit_price::INTEGER tier,SUM(quantity)::INTEGER quantity FROM order_items
      WHERE order_id=$1 AND unit_price IN (5,7) GROUP BY unit_price`,
    [orderId],
  );
  for (const item of items.rows) {
    await client.query(
      "INSERT INTO loyalty_movements (customer_id,order_id,tier,quantity,kind) VALUES ($1,$2,$3,$4,'purchase')",
      [order.customer_id, orderId, item.tier, item.quantity],
    );
    await refreshTier(client, order.customer_id, item.tier);
  }
  await client.query("UPDATE orders SET loyalty_counted=TRUE WHERE id=$1", [orderId]);
}

export async function reverseOrderLoyalty(client: DbClient, orderId: number) {
  const orderResult = await client.query<{ customer_id: number | null; loyalty_counted: boolean }>(
    "SELECT customer_id,loyalty_counted FROM orders WHERE id=$1 FOR UPDATE",
    [orderId],
  );
  const order = orderResult.rows[0];
  if (!order?.customer_id || !order.loyalty_counted) return;
  const purchases = await client.query<{ tier: Tier; quantity: number }>(
    "SELECT tier,SUM(quantity)::INTEGER quantity FROM loyalty_movements WHERE order_id=$1 AND kind='purchase' GROUP BY tier",
    [orderId],
  );
  for (const purchase of purchases.rows) {
    await client.query(
      "INSERT INTO loyalty_movements (customer_id,order_id,tier,quantity,kind) VALUES ($1,$2,$3,$4,'reversal')",
      [order.customer_id, orderId, purchase.tier, -Number(purchase.quantity)],
    );
    await refreshTier(client, order.customer_id, purchase.tier);
  }
  await client.query("UPDATE orders SET loyalty_counted=FALSE WHERE id=$1", [orderId]);
}

export async function setLoyaltyProgress(customerId: number, tier: Tier, progress: number) {
  if (!Number.isInteger(progress) || progress < 0 || progress > 9) throw new HttpError(400, "A contagem deve ficar entre 0 e 9.");
  await transaction(async (client) => {
    const customer = await client.query("SELECT id FROM customers WHERE id=$1", [customerId]);
    if (!customer.rows[0]) throw new HttpError(404, "Cliente não encontrado.");
    await client.query("INSERT INTO loyalty_balances (customer_id) VALUES ($1) ON CONFLICT DO NOTHING", [customerId]);
    const current = await client.query<{ progress_5: number; progress_7: number }>("SELECT progress_5,progress_7 FROM loyalty_balances WHERE customer_id=$1 FOR UPDATE", [customerId]);
    if (!current.rows[0]) throw new HttpError(404, "Cliente não encontrado.");
    const currentProgress = Number(tier === 7 ? current.rows[0].progress_7 : current.rows[0].progress_5);
    const delta = progress - currentProgress;
    if (delta) await client.query(
      "INSERT INTO loyalty_movements (customer_id,tier,quantity,kind) VALUES ($1,$2,$3,'adjustment')",
      [customerId, tier, delta],
    );
    await refreshTier(client, customerId, tier);
  });
}

export async function deliverLoyaltyReward(notificationId: number) {
  await transaction(async (client) => {
    const result = await client.query<{ customer_id: number; tier: Tier; quantity: number; delivered: boolean }>(
      "SELECT customer_id,tier,quantity,delivered FROM loyalty_notifications WHERE id=$1 FOR UPDATE",
      [notificationId],
    );
    const reward = result.rows[0];
    if (!reward || reward.delivered) throw new HttpError(404, "Brinde não encontrado ou já entregue.");
    await client.query(
      "INSERT INTO loyalty_movements (customer_id,tier,quantity,kind) VALUES ($1,$2,$3,'reward_delivered')",
      [reward.customer_id, reward.tier, reward.quantity],
    );
    await client.query("UPDATE loyalty_notifications SET delivered=TRUE,delivered_at=NOW() WHERE id=$1", [notificationId]);
    await refreshTier(client, reward.customer_id, reward.tier);
  });
}
