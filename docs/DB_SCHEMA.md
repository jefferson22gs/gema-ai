# Modelo de dados

Migrations em `supabase/migrations/` (ordem lexical):

| Arquivo | Conteúdo |
|---|---|
| `…01_foundation.sql` | schema `app`, `set_updated_at`, `role_rank` |
| `…02_identity_tenancy.sql` | profiles, plans, workspaces, workspace_members, invitations, subscriptions, billing_events, user_preferences, consent_records, platform_admins, audit_logs, feature_flags, support_cases; helpers `app.is_member/can_read/can_write`; trigger de novo usuário; `create_workspace()` |
| `…03_domain_core.sql` | contacts, calendar_events, calendar_sync_state, financial_accounts, categories, recurring_transactions, transactions, budgets, task_lists, projects, tasks, reminders |
| `…04_platform_ops.sql` | integrations, encrypted_oauth_tokens, oauth_states, channel_accounts, provider_webhook_events, conversations, messages, ai_tool_executions, ai_usage, automation_rules, automation_runs, notification_outbox, notification_deliveries, email_messages, push_subscriptions, documents, document_extractions, system_jobs, rate_limits + `rate_limit_hit()` |
| `…05_rls.sql` | RLS em todas as tabelas, políticas e `write_audit()` |
| `…06_storage_and_reference_data.sql` | bucket privado `documents` + políticas, planos, categorias globais, feature flags |
| `20261127000005_saas_plans.sql` | `plan_features` (catálogo de entitlements; `core` nunca bloqueia), colunas de plano (anual, teste, ativo, destaque, tipos de workspace), plano `business`, `coupons` (só service role), `plan_addons`/`subscription_addons`, `app.entitled()`, `app.plan_limit()` (plano + add-ons), trigger que sincroniza `workspaces.plan_id` com a assinatura, `create_workspace`/novo usuário com trial do plano |

## Convenções

- PK `uuid` (`gen_random_uuid()`), `created_at`/`updated_at` (`timestamptz`, trigger).
- Todo recurso de negócio: `workspace_id` + `owner_id` + `visibility` (`private` | `workspace`).
- Índices compostos por workspace (ex.: `transactions (workspace_id, occurred_on desc)`).
- Datas/horas em UTC; `profiles.timezone` (padrão `America/Sao_Paulo`) para apresentação e cálculo.
- Dinheiro em centavos `bigint`; datas de competência como `date`.
- Soft-delete (`deleted_at`) em transactions, contacts, documents, workspaces.
- `on delete cascade` a partir de `auth.users` → exclusão de conta remove dados do titular.

## Dedupe e idempotência

| Onde | Chave |
|---|---|
| Lançamentos, eventos, tarefas, contatos, lembretes | `unique (workspace_id, idempotency_key)` |
| Mensagens de canal | `unique (provider, provider_message_id)` |
| Execuções de ferramenta | `unique (workspace_id, idempotency_key)` |
| Webhooks válidos | `unique (provider, provider_event_id)` |
| Automações | `unique (rule_id, occurrence_key)` |
| Notificações | `unique (user_id, dedupe_key)` |
| E-mails | `unique (idempotency_key)` = hash(template+destinatário+evento) |
| Eventos Google | `unique (workspace_id, external_provider, external_id)` |
