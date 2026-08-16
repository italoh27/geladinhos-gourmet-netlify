import type { Config } from "@netlify/functions";
import { randomBytes, randomInt, createHash } from "node:crypto";
import { body, cleanText, HttpError, json, money, noContent, normalizeEmail, normalizePhone, only, positiveInt, safeError } from "./_shared/http";
import { clearSessionCookie, createSession, deleteSession, getSession, hashPassword, requireAdmin, requireCustomer, verifyPassword } from "./_shared/auth";
import { query, transaction } from "./_shared/db";
import { getOrder, releaseExpiredReservations, returnStock } from "./_shared/orders";
import { applyInfinitePayStatus, checkInfinitePay, createInfinitePayCheckout, infinitePayEnabled } from "./_shared/payment";
import { recoveryEmailEnabled, sendPasswordResetCode } from "./_shared/email";
import { deliverLoyaltyReward, processOrderLoyalty, reverseOrderLoyalty, setLoyaltyProgress } from "./_shared/loyalty";

type StoreConfig = {
  id: number;
  store_name: string;
  store_open: boolean;
  require_registration: boolean;
  require_address: boolean;
  infinitepay_active: boolean;
  payment_before_order: boolean;
  manual_pix_active: boolean;
  whatsapp_support_active: boolean;
  loyalty_active: boolean;
  delivery_enabled: boolean;
  free_delivery: boolean;
  delivery_fee: string | number;
  whatsapp_number: string;
  pix_key: string;
  pix_name: string;
  pix_bank: string;
  admin_password_hash: string;
};

type CartInput = { flavorId: number; quantity: number };
type CheckoutInput = {
  items: CartInput[];
  name?: string;
  phone?: string;
  email?: string;
  address?: {
    postalCode?: string; street?: string; number?: string; neighborhood?: string;
    city?: string; complement?: string; reference?: string;
  };
};

function routePath(request: Request) {
  return decodeURIComponent(new URL(request.url).pathname).replace(/^\/api\/?/, "/").replace(/\/$/, "") || "/";
}

function ensureSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "Origem não autorizada.");
}

async function storeConfig(client?: { query: typeof query }) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run("SELECT * FROM store_config WHERE id = 1");
  if (!rows[0]) throw new Error("Configuração da loja não encontrada.");
  return rows[0] as StoreConfig;
}

function publicConfig(config: StoreConfig) {
  return {
    storeName: config.store_name,
    open: config.store_open,
    requireRegistration: config.require_registration,
    requireAddress: config.require_registration && config.require_address,
    infinitePayActive: config.infinitepay_active && infinitePayEnabled(),
    paymentBeforeOrder: config.payment_before_order,
    manualPixActive: config.manual_pix_active,
    whatsappSupportActive: config.whatsapp_support_active && config.store_open,
    loyaltyActive: config.loyalty_active,
    deliveryEnabled: config.delivery_enabled,
    freeDelivery: config.free_delivery,
    deliveryFee: config.free_delivery ? 0 : Number(config.delivery_fee),
    whatsappNumber: config.whatsapp_number,
    pix: config.manual_pix_active ? { key: config.pix_key, name: config.pix_name, bank: config.pix_bank } : null,
  };
}

function publicCustomer(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session?.customer_id) return null;
  return {
    id: Number(session.customer_id),
    name: session.customer_name || "",
    phone: session.customer_phone || "",
    email: session.customer_email || "",
  };
}

function normalizeFlavor(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    name: String(row.name),
    price: Number(row.price),
    stock: Number(row.stock),
    active: Boolean(row.active),
    imageUrl: String(row.image_url || ""),
  };
}

function normalizeOrder(order: Record<string, unknown> | null) {
  if (!order) return null;
  return {
    id: Number(order.id),
    token: String(order.public_token || ""),
    customerId: order.customer_id ? Number(order.customer_id) : null,
    customer: {
      name: String(order.customer_name || ""), phone: String(order.customer_phone || ""), email: String(order.customer_email || ""),
    },
    address: {
      postalCode: String(order.postal_code || ""), street: String(order.street || ""), number: String(order.number || ""),
      neighborhood: String(order.neighborhood || ""), city: String(order.city || ""),
      complement: String(order.complement || ""), reference: String(order.reference || ""),
    },
    status: String(order.status),
    paymentStatus: String(order.payment_status),
    paymentMethod: String(order.payment_method || ""),
    paymentLink: String(order.payment_link || ""),
    subtotal: Number(order.subtotal),
    deliveryFee: Number(order.delivery_fee),
    total: Number(order.total),
    stockReturned: Boolean(order.stock_returned),
    stockConflict: String(order.payment_status) === "pago" && Boolean(order.stock_returned),
    reservationExpiresAt: order.reservation_expires_at || null,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: Array.isArray(order.items) ? order.items : [],
  };
}

async function canViewOrder(request: Request, order: Record<string, unknown>) {
  const session = await getSession(request);
  if (session?.is_admin) return true;
  if (session?.customer_id && Number(order.customer_id) === Number(session.customer_id)) return true;
  return new URL(request.url).searchParams.get("token") === String(order.public_token);
}

async function whatsappForOrder(order: Record<string, unknown>) {
  const config = await storeConfig();
  if (String(order.payment_status) !== "pago" && config.payment_before_order) return "";
  const number = String(config.whatsapp_number || "").replace(/\D/g, "");
  if (!number) return "";
  const normalized = normalizeOrder(order)!;
  const lines = normalized.items.map((item: { quantity: number; name: string }) => `• ${item.quantity}x ${item.name}`);
  const message = [
    `🍦 *Pedido #${normalized.id} pago*`,
    `Cliente: ${normalized.customer.name}`,
    `Telefone: ${normalized.customer.phone}`,
    "",
    ...lines,
    "",
    `Total: R$ ${normalized.total.toFixed(2).replace(".", ",")}`,
  ].join("\n");
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

async function handleStore(request: Request) {
  only(request, "GET");
  await releaseExpiredReservations();
  const [config, flavors, session] = await Promise.all([
    storeConfig(),
    query("SELECT * FROM flavors WHERE active = TRUE ORDER BY name"),
    getSession(request),
  ]);
  return json({
    config: publicConfig(config),
    flavors: flavors.rows.map((row) => normalizeFlavor(row)),
    customer: publicCustomer(session),
  });
}

async function handleRegister(request: Request) {
  only(request, "POST");
  const data = await body<{ name: string; phone: string; email: string; password: string }>(request);
  const name = cleanText(data.name, 80);
  if (name.length < 2) throw new HttpError(400, "Informe seu nome.");
  const phone = normalizePhone(data.phone);
  const email = normalizeEmail(data.email);
  const passwordHash = await hashPassword(String(data.password || ""));

  try {
    const result = await transaction(async (client) => {
      const created = await client.query<{ id: number; name: string; phone: string; email: string }>(
        "INSERT INTO customers (name, phone, email, password_hash) VALUES ($1,$2,$3,$4) RETURNING id,name,phone,email",
        [name, phone, email, passwordHash],
      );
      const session = await createSession(request, { customerId: Number(created.rows[0].id) }, client);
      return { customer: created.rows[0], session };
    });
    return json({ customer: result.customer }, { status: 201, headers: { "Set-Cookie": result.session.cookie } });
  } catch (error) {
    if (String(error).includes("unique")) throw new HttpError(409, "Telefone ou e-mail já cadastrado.");
    throw error;
  }
}

async function handleLogin(request: Request) {
  only(request, "POST");
  const data = await body<{ phone: string; password: string }>(request);
  const phone = normalizePhone(data.phone);
  const { rows } = await query<{ id: number; name: string; phone: string; email: string; password_hash: string }>(
    "SELECT id,name,phone,email,password_hash FROM customers WHERE phone = $1",
    [phone],
  );
  const customer = rows[0];
  if (!customer || !(await verifyPassword(String(data.password || ""), customer.password_hash))) {
    throw new HttpError(401, "Telefone ou senha incorretos.");
  }
  const session = await createSession(request, { customerId: Number(customer.id) });
  return json({ customer: { id: Number(customer.id), name: customer.name, phone: customer.phone, email: customer.email } }, { headers: { "Set-Cookie": session.cookie } });
}

async function handleAdminLogin(request: Request) {
  only(request, "POST");
  const data = await body<{ password: string }>(request);
  const config = await storeConfig();
  if (config.admin_password_hash) {
    if (!(await verifyPassword(String(data.password || ""), config.admin_password_hash))) throw new HttpError(401, "Senha administrativa incorreta.");
    const session = await createSession(request, { admin: true });
    return json({ ok: true }, { headers: { "Set-Cookie": session.cookie } });
  }
  const expected = process.env.ADMIN_PASSWORD || "";
  if (expected.length < 8) throw new Error("ADMIN_PASSWORD não configurada com segurança.");
  const receivedHash = createHash("sha256").update(String(data.password || "")).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  if (!receivedHash.equals(expectedHash)) throw new HttpError(401, "Senha administrativa incorreta.");
  const session = await createSession(request, { admin: true });
  return json({ ok: true }, { headers: { "Set-Cookie": session.cookie } });
}

async function handleAdminChangePassword(request: Request) {
  only(request, "POST");
  await requireAdmin(request);
  const data = await body<{ currentPassword: string; newPassword: string }>(request);
  const config = await storeConfig();
  let currentValid = false;
  if (config.admin_password_hash) currentValid = await verifyPassword(String(data.currentPassword || ""), config.admin_password_hash);
  else {
    const expected = process.env.ADMIN_PASSWORD || "";
    currentValid = expected.length >= 8 && createHash("sha256").update(String(data.currentPassword || "")).digest().equals(createHash("sha256").update(expected).digest());
  }
  if (!currentValid) throw new HttpError(400, "A senha administrativa atual está incorreta.");
  const passwordHash = await hashPassword(String(data.newPassword || ""));
  await query("UPDATE store_config SET admin_password_hash=$1,updated_at=NOW() WHERE id=1", [passwordHash]);
  return json({ ok: true });
}

async function handleLogout(request: Request) {
  only(request, "POST");
  await deleteSession(request);
  return noContent({ "Set-Cookie": clearSessionCookie(request) });
}

async function handleMe(request: Request) {
  only(request, "GET");
  const session = await getSession(request);
  return json({ customer: publicCustomer(session), admin: Boolean(session?.is_admin) });
}

function resetCodeHash(customerId: number, code: string) {
  const secret = process.env.SESSION_SECRET || "";
  if (secret.length < 24) throw new Error("SESSION_SECRET precisa ter pelo menos 24 caracteres.");
  return createHash("sha256").update(`${secret}:reset:${customerId}:${code}`).digest("hex");
}

async function handlePasswordResetRequest(request: Request) {
  only(request, "POST");
  if (!recoveryEmailEnabled()) throw new HttpError(503, "A recuperação automática ainda não foi configurada pela loja.");
  const data = await body<{ phone: string; email: string }>(request);
  const phone = normalizePhone(data.phone);
  const email = normalizeEmail(data.email);
  const customer = await query<{ id: number; name: string; email: string }>(
    "SELECT id,name,email FROM customers WHERE phone=$1 AND LOWER(email)=LOWER($2)",
    [phone, email],
  );
  const row = customer.rows[0];
  if (!row) return json({ ok: true, message: "Se os dados conferirem, o código chegará no e-mail cadastrado." });
  const recent = await query<{ created_at: string }>(
    "SELECT created_at FROM password_reset_tokens WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1",
    [row.id],
  );
  if (recent.rows[0] && Date.now() - new Date(recent.rows[0].created_at).getTime() < 60_000) {
    return json({ ok: true, message: "Se os dados conferirem, o código chegará no e-mail cadastrado." });
  }
  const code = String(randomInt(100000, 1000000));
  const tokenId = await transaction(async (client) => {
    await client.query("UPDATE password_reset_tokens SET used_at=NOW() WHERE customer_id=$1 AND used_at IS NULL", [row.id]);
    const created = await client.query<{ id: number }>(
      "INSERT INTO password_reset_tokens (customer_id,code_hash,expires_at) VALUES ($1,$2,NOW()+INTERVAL '10 minutes') RETURNING id",
      [row.id, resetCodeHash(row.id, code)],
    );
    return Number(created.rows[0].id);
  });
  try {
    await sendPasswordResetCode(row.email, row.name, code);
  } catch (error) {
    await query("UPDATE password_reset_tokens SET used_at=NOW() WHERE id=$1", [tokenId]);
    throw error;
  }
  return json({ ok: true, message: "Código enviado. Confira seu e-mail." });
}

async function handlePasswordResetConfirm(request: Request) {
  only(request, "POST");
  const data = await body<{ phone: string; email: string; code: string; password: string }>(request);
  const phone = normalizePhone(data.phone);
  const email = normalizeEmail(data.email);
  const code = cleanText(data.code, 6);
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, "Informe o código de 6 números.");
  const passwordHash = await hashPassword(String(data.password || ""));
  await transaction(async (client) => {
    const customers = await client.query<{ id: number }>(
      "SELECT id FROM customers WHERE phone=$1 AND LOWER(email)=LOWER($2) FOR UPDATE",
      [phone, email],
    );
    const customer = customers.rows[0];
    if (!customer) throw new HttpError(400, "Código inválido ou vencido.");
    const tokens = await client.query<{ id: number; code_hash: string; attempts: number }>(
      `SELECT id,code_hash,attempts FROM password_reset_tokens
       WHERE customer_id=$1 AND used_at IS NULL AND expires_at>NOW() ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [customer.id],
    );
    const token = tokens.rows[0];
    if (!token || token.code_hash !== resetCodeHash(customer.id, code)) {
      if (token) await client.query(
        "UPDATE password_reset_tokens SET attempts=attempts+1,used_at=CASE WHEN attempts+1>=5 THEN NOW() ELSE used_at END WHERE id=$1",
        [token.id],
      );
      throw new HttpError(400, "Código inválido ou vencido.");
    }
    await client.query("UPDATE customers SET password_hash=$2,updated_at=NOW() WHERE id=$1", [customer.id, passwordHash]);
    await client.query("UPDATE password_reset_tokens SET used_at=NOW() WHERE id=$1", [token.id]);
    await client.query("DELETE FROM auth_sessions WHERE customer_id=$1", [customer.id]);
  });
  return json({ ok: true, message: "Senha alterada. Você já pode entrar." });
}

async function handleChangePassword(request: Request) {
  only(request, "POST");
  const session = await requireCustomer(request);
  const data = await body<{ currentPassword: string; newPassword: string }>(request);
  const customer = await query<{ password_hash: string }>("SELECT password_hash FROM customers WHERE id=$1", [session.customer_id]);
  if (!customer.rows[0] || !(await verifyPassword(String(data.currentPassword || ""), customer.rows[0].password_hash))) {
    throw new HttpError(400, "A senha atual está incorreta.");
  }
  const passwordHash = await hashPassword(String(data.newPassword || ""));
  await query("UPDATE customers SET password_hash=$2,updated_at=NOW() WHERE id=$1", [session.customer_id, passwordHash]);
  return json({ ok: true });
}

async function handleCep(request: Request, cep: string) {
  only(request, "GET");
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) throw new HttpError(400, "CEP inválido.");
  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new HttpError(502, "Não foi possível consultar o CEP.");
  const data = (await response.json()) as Record<string, unknown>;
  if (data.erro) throw new HttpError(404, "CEP não encontrado.");
  return json({ postalCode: digits, street: data.logradouro || "", neighborhood: data.bairro || "", city: data.localidade || "", state: data.uf || "" });
}

async function handleCheckout(request: Request) {
  only(request, "POST");
  await releaseExpiredReservations();
  const data = await body<CheckoutInput>(request);
  const config = await storeConfig();
  if (!config.store_open) throw new HttpError(409, "A loja está fechada no momento.");

  const session = await getSession(request);
  if (config.require_registration && !session?.customer_id) throw new HttpError(401, "Cadastre-se ou entre para finalizar o pedido.");
  if (!Array.isArray(data.items) || !data.items.length) throw new HttpError(400, "Seu carrinho está vazio.");

  const grouped = new Map<number, number>();
  for (const item of data.items) {
    const id = positiveInt(item.flavorId, "Sabor");
    grouped.set(id, (grouped.get(id) || 0) + positiveInt(item.quantity));
  }
  const customerName = session?.customer_name || cleanText(data.name, 80);
  const customerPhone = session?.customer_phone || normalizePhone(data.phone);
  const customerEmail = session?.customer_email || (data.email ? normalizeEmail(data.email) : "");
  if (!customerName || customerName.length < 2) throw new HttpError(400, "Informe seu nome.");

  const address = data.address || {};
  const requireAddress = config.delivery_enabled && config.require_registration && config.require_address;
  const postalCode = cleanText(address.postalCode, 9).replace(/\D/g, "");
  const street = cleanText(address.street, 150);
  const number = cleanText(address.number, 20);
  const neighborhood = cleanText(address.neighborhood, 100);
  const city = cleanText(address.city, 100);
  if (requireAddress && (postalCode.length !== 8 || !street || !number || !neighborhood)) {
    throw new HttpError(400, "Informe CEP, rua, número e bairro para a entrega.");
  }

  const publicToken = randomBytes(24).toString("base64url");
  const orderId = await transaction(async (client) => {
    const ids = [...grouped.keys()];
    const selected = await client.query<{ id: number; name: string; price: string; stock: number; active: boolean; image_url: string }>(
      "SELECT id,name,price,stock,active,image_url FROM flavors WHERE id = ANY($1::BIGINT[]) FOR UPDATE",
      [ids],
    );
    if (selected.rows.length !== ids.length) throw new HttpError(409, "Um dos sabores não está mais disponível.");

    let subtotalCents = 0;
    for (const flavor of selected.rows) {
      const quantity = grouped.get(Number(flavor.id)) || 0;
      if (!flavor.active) throw new HttpError(409, `${flavor.name} está indisponível.`);
      if (Number(flavor.stock) < quantity) throw new HttpError(409, `Restam somente ${flavor.stock} unidade(s) de ${flavor.name}.`);
      subtotalCents += Math.round(Number(flavor.price) * 100) * quantity;
    }
    const deliveryFee = config.delivery_enabled && !config.free_delivery ? money(config.delivery_fee) : 0;
    const onlinePayment = config.infinitepay_active && infinitePayEnabled();
    const visible = !(config.payment_before_order && onlinePayment);
    const created = await client.query<{ id: number }>(
      `INSERT INTO orders (
        public_token,customer_id,customer_name,customer_phone,customer_email,postal_code,street,number,neighborhood,city,
        complement,reference,subtotal,delivery_fee,total,visible_to_admin,reservation_expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
        CASE WHEN $17 THEN NOW() + INTERVAL '15 minutes' ELSE NULL END) RETURNING id`,
      [
        publicToken, session?.customer_id || null, customerName, customerPhone, customerEmail,
        postalCode, street, number, neighborhood, city, cleanText(address.complement, 150), cleanText(address.reference, 150),
        subtotalCents / 100, deliveryFee, subtotalCents / 100 + deliveryFee, visible, onlinePayment,
      ],
    );
    const id = Number(created.rows[0].id);
    for (const flavor of selected.rows) {
      const quantity = grouped.get(Number(flavor.id)) || 0;
      const unitPrice = Number(flavor.price);
      await client.query("UPDATE flavors SET stock = stock - $2, updated_at = NOW() WHERE id = $1", [flavor.id, quantity]);
      await client.query(
        "INSERT INTO order_items (order_id,flavor_id,flavor_name,unit_price,quantity,line_total) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, flavor.id, flavor.name, unitPrice, quantity, unitPrice * quantity],
      );
    }
    return id;
  });

  let checkoutUrl = "";
  if (config.infinitepay_active && infinitePayEnabled()) {
    try {
      checkoutUrl = await createInfinitePayCheckout(orderId);
    } catch (error) {
      await transaction(async (client) => returnStock(client, orderId, "cancelado"));
      throw error;
    }
  }
  const order = normalizeOrder((await getOrder(orderId)) as Record<string, unknown>);
  return json({ order, checkoutUrl, token: publicToken }, { status: 201 });
}

async function handleOrderStatus(request: Request, orderId: number) {
  only(request, "GET");
  await releaseExpiredReservations();
  let order = (await getOrder(orderId)) as Record<string, unknown> | null;
  if (!order || !(await canViewOrder(request, order))) throw new HttpError(404, "Pedido não encontrado.");
  const url = new URL(request.url);
  if (url.searchParams.get("refresh") === "1" && String(order.payment_status) === "aguardando_pagamento") {
    const payment = await checkInfinitePay(orderId, String(order.transaction_nsu || ""), String(order.payment_slug || ""));
    if (payment) await applyInfinitePayStatus(orderId, payment);
    order = (await getOrder(orderId)) as Record<string, unknown> | null;
  }
  return json({ order: normalizeOrder(order), whatsappUrl: order ? await whatsappForOrder(order) : "" });
}

async function handleCancelOrder(request: Request, orderId: number) {
  only(request, "POST");
  const order = (await getOrder(orderId)) as Record<string, unknown> | null;
  if (!order || !(await canViewOrder(request, order))) throw new HttpError(404, "Pedido não encontrado.");
  if (String(order.payment_status) === "pago") throw new HttpError(409, "Um pedido pago deve ser cancelado pela loja.");
  await transaction(async (client) => returnStock(client, orderId, "cancelado"));
  return json({ ok: true });
}

async function handleMyOrders(request: Request) {
  only(request, "GET");
  const session = await requireCustomer(request);
  await releaseExpiredReservations();
  const [{ rows }, loyalty] = await Promise.all([query(
    `SELECT o.*,
      COALESCE(JSON_AGG(JSON_BUILD_OBJECT('name',i.flavor_name,'price',i.unit_price::FLOAT,'quantity',i.quantity,'total',i.line_total::FLOAT)
        ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL),'[]') AS items
      FROM orders o LEFT JOIN order_items i ON i.order_id=o.id
      WHERE o.customer_id=$1 GROUP BY o.id ORDER BY o.created_at DESC LIMIT 100`,
    [session.customer_id],
  ), query<{ progress_5: number; progress_7: number; rewards_5: number; rewards_7: number }>(
    "SELECT progress_5,progress_7,rewards_5,rewards_7 FROM loyalty_balances WHERE customer_id=$1",
    [session.customer_id],
  )]);
  return json({
    orders: rows.map((row) => normalizeOrder(row)),
    loyalty: loyalty.rows[0] || { progress_5: 0, progress_7: 0, rewards_5: 0, rewards_7: 0 },
  });
}

async function handleWebhook(request: Request) {
  only(request, "POST");
  const payload = await body<Record<string, unknown>>(request);
  const orderId = Number(payload.order_nsu || payload.order_id || 0);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "Referência do pedido inválida.");
  const verified = await checkInfinitePay(orderId, String(payload.transaction_nsu || ""), String(payload.slug || payload.invoice_slug || ""));
  if (!verified) throw new HttpError(409, "Pagamento ainda não confirmado pela InfinitePay.");
  const applied = await applyInfinitePayStatus(orderId, verified);
  if (!applied && Boolean(verified.paid)) throw new HttpError(409, "O pagamento não corresponde ao pedido.");
  return json({ ok: true });
}

async function handleAdminOverview(request: Request) {
  only(request, "GET");
  await requireAdmin(request);
  await releaseExpiredReservations();
  const [config, flavors, orders, loyaltyProgress, counts, loyalty] = await Promise.all([
    storeConfig(),
    query("SELECT * FROM flavors ORDER BY active DESC,name"),
    query(
      `SELECT o.*,
        COALESCE(JSON_AGG(JSON_BUILD_OBJECT('name',i.flavor_name,'price',i.unit_price::FLOAT,'quantity',i.quantity,'total',i.line_total::FLOAT)
          ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL),'[]') AS items
       FROM orders o LEFT JOIN order_items i ON i.order_id=o.id
       WHERE o.visible_to_admin=TRUE GROUP BY o.id ORDER BY o.created_at DESC LIMIT 300`,
    ),
    query(
      `SELECT c.id customer_id,c.name,c.phone,
        COALESCE(b.progress_5,0)::INTEGER progress_5,COALESCE(b.progress_7,0)::INTEGER progress_7,
        COALESCE(b.rewards_5,0)::INTEGER rewards_5,COALESCE(b.rewards_7,0)::INTEGER rewards_7
       FROM customers c LEFT JOIN loyalty_balances b ON b.customer_id=c.id
       WHERE COALESCE(b.progress_5,0)>0 OR COALESCE(b.progress_7,0)>0 OR COALESCE(b.rewards_5,0)>0 OR COALESCE(b.rewards_7,0)>0
       ORDER BY GREATEST(COALESCE(b.progress_5,0),COALESCE(b.progress_7,0)) DESC,c.name`,
    ),
    query<{ total: number; paid: number; pending: number; cancelled: number; revenue: number }>(
      `SELECT COUNT(*)::INTEGER total,
        COUNT(*) FILTER (WHERE payment_status='pago')::INTEGER paid,
        COUNT(*) FILTER (WHERE payment_status='aguardando_pagamento')::INTEGER pending,
        COUNT(*) FILTER (WHERE status='cancelado')::INTEGER cancelled,
        COALESCE(SUM(total) FILTER (WHERE payment_status='pago'),0)::FLOAT revenue
       FROM orders WHERE visible_to_admin=TRUE`,
    ),
    query(
      `SELECT n.id,n.tier,n.quantity,n.created_at,c.id customer_id,c.name,c.phone
       FROM loyalty_notifications n JOIN customers c ON c.id=n.customer_id
       WHERE n.delivered=FALSE ORDER BY n.created_at DESC`,
    ),
  ]);
  return json({
    config: { ...publicConfig(config), pix: { key: config.pix_key, name: config.pix_name, bank: config.pix_bank } },
    flavors: flavors.rows.map((row) => normalizeFlavor(row)),
    orders: orders.rows.map((row) => normalizeOrder(row)),
    metrics: counts.rows[0],
    loyalty: loyalty.rows,
    loyaltyProgress: loyaltyProgress.rows,
  });
}

async function handleAdminOrderUpdate(request: Request, orderId: number) {
  await requireAdmin(request);
  if (request.method === "DELETE") {
    await transaction(async (client) => {
      const current = await client.query<{ loyalty_counted: boolean; stock_returned: boolean }>("SELECT loyalty_counted,stock_returned FROM orders WHERE id=$1 FOR UPDATE", [orderId]);
      if (!current.rows[0]) throw new HttpError(404, "Pedido não encontrado.");
      if (current.rows[0].loyalty_counted) await reverseOrderLoyalty(client, orderId);
      if (!current.rows[0].stock_returned) await returnStock(client, orderId, "cancelado");
      await client.query("DELETE FROM orders WHERE id=$1", [orderId]);
    });
    return noContent();
  }
  only(request, "PATCH");
  const data = await body<{
    status?: string; paymentStatus?: string; customerName?: string; customerPhone?: string;
    deliveryFee?: number; items?: CartInput[];
  }>(request);
  const allowedStatus = ["pendente", "em_preparacao", "saiu_entrega", "entregue", "cancelado"];
  const allowedPayment = ["aguardando_pagamento", "pago", "cancelado"];
  if (data.status && !allowedStatus.includes(data.status)) throw new HttpError(400, "Status inválido.");
  if (data.paymentStatus && !allowedPayment.includes(data.paymentStatus)) throw new HttpError(400, "Pagamento inválido.");
  await transaction(async (client) => {
    const current = await client.query<{ status: string; payment_status: string; loyalty_counted: boolean; stock_returned: boolean; subtotal: number; delivery_fee: number }>("SELECT status,payment_status,loyalty_counted,stock_returned,subtotal::FLOAT,delivery_fee::FLOAT FROM orders WHERE id=$1 FOR UPDATE", [orderId]);
    if (!current.rows[0]) throw new HttpError(404, "Pedido não encontrado.");
    if (data.items) {
      if (current.rows[0].status === "cancelado" || current.rows[0].stock_returned) throw new HttpError(409, "Reabra o pedido antes de editar seus itens.");
      if (!data.items.length) throw new HttpError(400, "O pedido precisa ter pelo menos um item.");
      if (current.rows[0].loyalty_counted) await reverseOrderLoyalty(client, orderId);
      await client.query(
        `UPDATE flavors f SET stock=f.stock+i.quantity,updated_at=NOW()
         FROM order_items i WHERE i.order_id=$1 AND i.flavor_id=f.id`,
        [orderId],
      );
      const grouped = new Map<number, number>();
      for (const item of data.items) grouped.set(positiveInt(item.flavorId, "Sabor"), (grouped.get(Number(item.flavorId)) || 0) + positiveInt(item.quantity));
      const selected = await client.query<{ id: number; name: string; price: string; stock: number; active: boolean }>(
        "SELECT id,name,price,stock,active FROM flavors WHERE id=ANY($1::BIGINT[]) FOR UPDATE",
        [[...grouped.keys()]],
      );
      if (selected.rows.length !== grouped.size) throw new HttpError(409, "Um dos sabores não foi encontrado.");
      let subtotal = 0;
      for (const flavor of selected.rows) {
        const quantity = grouped.get(Number(flavor.id)) || 0;
        if (!flavor.active || Number(flavor.stock) < quantity) throw new HttpError(409, `Estoque insuficiente de ${flavor.name}.`);
        subtotal += Number(flavor.price) * quantity;
      }
      await client.query("DELETE FROM order_items WHERE order_id=$1", [orderId]);
      for (const flavor of selected.rows) {
        const quantity = grouped.get(Number(flavor.id)) || 0;
        await client.query("UPDATE flavors SET stock=stock-$2,updated_at=NOW() WHERE id=$1", [flavor.id, quantity]);
        await client.query(
          "INSERT INTO order_items (order_id,flavor_id,flavor_name,unit_price,quantity,line_total) VALUES ($1,$2,$3,$4,$5,$6)",
          [orderId, flavor.id, flavor.name, Number(flavor.price), quantity, Number(flavor.price) * quantity],
        );
      }
      const fee = data.deliveryFee === undefined ? Number(current.rows[0].delivery_fee) : money(data.deliveryFee);
      await client.query("UPDATE orders SET subtotal=$2,delivery_fee=$3,total=$2+$3,updated_at=NOW() WHERE id=$1", [orderId, subtotal, fee]);
    } else if (data.deliveryFee !== undefined) {
      const fee = money(data.deliveryFee);
      await client.query("UPDATE orders SET delivery_fee=$2,total=subtotal+$2,updated_at=NOW() WHERE id=$1", [orderId, fee]);
    }
    const stopsCounting = data.status === "cancelado" || (data.paymentStatus && data.paymentStatus !== "pago");
    if (stopsCounting && current.rows[0].loyalty_counted) await reverseOrderLoyalty(client, orderId);
    if (data.status === "cancelado") await returnStock(client, orderId, "cancelado");
    await client.query(
      `UPDATE orders SET status=COALESCE($2,status),payment_status=COALESCE($3,payment_status),
        visible_to_admin=TRUE,paid_at=CASE WHEN $3='pago' THEN COALESCE(paid_at,NOW()) ELSE paid_at END,updated_at=NOW() WHERE id=$1`,
      [orderId, data.status || null, data.paymentStatus || null],
    );
    if (data.customerName !== undefined || data.customerPhone !== undefined) await client.query(
      "UPDATE orders SET customer_name=COALESCE($2,customer_name),customer_phone=COALESCE($3,customer_phone),updated_at=NOW() WHERE id=$1",
      [orderId, data.customerName === undefined ? null : cleanText(data.customerName, 80), data.customerPhone === undefined ? null : (data.customerPhone ? normalizePhone(data.customerPhone) : "")],
    );
    const effective = await client.query<{ status: string; payment_status: string }>("SELECT status,payment_status FROM orders WHERE id=$1", [orderId]);
    if (effective.rows[0]?.payment_status === "pago" && effective.rows[0]?.status !== "cancelado") await processOrderLoyalty(client, orderId);
  });
  return json({ order: normalizeOrder((await getOrder(orderId)) as Record<string, unknown>) });
}

async function handleAdminFlavor(request: Request, flavorId?: number) {
  await requireAdmin(request);
  if (request.method === "POST") {
    const data = await body<{ name: string; price: number; stock?: number; imageUrl?: string; active?: boolean }>(request);
    const name = cleanText(data.name, 100);
    if (!name) throw new HttpError(400, "Informe o nome do sabor.");
    const result = await query(
      "INSERT INTO flavors (name,price,stock,image_url,active) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [name, money(data.price), Math.max(0, Number(data.stock || 0)), cleanText(data.imageUrl, 300), data.active !== false],
    );
    return json({ flavor: normalizeFlavor(result.rows[0]) }, { status: 201 });
  }
  if (!flavorId) throw new HttpError(400, "Sabor inválido.");
  if (request.method === "PATCH") {
    const data = await body<{ name?: string; price?: number; stock?: number; imageUrl?: string; active?: boolean }>(request);
    const result = await query(
      `UPDATE flavors SET name=COALESCE($2,name),price=COALESCE($3,price),stock=COALESCE($4,stock),
        image_url=COALESCE($5,image_url),active=COALESCE($6,active),updated_at=NOW() WHERE id=$1 RETURNING *`,
      [
        flavorId, data.name === undefined ? null : cleanText(data.name, 100), data.price === undefined ? null : money(data.price),
        data.stock === undefined ? null : Math.max(0, Math.trunc(Number(data.stock))),
        data.imageUrl === undefined ? null : cleanText(data.imageUrl, 300), data.active === undefined ? null : Boolean(data.active),
      ],
    );
    if (!result.rows[0]) throw new HttpError(404, "Sabor não encontrado.");
    return json({ flavor: normalizeFlavor(result.rows[0]) });
  }
  throw new HttpError(405, "Método não permitido.");
}

async function handleAdminConfig(request: Request) {
  only(request, "PATCH");
  await requireAdmin(request);
  const data = await body<Record<string, unknown>>(request);
  const current = await storeConfig();
  const next = {
    storeName: data.storeName === undefined ? current.store_name : cleanText(data.storeName, 100),
    open: data.open === undefined ? current.store_open : Boolean(data.open),
    requireRegistration: data.requireRegistration === undefined ? current.require_registration : Boolean(data.requireRegistration),
    requireAddress: data.requireAddress === undefined ? current.require_address : Boolean(data.requireAddress),
    infinitePayActive: data.infinitePayActive === undefined ? current.infinitepay_active : Boolean(data.infinitePayActive),
    paymentBeforeOrder: data.paymentBeforeOrder === undefined ? current.payment_before_order : Boolean(data.paymentBeforeOrder),
    manualPixActive: data.manualPixActive === undefined ? current.manual_pix_active : Boolean(data.manualPixActive),
    whatsappSupportActive: data.whatsappSupportActive === undefined ? current.whatsapp_support_active : Boolean(data.whatsappSupportActive),
    loyaltyActive: data.loyaltyActive === undefined ? current.loyalty_active : Boolean(data.loyaltyActive),
    deliveryEnabled: data.deliveryEnabled === undefined ? current.delivery_enabled : Boolean(data.deliveryEnabled),
    freeDelivery: data.freeDelivery === undefined ? current.free_delivery : Boolean(data.freeDelivery),
    deliveryFee: data.deliveryFee === undefined ? Number(current.delivery_fee) : money(data.deliveryFee),
    whatsappNumber: data.whatsappNumber === undefined ? current.whatsapp_number : cleanText(data.whatsappNumber, 20).replace(/\D/g, ""),
    pixKey: data.pixKey === undefined ? current.pix_key : cleanText(data.pixKey, 180),
    pixName: data.pixName === undefined ? current.pix_name : cleanText(data.pixName, 120),
    pixBank: data.pixBank === undefined ? current.pix_bank : cleanText(data.pixBank, 100),
  };
  const result = await query(
    `UPDATE store_config SET store_name=$1,store_open=$2,require_registration=$3,require_address=$4,
      infinitepay_active=$5,payment_before_order=$6,manual_pix_active=$7,whatsapp_support_active=$8,
      loyalty_active=$9,delivery_enabled=$10,free_delivery=$11,delivery_fee=$12,whatsapp_number=$13,
      pix_key=$14,pix_name=$15,pix_bank=$16,updated_at=NOW() WHERE id=1 RETURNING *`,
    [
      next.storeName, next.open, next.requireRegistration, next.requireAddress,
      next.infinitePayActive, next.paymentBeforeOrder, next.manualPixActive, next.whatsappSupportActive,
      next.loyaltyActive, next.deliveryEnabled, next.freeDelivery, next.deliveryFee, next.whatsappNumber,
      next.pixKey, next.pixName, next.pixBank,
    ],
  );
  const saved = result.rows[0] as StoreConfig;
  return json({ config: { ...publicConfig(saved), pix: { key: saved.pix_key, name: saved.pix_name, bank: saved.pix_bank } } });
}

async function handleAdminCustomers(request: Request, customerId?: number) {
  await requireAdmin(request);
  if (request.method === "GET") {
    const { rows } = await query(
      `SELECT c.id,c.name,c.phone,c.email,c.created_at,COUNT(o.id)::INTEGER order_count,
        COALESCE(SUM(o.total) FILTER (WHERE o.payment_status='pago'),0)::FLOAT total_paid,
        COALESCE(b.progress_5,0)::INTEGER progress_5,COALESCE(b.progress_7,0)::INTEGER progress_7,
        COALESCE(b.rewards_5,0)::INTEGER rewards_5,COALESCE(b.rewards_7,0)::INTEGER rewards_7
       FROM customers c LEFT JOIN orders o ON o.customer_id=c.id LEFT JOIN loyalty_balances b ON b.customer_id=c.id
       GROUP BY c.id,b.customer_id ORDER BY c.created_at DESC`,
    );
    return json({ customers: rows });
  }
  if (request.method === "DELETE" && customerId) {
    await query("DELETE FROM customers WHERE id=$1", [customerId]);
    return noContent();
  }
  throw new HttpError(405, "Método não permitido.");
}

async function handleAdminLoyaltyProgress(request: Request, customerId: number) {
  only(request, "PATCH");
  await requireAdmin(request);
  const data = await body<{ progress5: number; progress7: number }>(request);
  await setLoyaltyProgress(customerId, 5, Number(data.progress5));
  await setLoyaltyProgress(customerId, 7, Number(data.progress7));
  const result = await query("SELECT * FROM loyalty_balances WHERE customer_id=$1", [customerId]);
  return json({ loyalty: result.rows[0] });
}

async function handleAdminLoyaltyDelivery(request: Request, notificationId: number) {
  only(request, "POST");
  await requireAdmin(request);
  await deliverLoyaltyReward(notificationId);
  return json({ ok: true });
}

async function handleAdminQuickOrder(request: Request) {
  only(request, "POST");
  await requireAdmin(request);
  const data = await body<{
    name?: string; phone?: string; paymentStatus?: string; status?: string; deliveryFee?: number; items: CartInput[];
  }>(request);
  if (!Array.isArray(data.items) || !data.items.length) throw new HttpError(400, "Adicione pelo menos um sabor.");
  const grouped = new Map<number, number>();
  for (const item of data.items) grouped.set(positiveInt(item.flavorId, "Sabor"), (grouped.get(Number(item.flavorId)) || 0) + positiveInt(item.quantity));
  const name = cleanText(data.name, 80) || "Cliente balcão";
  const phone = data.phone ? normalizePhone(data.phone) : "";
  const paymentStatus = data.paymentStatus === "pago" ? "pago" : "aguardando_pagamento";
  const status = ["pendente", "em_preparacao", "saiu_entrega", "entregue"].includes(String(data.status)) ? String(data.status) : "pendente";
  const deliveryFee = money(data.deliveryFee || 0);
  const orderId = await transaction(async (client) => {
    const ids = [...grouped.keys()];
    const selected = await client.query<{ id: number; name: string; price: string; stock: number; active: boolean }>(
      "SELECT id,name,price,stock,active FROM flavors WHERE id=ANY($1::BIGINT[]) FOR UPDATE",
      [ids],
    );
    if (selected.rows.length !== ids.length) throw new HttpError(409, "Um dos sabores não foi encontrado.");
    let subtotal = 0;
    for (const flavor of selected.rows) {
      const quantity = grouped.get(Number(flavor.id)) || 0;
      if (!flavor.active || Number(flavor.stock) < quantity) throw new HttpError(409, `Estoque insuficiente de ${flavor.name}.`);
      subtotal += Number(flavor.price) * quantity;
    }
    const customer = phone ? await client.query<{ id: number; email: string }>("SELECT id,email FROM customers WHERE phone=$1", [phone]) : { rows: [] };
    const created = await client.query<{ id: number }>(
      `INSERT INTO orders (public_token,customer_id,customer_name,customer_phone,customer_email,status,payment_status,
        payment_method,subtotal,delivery_fee,total,visible_to_admin,paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pedido_rapido_admin',$8,$9,$10,TRUE,CASE WHEN $7='pago' THEN NOW() ELSE NULL END) RETURNING id`,
      [randomBytes(24).toString("base64url"), customer.rows[0]?.id || null, name, phone, customer.rows[0]?.email || "", status, paymentStatus, subtotal, deliveryFee, subtotal + deliveryFee],
    );
    const id = Number(created.rows[0].id);
    for (const flavor of selected.rows) {
      const quantity = grouped.get(Number(flavor.id)) || 0;
      await client.query("UPDATE flavors SET stock=stock-$2,updated_at=NOW() WHERE id=$1", [flavor.id, quantity]);
      await client.query(
        "INSERT INTO order_items (order_id,flavor_id,flavor_name,unit_price,quantity,line_total) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, flavor.id, flavor.name, Number(flavor.price), quantity, Number(flavor.price) * quantity],
      );
    }
    if (paymentStatus === "pago" && customer.rows[0]?.id) await processOrderLoyalty(client, id);
    return id;
  });
  return json({ order: normalizeOrder((await getOrder(orderId)) as Record<string, unknown>) }, { status: 201 });
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

async function handleAdminExport(request: Request) {
  only(request, "GET");
  await requireAdmin(request);
  const url = new URL(request.url);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to") || "") ? url.searchParams.get("to") : null;
  const payment = ["pago", "aguardando_pagamento", "cancelado", "expirado"].includes(url.searchParams.get("payment") || "") ? url.searchParams.get("payment") : null;
  const result = await query(
    `SELECT o.id,o.created_at,o.status,o.payment_status,o.customer_name,o.customer_phone,o.postal_code,o.street,o.number,o.neighborhood,o.city,
      i.flavor_name,i.quantity,i.unit_price::FLOAT,i.line_total::FLOAT,o.delivery_fee::FLOAT,o.total::FLOAT,o.payment_method
     FROM orders o LEFT JOIN order_items i ON i.order_id=o.id
     WHERE ($1::DATE IS NULL OR o.created_at >= $1::DATE)
       AND ($2::DATE IS NULL OR o.created_at < $2::DATE + INTERVAL '1 day')
       AND ($3::TEXT IS NULL OR o.payment_status=$3)
     ORDER BY o.created_at DESC,i.id`,
    [from, to, payment],
  );
  const header = ["Pedido","Data","Status","Pagamento","Cliente","Telefone","CEP","Rua","Número","Bairro","Cidade","Sabor","Quantidade","Preço unitário","Subtotal item","Entrega","Total","Método"];
  const rows = result.rows.map((row) => [row.id,row.created_at,row.status,row.payment_status,row.customer_name,row.customer_phone,row.postal_code,row.street,row.number,row.neighborhood,row.city,row.flavor_name,row.quantity,row.unit_price,row.line_total,row.delivery_fee,row.total,row.payment_method]);
  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pedidos-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

async function route(request: Request) {
  ensureSameOrigin(request);
  const path = routePath(request);
  if (path === "/health") return json({ ok: true, service: "geladinhos-gourmet" });
  if (path === "/store") return handleStore(request);
  if (path === "/auth/register") return handleRegister(request);
  if (path === "/auth/login") return handleLogin(request);
  if (path === "/auth/admin-login") return handleAdminLogin(request);
  if (path === "/auth/logout") return handleLogout(request);
  if (path === "/auth/me") return handleMe(request);
  if (path === "/auth/password-reset/request") return handlePasswordResetRequest(request);
  if (path === "/auth/password-reset/confirm") return handlePasswordResetConfirm(request);
  if (path === "/auth/change-password") return handleChangePassword(request);
  if (path === "/orders/checkout") return handleCheckout(request);
  if (path === "/orders/mine") return handleMyOrders(request);
  if (path === "/payments/infinitepay/webhook") return handleWebhook(request);
  if (path === "/admin/overview") return handleAdminOverview(request);
  if (path === "/admin/config") return handleAdminConfig(request);
  if (path === "/admin/change-password") return handleAdminChangePassword(request);
  if (path === "/admin/flavors") return handleAdminFlavor(request);
  if (path === "/admin/customers") return handleAdminCustomers(request);
  if (path === "/admin/orders/quick") return handleAdminQuickOrder(request);
  if (path === "/admin/export.csv") return handleAdminExport(request);

  let match = path.match(/^\/cep\/(\d{8})$/);
  if (match) return handleCep(request, match[1]);
  match = path.match(/^\/orders\/(\d+)$/);
  if (match) return handleOrderStatus(request, Number(match[1]));
  match = path.match(/^\/orders\/(\d+)\/cancel$/);
  if (match) return handleCancelOrder(request, Number(match[1]));
  match = path.match(/^\/admin\/orders\/(\d+)$/);
  if (match) return handleAdminOrderUpdate(request, Number(match[1]));
  match = path.match(/^\/admin\/flavors\/(\d+)$/);
  if (match) return handleAdminFlavor(request, Number(match[1]));
  match = path.match(/^\/admin\/customers\/(\d+)$/);
  if (match) return handleAdminCustomers(request, Number(match[1]));
  match = path.match(/^\/admin\/loyalty\/customer\/(\d+)$/);
  if (match) return handleAdminLoyaltyProgress(request, Number(match[1]));
  match = path.match(/^\/admin\/loyalty\/notification\/(\d+)\/deliver$/);
  if (match) return handleAdminLoyaltyDelivery(request, Number(match[1]));
  throw new HttpError(404, "Rota não encontrada.");
}

export default async (request: Request) => {
  if (request.method === "OPTIONS") return noContent({ Allow: "GET,POST,PATCH,DELETE,OPTIONS" });
  try {
    return await route(request);
  } catch (error) {
    return safeError(error);
  }
};

export const config: Config = { path: "/api/*" };
