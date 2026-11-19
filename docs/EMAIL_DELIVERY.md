# Entrega de e-mail

`EmailProvider` com `ResendProvider` (padrão) e `BrevoProvider` (secundário). Ordem: `EMAIL_PRIMARY_PROVIDER`.

## Garantias

1. **Idempotência**: chave = SHA-256(template | destinatário normalizado | evento). Reservada em `email_messages` antes do envio; repetição ⇒ `duplicate`, sem chamada ao provedor. Enviada como `Idempotency-Key` (Resend) e `X-Idempotency-Key` (Brevo).
2. **Fallback só em recusa comprovada** (`4xx` exceto 408/409/429): tenta o secundário com a mesma chave.
3. **Resultado ambíguo** (timeout, rede, `5xx`, `2xx` sem id): para, marca `ambiguous`, **não** reenvia; reconciliação via webhook.
4. Webhooks: `/api/webhooks/resend` (Svix) e `/api/webhooks/brevo` (Bearer secret) atualizam `delivered/bounced/failed` sem regredir `delivered`.

Templates PT-BR (`src/server/email/templates.ts`): boas-vindas, verificação, recibo, briefing, lembrete,
segurança, integração desconectada, resumo semanal. Conteúdo do usuário sempre escapado.
E-mails de autenticação (confirmação/reset) são enviados pelo **Supabase Auth** — configure SMTP do Resend no Supabase para usar o mesmo domínio.

DNS (SPF/DKIM/DMARC): ver `docs/DNS_CLOUDFLARE.md`.
