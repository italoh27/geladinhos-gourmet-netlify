export function recoveryEmailEnabled() {
  return Boolean((process.env.RESEND_API_KEY || "").trim() && (process.env.EMAIL_FROM || "").trim());
}

export async function sendPasswordResetCode(to: string, customerName: string, code: string) {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.EMAIL_FROM || "").trim();
  if (!apiKey || !from) throw new Error("Recuperação por e-mail ainda não configurada.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "geladinhos-gourmet-netlify/1.0",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Código para recuperar sua senha",
      text: `Olá, ${customerName}! Seu código de recuperação é ${code}. Ele vale por 10 minutos. Se você não solicitou, ignore esta mensagem.`,
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Não foi possível enviar o e-mail de recuperação (${response.status}).`);
}

