# Checklist de lançamento

Ordem recomendada: GitHub → Supabase → Vercel → Registro.br/Cloudflare → Resend/Brevo → Google OAuth → WhatsApp → Billing.

## Supabase
- [ ] Projeto de produção (região São Paulo) e projeto de preview separado
- [ ] `npx supabase db push` aplicado; conferir RLS ativa em todas as tabelas
- [ ] Auth: Site URL, Redirect URLs (`/auth/callback`), confirmação de e-mail ligada, SMTP próprio (Resend)
- [ ] Google provider no Auth (se login Google)
- [ ] Primeiro Super Admin inserido em `platform_admins`
- [ ] Backups/PITR conferidos; restauração testada em staging

## Vercel
- [ ] Variáveis de Production/Preview (ver `.env.example`)
- [ ] `CRON_SECRET` + cron ativo (plano Pro ou `pg_cron`)
- [ ] `GET /api/health` = ok

## Domínio
- [ ] Registro.br → nameservers Cloudflare; Vercel com `app.<dominio>`
- [ ] SPF/DKIM/DMARC para Resend e Brevo validados nos painéis
- [ ] WAF/rate limiting e Access para `wa.<dominio>/manager`

## Integrações
- [ ] Gemini: chave, modelo, preços e teto mensal
- [ ] Resend/Brevo: domínios verificados, webhooks com segredo
- [ ] Google: APIs habilitadas, tela de consentimento, **verificação do app**
- [ ] WhatsApp: Cloud API (preferencial) ou host Evolution com número dedicado; webhook com segredo; templates Meta
- [ ] VAPID para push (e UI de inscrição — pendente)
- [ ] Billing: escolher provedor, implementar checkout, testar webhooks em sandbox

## Jurídico / produto
- [ ] Revisão jurídica de Privacidade e Termos; definir encarregado (DPO) e `NEXT_PUBLIC_DPO_EMAIL`
- [ ] Confirmar marca "GEMA AI" e preços
- [ ] Teste E2E manual com conta real: cadastro, onboarding, despesa por chat, evento com conflito, WhatsApp verificado, e-mail de briefing
