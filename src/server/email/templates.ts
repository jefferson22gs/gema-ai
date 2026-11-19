/** Templates transacionais em PT-BR. Conteúdo do usuário é sempre escapado. */
export type TemplateId =
  | "welcome"
  | "login_verification"
  | "billing_receipt"
  | "briefing"
  | "reminder"
  | "security_alert"
  | "integration_disconnected"
  | "weekly_summary";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, bodyText: string, cta?: { label: string; url: string }): { html: string; text: string } {
  const paragraphs = bodyText.split("\n").map((l) => (l.trim() ? `<p style="margin:0 0 10px">${escapeHtml(l)}</p>` : "")).join("");
  const button = cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="background:#B8A177;color:#111318;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(cta.label)}</a></p>`
    : "";
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#111318;font-family:Inter,Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#1C2530;border-radius:14px;color:#F5F3EE">
<tr><td style="padding:28px 32px 8px;font-size:13px;letter-spacing:.18em;color:#B8A177">GEMA AI</td></tr>
<tr><td style="padding:0 32px"><h1 style="font-size:20px;font-weight:600;margin:8px 0 16px">${escapeHtml(title)}</h1>${paragraphs}${button}</td></tr>
<tr><td style="padding:16px 32px 28px;font-size:12px;color:#9AA3AE">Você recebeu este e-mail porque possui conta no GEMA AI. Preferências de notificação em Configurações.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${title}\n\n${bodyText}${cta ? `\n\n${cta.label}: ${cta.url}` : ""}\n\n— GEMA AI`;
  return { html, text };
}

export function renderTemplate(id: TemplateId, data: Record<string, string>, appUrl: string): RenderedEmail {
  const name = data.name ? `, ${data.name}` : "";
  switch (id) {
    case "welcome":
      return { subject: "Bem-vindo ao GEMA AI", ...layout(`Boas-vindas${name}`, "Sua conta foi criada. Configure agenda, finanças e integrações no painel.", { label: "Abrir painel", url: `${appUrl}/app` }) };
    case "login_verification":
      return { subject: "Seu código de verificação", ...layout("Código de verificação", `Use o código ${data.code ?? ""} para confirmar. Ele expira em 10 minutos.\nSe não foi você, ignore este e-mail.`) };
    case "billing_receipt":
      return { subject: "Recibo da sua assinatura", ...layout("Recibo", `Plano: ${data.plan ?? ""}\nValor: ${data.amount ?? ""}\nPeríodo: ${data.period ?? ""}`, { label: "Ver assinatura", url: `${appUrl}/app/assinatura` }) };
    case "briefing":
      return { subject: `Seu briefing de ${data.date ?? "hoje"}`, ...layout("Briefing do dia", data.body ?? "", { label: "Ver no painel", url: `${appUrl}/app/briefings` }) };
    case "reminder":
      return { subject: `Lembrete: ${data.title ?? ""}`, ...layout("Lembrete", data.body ?? data.title ?? "", { label: "Abrir", url: `${appUrl}/app/notificacoes` }) };
    case "security_alert":
      return { subject: "Alerta de segurança da sua conta", ...layout("Atividade de segurança", data.body ?? "Detectamos uma alteração de segurança na sua conta.", { label: "Revisar", url: `${appUrl}/app/configuracoes` }) };
    case "integration_disconnected":
      return { subject: `Integração desconectada: ${data.integration ?? ""}`, ...layout("Integração desconectada", `A integração ${data.integration ?? ""} precisa ser reconectada.`, { label: "Reconectar", url: `${appUrl}/app/integracoes` }) };
    case "weekly_summary":
      return { subject: "Seu resumo semanal", ...layout("Resumo semanal", data.body ?? "", { label: "Ver relatório", url: `${appUrl}/app/financas` }) };
  }
}
