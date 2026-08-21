import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Loading, Notice } from "../components/Loading";
import { QuantityControl } from "../components/QuantityControl";
import { PasswordField } from "../components/PasswordField";
import { api, currency, dateTime, patch, post, remove } from "../lib/api";
import { localDemoStore } from "../lib/demo";
import { notifyStoreUpdated, useStore } from "../lib/store";
import type { Flavor, Order, StoreConfig } from "../lib/types";

type Metrics = { total: number; paid: number; pending: number; cancelled: number; revenue: number };
type CustomerRow = { id: number; name: string; phone: string; email: string; created_at: string; order_count: number; total_paid: number; progress_5: number; progress_7: number; rewards_5: number; rewards_7: number };
type LoyaltyRow = { id?: number; customer_id: number; name: string; phone: string; tier?: number; quantity?: number; progress_5?: number; progress_7?: number; rewards_5?: number; rewards_7?: number };
type Overview = { config: StoreConfig; flavors: Flavor[]; orders: Order[]; metrics: Metrics; loyalty: LoyaltyRow[]; loyaltyProgress: LoyaltyRow[] };
type Tab = "orders" | "quick" | "flavors" | "config" | "customers" | "analytics";
const statusLabel: Record<string, string> = { pendente: "Recebido", em_preparacao: "Em preparação", saiu_entrega: "Saiu para entrega", entregue: "Entregue", cancelado: "Cancelado" };
const localHost = () => ["localhost", "127.0.0.1"].includes(window.location.hostname);
const actionError = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback;
function metricsFromOrders(orders: Order[]): Metrics {
  return {
    total: orders.length,
    paid: orders.filter((order) => order.paymentStatus === "pago").length,
    pending: orders.filter((order) => order.paymentStatus === "aguardando_pagamento").length,
    cancelled: orders.filter((order) => order.status === "cancelado").length,
    revenue: orders.filter((order) => order.paymentStatus === "pago").reduce((sum, order) => sum + order.total, 0),
  };
}
function demoOverview(): Overview {
  const now = new Date().toISOString();
  const orders: Order[] = [
    [101,"Ana",38,"pago","em_preparacao"],[102,"Bruno",15,"aguardando_pagamento","pendente"],[103,"Carla",28,"pago","saiu_entrega"],
    [104,"Daniel",21,"pago","entregue"],[105,"Elisa",10,"cancelado","cancelado"],[106,"Felipe",35,"pago","pendente"],
  ].map(([id,name,total,payment,status], index) => ({ id:Number(id),token:`demo-${id}`,customerId:index+1,customer:{name:String(name),phone:"11999999999",email:`cliente${index+1}@exemplo.com`},address:{postalCode:"01001000",street:"Rua da Loja",number:String(index+10),neighborhood:"Centro",city:"São Paulo",complement:"",reference:""},status:status as Order["status"],paymentStatus:payment as Order["paymentStatus"],paymentMethod:"pix",paymentLink:"",subtotal:Number(total),deliveryFee:0,total:Number(total),stockReturned:payment==="cancelado",reservationExpiresAt:null,createdAt:now,updatedAt:now,items:[{flavorId:localDemoStore.flavors[index%localDemoStore.flavors.length].id,name:localDemoStore.flavors[index%localDemoStore.flavors.length].name,price:Number(total),quantity:1,total:Number(total)}]}));
  return { config:localDemoStore.config,flavors:localDemoStore.flavors,orders,metrics:{total:6,paid:4,pending:1,cancelled:1,revenue:122},loyalty:[{id:1,customer_id:1,name:"Ana",phone:"11999999999",tier:7,quantity:1}],loyaltyProgress:[{customer_id:1,name:"Ana",phone:"11999999999",progress_5:4,progress_7:8,rewards_5:0,rewards_7:1}] };
}

export function AdminPage() {
  const navigate = useNavigate();
  const { reload: reloadStore } = useStore();
  const [data, setData] = useState<Overview | null>(null);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [tab, setTab] = useState<Tab>("orders");
  const [filter, setFilter] = useState("todos");
  const [openOrder, setOpenOrder] = useState<Order | null>(null);
  const [editingOrder, setEditingOrder] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState(false);
  const dataRevision = useRef(0);

  const updateOverview = useCallback((updater: (current: Overview) => Overview) => {
    dataRevision.current += 1;
    setData((current) => current ? updater(current) : current);
  }, []);

  const load = useCallback(async (quiet = false) => {
    const revisionAtStart = dataRevision.current;
    try {
      const next = await api<Overview>("/admin/overview");
      if (revisionAtStart !== dataRevision.current) return;
      setData((current) => {
        if (quiet && notifications && current && next.metrics.total > current.metrics.total && "Notification" in window && Notification.permission === "granted") {
          new Notification("Novo pedido", { body: "Um novo pedido chegou na loja." });
        }
        return next;
      });
    } catch (reason) {
      if (localHost()) { setData(demoOverview()); setError(""); return; }
      const message = reason instanceof Error ? reason.message : "Não foi possível carregar o painel.";
      setError(message);
      if ((reason as { status?: number })?.status === 401) navigate("/admin/login");
    } finally { setLoading(false); }
  }, [navigate, notifications]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    api<{ admin: boolean }>("/auth/me").then((result) => {
      if (!result.admin) navigate("/admin/login", { replace: true });
    }).catch(() => navigate("/admin/login", { replace: true }));
  }, [navigate]);
  useEffect(() => { const timer = window.setInterval(() => void load(true), 10000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => {
    if (tab !== "customers" || customers.length) return;
    api<{ customers: CustomerRow[] }>("/admin/customers").then((result) => setCustomers(result.customers)).catch((reason) => { if (localHost()) setCustomers([{ id:1,name:"Ana",phone:"11999999999",email:"ana@exemplo.com",created_at:new Date().toISOString(),order_count:3,total_paid:75,progress_5:4,progress_7:8,rewards_5:0,rewards_7:1 }]); else setError(reason.message); });
  }, [tab, customers.length]);

  const visibleOrders = useMemo(() => (data?.orders || []).filter((order) => {
    if (filter === "pagos") return order.paymentStatus === "pago";
    if (filter === "nao_pagos") return order.paymentStatus === "aguardando_pagamento";
    if (filter === "cancelados") return order.status === "cancelado" || ["cancelado", "expirado"].includes(order.paymentStatus);
    return true;
  }), [data?.orders, filter]);

  async function updateOrder(order: Order, change: { status?: string; paymentStatus?: string }) {
    try {
      const result = await patch<{ order: Order }>(`/admin/orders/${order.id}`, change);
      updateOverview((current) => {
        const orders = current.orders.map((item) => item.id === order.id ? result.order : item);
        return { ...current, orders, metrics: metricsFromOrders(orders) };
      });
      notifyStoreUpdated();
      setOpenOrder(result.order);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o pedido."); }
  }

  async function enableNotifications() {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    setNotifications(permission === "granted");
  }

  if (loading) return <Loading label="Abrindo o painel" />;
  if (!data) return <section className="narrow-page"><Notice kind="error">{error}</Notice></section>;
  return (
    <section className="admin-page page-stack">
      <header className="admin-header glass-card">
        <div><span>Painel da loja</span><h1>{data.config.storeName}</h1><p>Um único estoque, todos os pedidos em um só lugar.</p></div>
        <div className="admin-header-actions"><button type="button" className={notifications ? "success-button" : "danger-button"} onClick={enableNotifications}>{notifications ? "Notificações ativadas" : "Ativar notificações"}</button><button type="button" className="ghost-button" onClick={async () => { try { await post("/auth/logout"); } finally { navigate("/admin/login"); } }}>Sair</button></div>
      </header>
      <label className="mobile-admin-actions">Ações do admin<select value={tab} onChange={(event) => setTab(event.target.value as Tab)}><option value="orders">Pedidos</option><option value="quick">Pedido rápido</option><option value="flavors">Gerenciamento de sabores</option><option value="config">Configurações</option><option value="customers">Clientes</option><option value="analytics">Análise de dados</option></select></label>
      <nav className="admin-tabs" aria-label="Áreas do painel">
        {(["orders", "quick", "flavors", "config", "customers", "analytics"] as Tab[]).map((item) => <button type="button" key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{({ orders: "Pedidos", quick: "Pedido rápido", flavors: "Gerenciamento de sabores", config: "Configurações", customers: "Clientes", analytics: "Análise de dados" } as Record<Tab,string>)[item]}</button>)}
      </nav>
      {error && <Notice kind="error">{error}</Notice>}

      {tab === "orders" && <>
        <div className="metrics-bar glass-card">
          {[
            ["todos", "Todos", data.metrics.total], ["nao_pagos", "Não pagos", data.metrics.pending],
            ["pagos", "Pagos", data.metrics.paid], ["cancelados", "Cancelados", data.metrics.cancelled],
          ].map(([key, label, value]) => <button type="button" key={String(key)} className={filter === key ? "active" : ""} onClick={() => setFilter(String(key))}><span>{label}</span><strong>{value}</strong></button>)}
        </div>
        <div className="admin-order-grid">
          {visibleOrders.map((order) => <button type="button" className={`admin-order-row glass-card ${order.paymentStatus === "pago" ? "paid" : ""}`} key={order.id} onClick={() => { setOpenOrder(order); setEditingOrder(false); }}><i /><span><strong>{order.customer.name}</strong><small>#{order.id} · {dateTime(order.createdAt)}</small></span><b>{currency(order.total)}</b></button>)}
        </div>
        {!visibleOrders.length && <Notice>Nenhum pedido neste filtro.</Notice>}
        {data.config.loyaltyActive && <LoyaltyManager notifications={data.loyalty} progress={data.loyaltyProgress} onReload={() => { dataRevision.current += 1; void load(); notifyStoreUpdated(); }} />}
      </>}

      {tab === "quick" && <QuickOrder flavors={data.flavors} onCreated={(order) => { updateOverview((current) => { const orders = [order, ...current.orders.filter((item) => item.id !== order.id)]; return { ...current, orders, metrics: metricsFromOrders(orders) }; }); notifyStoreUpdated(); setTab("orders"); void load(true); }} />}
      {tab === "flavors" && <FlavorManager flavors={data.flavors} onChange={(flavors) => { updateOverview((current) => ({ ...current, flavors })); notifyStoreUpdated(); }} />}
      {tab === "config" && <ConfigManager config={data.config} onChange={(config) => { updateOverview((current) => ({ ...current, config })); notifyStoreUpdated(); void reloadStore(); }} />}
      {tab === "customers" && <CustomerManager customers={customers} onChange={(rows) => { setCustomers(rows); notifyStoreUpdated(); }} />}
      {tab === "analytics" && <Analytics metrics={data.metrics} orders={data.orders} />}

      {openOrder && <dialog className="admin-order-dialog" open onClick={(event) => { if (event.target === event.currentTarget) { setOpenOrder(null); setEditingOrder(false); } }}>
        <article className="admin-order-detail glass-card">
          <header><div><span>Pedido #{openOrder.id}</span><h2>{openOrder.customer.name}</h2><p>{dateTime(openOrder.createdAt)}</p></div><button type="button" className="dialog-close" onClick={() => setOpenOrder(null)} aria-label="Fechar">×</button></header>
          <div className="detail-badges"><b className={`badge badge-${openOrder.paymentStatus}`}>{openOrder.paymentStatus.replaceAll("_", " ")}</b><b className="badge">{statusLabel[openOrder.status]}</b></div>
          <div className="detail-info"><p><span>Telefone</span><strong>{openOrder.customer.phone}</strong></p><p><span>Endereço</span><strong>{[openOrder.address.street, openOrder.address.number, openOrder.address.neighborhood, openOrder.address.city].filter(Boolean).join(", ") || "Não informado"}</strong></p></div>
          <div className="order-items">{openOrder.items.map((item, index) => <p key={`${item.name}-${index}`}><span>{item.quantity}× {item.name}</span><strong>{currency(item.total)}</strong></p>)}</div>
          <div className="grand-total"><span>Total</span><strong>{currency(openOrder.total)}</strong></div>
          <div className="status-actions"><button type="button" className={openOrder.paymentStatus === "pago" ? "active" : ""} onClick={() => void updateOrder(openOrder, { paymentStatus: openOrder.paymentStatus === "pago" ? "aguardando_pagamento" : "pago" })}>{openOrder.paymentStatus === "pago" ? "Marcar não pago" : "Marcar pago"}</button>{["pendente","em_preparacao","saiu_entrega","entregue"].map((status) => <button type="button" key={status} className={openOrder.status === status ? "active" : ""} onClick={() => void updateOrder(openOrder, { status })}>{statusLabel[status]}</button>)}<button type="button" className="danger-button" onClick={() => void updateOrder(openOrder, { status: "cancelado" })}>Cancelar</button></div>
          <div className="button-row"><button type="button" className="ghost-button" onClick={() => setEditingOrder((value) => !value)}>{editingOrder ? "Fechar edição" : "Editar pedido"}</button><button type="button" className="danger-button" onClick={async () => { if (!confirm(`Excluir definitivamente o pedido #${openOrder.id}?`)) return; setError(""); try { const removedId = openOrder.id; await remove(`/admin/orders/${removedId}`); updateOverview((current) => { const orders = current.orders.filter((item) => item.id !== removedId); return { ...current, orders, metrics: metricsFromOrders(orders) }; }); setOpenOrder(null); setEditingOrder(false); void load(true); } catch (reason) { setError(actionError(reason, "Não foi possível excluir o pedido.")); } }}>Excluir pedido</button></div>
          {editingOrder && <OrderEditor order={openOrder} flavors={data.flavors} onSave={(order) => { setOpenOrder(order); setEditingOrder(false); updateOverview((current) => { const orders = current.orders.map((item) => item.id === order.id ? order : item); return { ...current, orders, metrics: metricsFromOrders(orders) }; }); notifyStoreUpdated(); void load(true); }} />}
        </article>
      </dialog>}
    </section>
  );
}

function OrderEditor({ order, flavors, onSave }: { order: Order; flavors: Flavor[]; onSave: (order: Order) => void }) {
  const available = flavors.filter((flavor) => flavor.active);
  const [customerName, setCustomerName] = useState(order.customer.name);
  const [customerPhone, setCustomerPhone] = useState(order.customer.phone);
  const [deliveryFee, setDeliveryFee] = useState(order.deliveryFee);
  const [items, setItems] = useState(() => order.items.filter((item) => item.flavorId).map((item) => ({ flavorId: Number(item.flavorId), quantity: item.quantity })));
  const [error, setError] = useState("");
  return <section className="inline-order-editor">
    <h3>Editar dados e itens</h3>
    {error && <Notice kind="error">{error}</Notice>}
    <div className="manager-create"><input aria-label="Nome do cliente" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /><input aria-label="Telefone" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} /><label className="number-selector"><span>Valor da entrega</span><QuantityControl value={deliveryFee} min={0} max={999} step={0.5} formatValue={currency} label="Valor da entrega" onChange={setDeliveryFee} /></label></div>
    <div className="quick-items">{items.map((item, index) => <div className="quick-item" key={`${item.flavorId}-${index}`}><select value={item.flavorId} onChange={(event) => setItems(items.map((current, currentIndex) => currentIndex === index ? { ...current, flavorId: Number(event.target.value) } : current))}>{available.map((flavor) => <option key={flavor.id} value={flavor.id}>{flavor.name} · {currency(flavor.price)}</option>)}</select><QuantityControl value={item.quantity} min={1} max={999} onChange={(quantity) => setItems(items.map((current, currentIndex) => currentIndex === index ? { ...current, quantity } : current))} /><button className="danger-button" type="button" onClick={() => setItems(items.filter((_, currentIndex) => currentIndex !== index))}>Remover</button></div>)}</div>
    <div className="button-row"><button className="ghost-button" type="button" disabled={!available.length} onClick={() => setItems([...items, { flavorId: available[0]?.id || 0, quantity: 1 }])}>+ Adicionar sabor</button><button className="primary-button" type="button" onClick={async () => { setError(""); try { const result = await patch<{ order: Order }>(`/admin/orders/${order.id}`, { customerName, customerPhone, deliveryFee, items }); onSave(result.order); } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível editar o pedido."); } }}>Salvar pedido</button></div>
  </section>;
}

function QuickOrder({ flavors, onCreated }: { flavors: Flavor[]; onCreated: (order: Order) => void }) {
  const available = flavors.filter((flavor) => flavor.active);
  const [form, setForm] = useState({ name: "Cliente balcão", phone: "", paymentStatus: "aguardando_pagamento", status: "pendente", deliveryFee: 0 });
  const [items, setItems] = useState<Array<{ flavorId: number; quantity: number }>>([{ flavorId: available[0]?.id || 0, quantity: 1 }]);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    try { const result = await post<{ order: Order }>("/admin/orders/quick", { ...form, items }); onCreated(result.order); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível criar o pedido."); }
  }
  return <section className="manager glass-card"><div className="section-title"><div><span>Venda presencial</span><h2>Novo pedido rápido</h2></div></div>{error && <Notice kind="error">{error}</Notice>}<form className="auth-form" onSubmit={submit}><div className="manager-create"><input placeholder="Nome do cliente" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><input placeholder="Telefone (opcional)" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /><label className="number-selector"><span>Taxa de entrega</span><QuantityControl value={form.deliveryFee} min={0} max={999} step={0.5} formatValue={currency} label="Taxa de entrega" onChange={(deliveryFee) => setForm({ ...form, deliveryFee })} /></label><select value={form.paymentStatus} onChange={(event) => setForm({ ...form, paymentStatus: event.target.value })}><option value="aguardando_pagamento">Não pago</option><option value="pago">Pago</option></select><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="pendente">Recebido</option><option value="em_preparacao">Em preparação</option><option value="saiu_entrega">Saiu para entrega</option><option value="entregue">Entregue</option></select></div><div className="quick-items">{items.map((item, index) => <div className="quick-item" key={index}><select value={item.flavorId} onChange={(event) => setItems(items.map((current, currentIndex) => currentIndex === index ? { ...current, flavorId: Number(event.target.value) } : current))}>{available.map((flavor) => <option value={flavor.id} key={flavor.id}>{flavor.name} · {currency(flavor.price)} · estoque {flavor.stock}</option>)}</select><QuantityControl value={item.quantity} min={1} max={999} onChange={(quantity) => setItems(items.map((current, currentIndex) => currentIndex === index ? { ...current, quantity } : current))} /><button type="button" className="danger-button" onClick={() => setItems(items.filter((_, currentIndex) => currentIndex !== index))}>Remover</button></div>)}</div><div className="button-row"><button type="button" className="ghost-button" onClick={() => setItems([...items, { flavorId: available[0]?.id || 0, quantity: 1 }])}>+ Outra linha</button><button className="primary-button" disabled={!items.length}>Criar pedido</button></div></form></section>;
}

function LoyaltyManager({ notifications, progress, onReload }: { notifications: LoyaltyRow[]; progress: LoyaltyRow[]; onReload: () => void }) {
  const [error, setError] = useState("");
  return <section className="manager glass-card"><div className="section-title"><div><span>Campanha de fidelidade</span><h2>Clientes e brindes</h2></div><b>{notifications.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} pendente(s)</b></div>{error && <Notice kind="error">{error}</Notice>}{notifications.map((item) => <article className="loyalty-alert" key={item.id}><div><strong>{item.name}</strong><span>{item.quantity} brinde(s) de R$ {item.tier}</span></div><button type="button" className="success-button" onClick={async () => { setError(""); try { await post(`/admin/loyalty/notification/${item.id}/deliver`); onReload(); } catch (reason) { setError(actionError(reason, "Não foi possível marcar o brinde.")); } }}>Marcar entregue</button></article>)}<div className="loyalty-progress-list">{progress.map((item) => <LoyaltyProgressEditor key={item.customer_id} item={item} onReload={onReload} />)}</div>{!progress.length && <Notice>Nenhum cliente iniciou a campanha ainda.</Notice>}</section>;
}

function LoyaltyProgressEditor({ item, onReload }: { item: LoyaltyRow; onReload: () => void }) {
  const [progress5, setProgress5] = useState(Number(item.progress_5 || 0));
  const [progress7, setProgress7] = useState(Number(item.progress_7 || 0));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return <article><div><strong>{item.name}</strong><span>{item.phone}</span>{message && <small className="action-success">{message}</small>}{error && <small className="action-error">{error}</small>}</div><label className="number-selector"><span>R$ 5</span><QuantityControl value={progress5} min={0} max={9} label="Progresso de cinco reais" onChange={setProgress5} /></label><label className="number-selector"><span>R$ 7</span><QuantityControl value={progress7} min={0} max={9} label="Progresso de sete reais" onChange={setProgress7} /></label><button type="button" className="ghost-button" disabled={saving} onClick={async () => { setSaving(true); setError(""); setMessage(""); try { await patch(`/admin/loyalty/customer/${item.customer_id}`, { progress5, progress7 }); setMessage("Progresso salvo."); onReload(); } catch (reason) { setError(actionError(reason, "Não foi possível salvar.")); } finally { setSaving(false); } }}>{saving ? "Salvando..." : "Salvar"}</button></article>;
}

function FlavorManager({ flavors, onChange }: { flavors: Flavor[]; onChange: (flavors: Flavor[]) => void }) {
  const [draft, setDraft] = useState({ name: "", price: 5, stock: 0, imageUrl: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  async function create(event: FormEvent) {
    event.preventDefault();
    setCreating(true); setMessage(""); setError("");
    try {
      const result = await post<{ flavor: Flavor }>("/admin/flavors", draft);
      onChange([...flavors, result.flavor]);
      setDraft({ name: "", price: 5, stock: 0, imageUrl: "" });
      setMessage(`${result.flavor.name} foi adicionado.`);
    } catch (reason) { setError(actionError(reason, "Não foi possível adicionar o sabor.")); }
    finally { setCreating(false); }
  }
  function jumpTo(target: string) {
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return <section className="manager glass-card" id="flavor-manager-top">
    <div className="section-title"><div><span>Cardápio e estoque</span><h2>Gerenciamento de sabores</h2></div></div>
    <label className="mobile-flavor-actions">Ações do admin<select aria-label="Ir para um sabor" defaultValue="" onChange={(event) => { if (event.target.value) jumpTo(event.target.value); event.target.value = ""; }}><option value="" disabled>Selecione uma ação</option><option value="novo-sabor">Gerenciamento de sabores</option>{flavors.map((flavor) => <option key={flavor.id} value={`sabor-${flavor.id}`}>{flavor.name}</option>)}</select></label>
    {message && <Notice kind="success">{message}</Notice>}{error && <Notice kind="error">{error}</Notice>}
    <form className="manager-create" id="novo-sabor" onSubmit={create}>
      <input aria-label="Nome do novo sabor" placeholder="Nome do sabor" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
      <label className="number-selector"><span>Preço</span><QuantityControl value={draft.price} min={0} max={999} step={0.5} formatValue={currency} label="Preço do novo sabor" onChange={(price) => setDraft({ ...draft, price })} /></label>
      <label className="number-selector"><span>Estoque</span><QuantityControl value={draft.stock} min={0} max={9999} label="Estoque do novo sabor" onChange={(stock) => setDraft({ ...draft, stock })} /></label>
      <input aria-label="Caminho da imagem" placeholder="Caminho da imagem" value={draft.imageUrl} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} />
      <button className="primary-button" disabled={creating}>{creating ? "Adicionando..." : "Adicionar sabor"}</button>
    </form>
    <div className="flavor-manager-list">{flavors.map((flavor) => <FlavorEditor key={flavor.id} flavor={flavor} onSave={(next) => onChange(flavors.map((item) => item.id === next.id ? next : item))} />)}</div>
  </section>;
}

function FlavorEditor({ flavor, onSave }: { flavor: Flavor; onSave: (flavor: Flavor) => void }) {
  const [value, setValue] = useState(flavor);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return <article className="flavor-editor" id={`sabor-${value.id}`}>
    <img src={value.imageUrl} alt={value.name} width="64" height="64" />
    <label className="editor-field"><span>Nome</span><input aria-label={`Nome de ${value.name}`} value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} /></label>
    <label className="number-selector"><span>Preço</span><QuantityControl value={value.price} min={0} max={999} step={0.5} formatValue={currency} label={`Preço de ${value.name}`} onChange={(price) => setValue({ ...value, price })} /></label>
    <label className="number-selector"><span>Estoque</span><QuantityControl value={value.stock} min={0} max={9999} label={`Estoque de ${value.name}`} onChange={(stock) => setValue({ ...value, stock })} /></label>
    <label className="switch-line"><input type="checkbox" checked={value.active} onChange={(e) => setValue({ ...value, active: e.target.checked })} />Ativo</label>
    <button type="button" className="primary-button" disabled={saving} onClick={async () => { setSaving(true); setMessage(""); setError(""); try { const result = await patch<{ flavor: Flavor }>(`/admin/flavors/${value.id}`, value); onSave(result.flavor); setMessage("Salvo."); } catch (reason) { setError(actionError(reason, "Não foi possível salvar.")); } finally { setSaving(false); } }}>{saving ? "Salvando..." : "Salvar"}</button>
    {(message || error) && <small className={error ? "action-error editor-feedback" : "action-success editor-feedback"}>{error || message}</small>}
  </article>;
}

function ConfigManager({ config, onChange }: { config: StoreConfig; onChange: (config: StoreConfig) => void }) {
  const [value, setValue] = useState(config); const [saved, setSaved] = useState(false); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const toggles: Array<[keyof StoreConfig,string]> = [["open","Loja aberta"],["requireRegistration","Exigir cadastro"],["requireAddress","Exigir endereço"],["infinitePayActive","InfinitePay"],["paymentBeforeOrder","Criar pedido somente após pagamento"],["manualPixActive","Pix manual"],["whatsappSupportActive","Fale conosco"],["loyaltyActive","Campanha de fidelidade"],["deliveryEnabled","Realizar entrega"],["freeDelivery","Entrega grátis"]];
  return <section className="manager glass-card"><div className="section-title"><div><span>Operação única</span><h2>Configuração da loja</h2></div></div>{saved && <Notice kind="success">Configurações salvas.</Notice>}{error && <Notice kind="error">{error}</Notice>}<div className="config-list"><label>Nome da loja<input value={value.storeName} onChange={(e) => { setSaved(false); setValue({ ...value, storeName: e.target.value }); }} /></label><label className="config-message"><span>Mensagem quando a loja estiver fechada</span><textarea rows={3} value={value.closedMessage || ""} onChange={(e) => { setSaved(false); setValue({ ...value, closedMessage: e.target.value }); }} /></label>{toggles.map(([key,label]) => <label className="config-toggle" key={key}><span>{label}</span><input type="checkbox" checked={Boolean(value[key])} onChange={(e) => { setSaved(false); setValue({ ...value, [key]: e.target.checked }); }} /></label>)}<label className="number-selector"><span>Valor da entrega</span><QuantityControl value={value.deliveryFee} min={0} max={999} step={0.5} formatValue={currency} label="Valor da entrega" onChange={(deliveryFee) => { setSaved(false); setValue({ ...value, deliveryFee }); }} /></label><label>WhatsApp da loja<input value={value.whatsappNumber} onChange={(e) => { setSaved(false); setValue({ ...value, whatsappNumber: e.target.value }); }} /></label><label>Chave Pix<input value={value.pix?.key || ""} onChange={(e) => { setSaved(false); setValue({ ...value, pix: { key: e.target.value, name: value.pix?.name || "", bank: value.pix?.bank || "" } }); }} /></label><button type="button" className="primary-button" disabled={saving} onClick={async () => { setSaving(true); setSaved(false); setError(""); try { const result = await patch<{ config: StoreConfig }>("/admin/config", { ...value, pixKey: value.pix?.key || "", pixName: value.pix?.name || "", pixBank: value.pix?.bank || "" }); setValue(result.config); onChange(result.config); setSaved(true); } catch (reason) { setError(actionError(reason, "Não foi possível salvar as configurações.")); } finally { setSaving(false); } }}>{saving ? "Salvando..." : "Salvar configurações"}</button></div><AdminPasswordForm /></section>;
}

function AdminPasswordForm() {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return <section className="password-admin-section"><button type="button" className="ghost-button" onClick={() => setOpen((value) => !value)}>{open ? "Fechar alteração de senha" : "Alterar senha do admin"}</button>{open && <form className="auth-form" onSubmit={async (event) => { event.preventDefault(); setError(""); setMessage(""); if (values.newPassword !== values.confirm) { setError("A confirmação da senha não confere."); return; } try { await post("/admin/change-password", values); setMessage("Senha administrativa alterada."); setValues({ currentPassword: "", newPassword: "", confirm: "" }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível alterar a senha."); } }}>{error && <Notice kind="error">{error}</Notice>}{message && <Notice kind="success">{message}</Notice>}<label>Senha atual<PasswordField value={values.currentPassword} onChange={(event) => setValues({ ...values, currentPassword: event.target.value })} autoComplete="current-password" required /></label><label>Nova senha<PasswordField value={values.newPassword} onChange={(event) => setValues({ ...values, newPassword: event.target.value })} autoComplete="new-password" minLength={6} required /></label><label>Confirme a nova senha<PasswordField value={values.confirm} onChange={(event) => setValues({ ...values, confirm: event.target.value })} autoComplete="new-password" minLength={6} required /></label><button className="primary-button">Salvar nova senha</button></form>}</section>;
}

function CustomerManager({ customers, onChange }: { customers: CustomerRow[]; onChange: (customers: CustomerRow[]) => void }) {
  const [error, setError] = useState("");
  return <section className="manager glass-card"><div className="section-title"><div><span>Cadastros</span><h2>Clientes</h2></div><b>{customers.length}</b></div>{error && <Notice kind="error">{error}</Notice>}<div className="customer-admin-list">{customers.map((customer) => <article key={customer.id}><div><strong>{customer.name}</strong><span>{customer.phone} · {customer.email}</span></div><div><b>{customer.order_count} pedido(s)</b><strong>{currency(customer.total_paid)}</strong></div><button type="button" className="danger-button" onClick={async () => { if (!confirm(`Excluir o cadastro de ${customer.name}?`)) return; setError(""); try { await remove(`/admin/customers/${customer.id}`); onChange(customers.filter((item) => item.id !== customer.id)); } catch (reason) { setError(actionError(reason, "Não foi possível excluir o cliente.")); } }}>Excluir</button></article>)}</div></section>;
}

function Analytics({ metrics, orders }: { metrics: Metrics; orders: Order[] }) {
  const [filters, setFilters] = useState({ from: "", to: "", payment: "", registered: false });
  const filtered = useMemo(() => orders.filter((order) => {
    const date = order.createdAt.slice(0, 10);
    if (filters.from && date < filters.from) return false;
    if (filters.to && date > filters.to) return false;
    if (filters.payment && order.paymentStatus !== filters.payment) return false;
    if (filters.registered && !order.customerId) return false;
    return true;
  }), [orders, filters]);
  const paid = filtered.filter((order) => order.paymentStatus === "pago");
  const revenue = paid.reduce((sum, order) => sum + order.total, 0);
  const units = paid.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0);
  const flavorMap = new Map<string, { quantity: number; revenue: number }>();
  const dayMap = new Map<string, { orders: number; units: number; revenue: number }>();
  const debtorMap = new Map<string, { name: string; phone: string; total: number }>();
  for (const order of filtered) {
    const day = order.createdAt.slice(0, 10);
    const currentDay = dayMap.get(day) || { orders: 0, units: 0, revenue: 0 };
    currentDay.orders += 1; currentDay.units += order.items.reduce((sum, item) => sum + item.quantity, 0); currentDay.revenue += order.total; dayMap.set(day, currentDay);
    if (order.paymentStatus === "aguardando_pagamento") {
      const key = order.customer.phone || order.customer.name;
      const current = debtorMap.get(key) || { name: order.customer.name, phone: order.customer.phone, total: 0 };
      current.total += order.total; debtorMap.set(key, current);
    }
    if (order.paymentStatus === "pago") for (const item of order.items) {
      const current = flavorMap.get(item.name) || { quantity: 0, revenue: 0 };
      current.quantity += item.quantity; current.revenue += item.total; flavorMap.set(item.name, current);
    }
  }
  const exportQuery = new URLSearchParams({ ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}), ...(filters.payment ? { payment: filters.payment } : {}) }).toString();
  return <section className="manager glass-card"><div className="section-title"><div><span>Resultados</span><h2>Análise de dados</h2></div><b>{metrics.total} no histórico recente</b></div><div className="analytics-filters"><label>Data inicial<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label><label>Data final<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label><label>Pagamento<select value={filters.payment} onChange={(event) => setFilters({ ...filters, payment: event.target.value })}><option value="">Todos</option><option value="pago">Pagos</option><option value="aguardando_pagamento">Não pagos</option><option value="cancelado">Cancelados</option><option value="expirado">Expirados</option></select></label><label className="config-toggle"><span>Somente clientes cadastrados</span><input type="checkbox" checked={filters.registered} onChange={(event) => setFilters({ ...filters, registered: event.target.checked })} /></label><a className="success-button" href={`/api/admin/export.csv${exportQuery ? `?${exportQuery}` : ""}`}>Exportar para Excel</a></div><div className="analytics-grid"><article><span>Pedidos filtrados</span><strong>{filtered.length}</strong></article><article><span>Faturamento pago</span><strong>{currency(revenue)}</strong></article><article><span>Unidades vendidas</span><strong>{units}</strong></article><article><span>Ticket médio pago</span><strong>{currency(paid.length ? revenue / paid.length : 0)}</strong></article></div><div className="analytics-details"><article><h3>Sabores mais vendidos</h3>{[...flavorMap.entries()].sort((a,b) => b[1].quantity-a[1].quantity).map(([name,value]) => <p key={name}><span>{name}</span><strong>{value.quantity} · {currency(value.revenue)}</strong></p>)}</article><article><h3>Pedidos por dia</h3>{[...dayMap.entries()].sort((a,b) => b[0].localeCompare(a[0])).map(([day,value]) => <p key={day}><span>{new Date(`${day}T12:00:00`).toLocaleDateString("pt-BR")}</span><strong>{value.orders} pedidos · {value.units} unidades · {currency(value.revenue)}</strong></p>)}</article><article><h3>Valores pendentes</h3>{[...debtorMap.values()].sort((a,b) => b.total-a.total).map((value) => <p key={`${value.phone}-${value.name}`}><span>{value.name}</span><strong>{currency(value.total)}</strong></p>)}</article></div></section>;
}
