# GEMA AI — Assessor Executivo Inteligente

SaaS multi-tenant (B2C/B2B), mobile-first, com painel web, PWA e WhatsApp, que organiza agenda,
finanças, tarefas, contatos, documentos e briefings por comandos em linguagem natural (Gemini).

> Nome de trabalho, sujeito a confirmação de marca e domínio.

## Stack

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript strict · Tailwind v4 · Zod ·
Supabase (Postgres, Auth, Storage, RLS) · Gemini API (`@google/genai`) · Resend + Brevo ·
WhatsApp (Cloud API Meta / Evolution API em host externo) · Google Calendar/People · Vercel · Cloudflare.

## Rodando localmente

```bash
npm ci
cp .env.example .env.local     # preencha o que tiver; o resto aparece como "Não configurado"
npm run dev                    # http://localhost:3000
```

Sem Supabase, o site público funciona e o painel mostra a instrução de configuração (sem dados falsos).

### Banco de dados

```bash
npx supabase link --project-ref <ref>
npx supabase db push           # aplica supabase/migrations/*.sql
```

`DATABASE_URL` deve apontar para o pooler do Supabase (modo transaction, porta 6543). O servidor
executa cada consulta de usuário com `set local role authenticated` + claims JWT — a RLS é aplicada
no banco, não só no código.

Para tornar alguém Super Admin (SQL Editor do Supabase):
```sql
insert into public.platform_admins (user_id) values ('<uuid do usuário>');
```

Dados de demonstração (rotulados `[DEMO]`, bloqueados em produção):
```bash
ALLOW_DEMO_SEED=true DATABASE_URL=... npm run db:seed:demo -- voce@exemplo.com
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | Gera tipos de rotas e roda `tsc --noEmit` |
| `npm test` | Vitest: unitários, integrações (mocks de contrato) e RLS em Postgres real (PGlite) |
| `npm run build` | Build de produção (não exige nenhuma chave) |
| `npm run test:e2e` | Playwright desktop + mobile, acessibilidade (axe) e PWA — requer `npm run build` antes |
| `npm run icons` | Regenera os ícones do PWA |

Localmente com Chrome instalado: `PW_CHANNEL=chrome npm run test:e2e`.

## Estrutura

```
src/app/(site)        site público e SEO
src/app/(auth)        login, cadastro, recuperação (Server Actions)
src/app/app           painel autenticado (/app/*)
src/app/super-admin   administração da plataforma (metadados agregados, auditado)
src/app/api           health, chat IA, webhooks, OAuth, cron, documentos, exportação
src/server/ai         registry de ferramentas (Zod), executor com estados, orquestrador Gemini
src/server/services   domínio: finanças, agenda, tarefas, contatos, lembretes, briefing, documentos
src/server/messaging  MessagingProvider (Meta, Whaileys, Evolution) e ingestão
src/server/email      EmailProvider (Resend, Brevo), templates PT-BR, fallback seguro
src/server/integrations/google  OAuth (PKCE/state), gateway Calendar/People, sync incremental
src/server/automations          motor de automações por ocorrência
src/server/notifications        outbox, entrega multicanal, quiet hours, push
supabase/migrations   schema, RLS, storage, dados de referência
infra/evolution       Docker Compose do host persistente do WhatsApp
tests/                db (RLS), ai, integrations, unit, e2e
docs/                 arquitetura, segurança, integrações, deploy, runbook, relatório de testes
```

## Documentação

Comece por [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) e [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md).
Estado real de cada integração: [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md).
