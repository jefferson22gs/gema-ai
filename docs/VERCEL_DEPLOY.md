# Deploy na Vercel

1. Importar o repositório GitHub na Vercel (framework Next.js detectado).
2. Variáveis em **Production** e **Preview** (separar projetos Supabase de preview e produção).
   Mínimo para o painel: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`.
   Demais conforme integrações (ver `.env.example`).
3. `NEXT_PUBLIC_*` são embutidas no build: após alterar, faça redeploy.
4. Cron: `vercel.json` agenda `/api/automations/dispatch` a cada 5 min (planos Hobby só permitem cron diário — use Pro ou agende via Supabase `pg_cron` + `pg_net` chamando a rota com `Authorization: Bearer <CRON_SECRET>`).
5. Supabase Auth → URL Configuration: Site URL = `NEXT_PUBLIC_APP_URL`; Redirect URLs: `<url>/auth/callback`.
6. Webhooks a cadastrar nos provedores:
   - Meta: `<url>/api/webhooks/meta` (verify token = `META_WEBHOOK_VERIFY_TOKEN`)
   - Evolution: `<url>/api/webhooks/evolution` com header `x-evo-secret` (definido por `evo.sh create`; variáveis via `evo.sh push-env`)
   - Whaileys: `<url>/api/webhooks/whaileys` (definido ao criar a instância com `wh.sh create`; variáveis via `wh.sh push-env`)
   - Resend: `<url>/api/webhooks/resend` · Brevo: `<url>/api/webhooks/brevo` (Authorization Bearer)
   - Billing: `<url>/api/webhooks/billing`
7. Verificar `GET /api/health` após o deploy.

Funções serverless da Vercel executam apenas requisições curtas. Sessões WhatsApp ficam no host Evolution.
