# GEMA AI — instruções para agentes (Claude Code)

Produto da **Código Base**. SaaS multi-tenant, PT-BR, Next.js 16 + Supabase + Gemini. Prompt mestre: V3.0 (26/11/2026).

## Retomar trabalho (obrigatório ao iniciar sessão)
1. Ler `IMPLEMENTATION_STATUS.md` (backlog com IDs e status) e `BLOCKERS.md`.
2. Ler `EXECUTION_PLAN.md` → seção "Próxima tarefa executável".
3. Continuar dali. **Não** replanejar do zero.
4. Antes de encerrar/compactar: atualizar status das tarefas, `CHANGELOG.md` e a "Próxima tarefa executável".

## Regras não negociáveis
- Nunca inventar dados, credenciais, preços ou resultados. Sem variável ⇒ UI "Não configurado". Mock só em teste.
- Status de tarefa: Pendente · Em implementação · Implementada · Testada · Homologada · Sandbox · Bloqueada externamente. "Homologada" só com evidência em ambiente real.
- Toda consulta de usuário: `db.asUser` (role `authenticated` + claims ⇒ RLS). `db.asService` só em webhooks/jobs/admin, sempre filtrando `workspace_id`.
- Nova tabela ⇒ RLS + teste de isolamento (`tests/db/`) no mesmo commit. Migrations só aditivas; nunca editar migration já publicada.
- Dinheiro em centavos (`bigint`); cálculo financeiro determinístico em `src/server/finance/` — a IA nunca calcula valores oficiais.
- Ferramentas de IA: Zod + nível de risco (1–4) em `src/server/ai/tools.ts`; nível ≥3 exige aprovação; nível 4 nunca executa autonomamente.
- Não tocar em outras instâncias da VM (Evolution/Whaileys compartilhadas). Ações de produção na VM, DNS, contratação, push: confirmar com o usuário (push já autorizado para `main`).
- Next.js 16: ler `node_modules/next/dist/docs/` antes de usar API do framework.

## Qualidade
`.claude/skills/gema-ai-conventions/scripts/quality-pipeline.ps1` antes de cada commit (lint, typecheck, vitest, build, E2E).
Commits PT-BR conventional + `Co-Authored-By: Claude Code <noreply@anthropic.com>`. Scan de segredos antes do push.

## Mapa de documentação
| Pedido no prompt V3 | Arquivo canônico |
|---|---|
| ARCHITECTURE | `docs/ARCHITECTURE.md` |
| DATABASE / ERD | `docs/DB_SCHEMA.md`, `docs/ERD.md` |
| SECURITY / THREAT_MODEL | `docs/RLS_AND_SECURITY.md`, `docs/THREAT_MODEL.md` |
| INTEGRATIONS | `docs/INTEGRATIONS.md` (índice) |
| ROADMAP / TEST_REPORT / ASSUMPTIONS | `docs/ROADMAP.md`, `docs/TEST_REPORT.md`, `docs/ASSUMPTIONS.md` |
| Backlog / status | `IMPLEMENTATION_STATUS.md` |
| Plano / próxima tarefa | `EXECUTION_PLAN.md` |
| Bloqueios externos | `BLOCKERS.md` |
| Histórico | `CHANGELOG.md` |
