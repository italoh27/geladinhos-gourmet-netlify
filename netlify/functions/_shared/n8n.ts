type N8nOrderPayload = {
  event: "order.created" | "order.paid";
  source: "web" | "admin" | "payment_webhook";
  order: {
    id: number;
    customer_name?: string;
    customer_phone?: string;
    payment_status?: string;
    status?: string;
    total?: number;
    created_at?: string;
    items?: Array<{ name: string; quantity: number; total: number }>;
  };
};

function webhookUrl() {
  return (process.env.N8N_WEBHOOK_URL || "").trim();
}

export function n8nEnabled() {
  return Boolean(webhookUrl());
}

export async function notifyN8n(payload: N8nOrderPayload) {
  const url = webhookUrl();
  if (!url) return false;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
