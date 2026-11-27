# RLS, segurança e LGPD

## Modelo de acesso

- `app.is_member(ws, min_role)` — membro ativo com papel ≥ mínimo (`owner > admin > member > viewer`).
- `app.can_read(ws, visibility, owner)` — membro **e** (`visibility = 'workspace'` **ou** dono).
- `app.can_write(ws, visibility, owner)` — `member+` **e** (dono **ou** admin em item compartilhado).
- Funções `security definer` com `search_path` fixo (evitam recursão de RLS em `workspace_members`).
- Workspace pessoal: trigger impede qualquer membro além do criador.
- Conversas/mensagens: sempre privadas ao titular, mesmo em workspace compartilhado.
- Tabelas server-only (tokens OAuth, estados OAuth, webhooks, e-mails, jobs, rate limits, admins, entregas, push): RLS ligada, sem grants para `anon`/`authenticated`.
- Auditoria do cliente: somente via `write_audit()` (ator forçado para `auth.uid()`).
- Super Admin: **sem** bypass de RLS de cliente; lê agregados via service role; cada página registra `admin.view`. Acesso de suporte a dados exige autorização temporária registrada no chamado (`data_access_granted_until`).

## Testes

`tests/db/rls.test.ts` (Postgres real em PGlite, migrations reais):
isolamento entre tenants (leitura, update, insert forjado), privado vs. compartilhado em família,
workspace pessoal invisível a membros da família, conversas privadas, storage sem acesso cruzado,
tabelas server-only negadas, super admin sem leitura de mensagens, RLS em 100% das tabelas.

## Aplicação

- Sessão validada com `supabase.auth.getUser()` (não confia só no cookie).
- Rate limit em Postgres (por usuário, conta e IP — `cf-connecting-ip`): login, cadastro, reset, chat, upload, OAuth, webhooks.
- Anti-CSRF: Server Actions (proteção nativa do Next.js) e checagem de `Origin` em rotas `fetch` mutáveis; OAuth com `state` de uso único + PKCE, vinculado ao usuário da sessão.
- Webhooks: HMAC (Meta `X-Hub-Signature-256`, Svix/Resend com janela de 5 min, billing `t=,v1=`) ou segredo compartilhado (Evolution, Brevo) em comparação de tempo constante; inválidos → 401 e registro **sem payload**.
- Tokens OAuth: AES-256-GCM (`OAUTH_ENCRYPTION_KEY`), revogação remove tokens locais.
- Uploads: lista de MIME, limite 10 MB, verificação de assinatura binária, nome sanitizado, bucket privado, URL assinada de 60 s. **Antivírus não implementado** (pendente de serviço).
- Headers: CSP restritiva, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- Prompt injection: system instruction declara conteúdo de terceiros como dado; catálogo de ferramentas estrito; ferramenta desconhecida falha sem efeito; ações sensíveis exigem confirmação humana.
- Custos: limites por plano (mensagens/tokens), teto global mensal (`GEMINI_MAX_MONTHLY_USD`) como circuit breaker, custo estimado por chamada em `ai_usage`.
- Segredos só em variáveis de servidor; nenhuma secret em `NEXT_PUBLIC_*`.
- Idempotência: `Idempotency-Key` em `POST /api/documents` e `POST /api/open-finance/items` (tabela `idempotency_keys`,
  só service role, 24 h). Mesma chave e corpo devolve a resposta gravada (`Idempotent-Replayed: true`); corpo diferente → 422;
  em processamento → 409; 5xx libera a chave. Lançamentos, mensagens, webhooks e importações têm dedupe próprio no banco.
- Exportações (CSV/XLSX/PDF): neutralização de fórmulas (CSV injection) e texto sempre como texto no XLSX.

## LGPD

Consentimentos versionados (`consent_records`), memória do assistente opt-in, exportação JSON
(`/api/account/export`), exclusão de conta com confirmação explícita (remove Storage + Auth + cascade),
retenção de conversas por workspace (`ai_retention_days`), mascaramento de PII no admin,
páginas de privacidade/termos como minutas para revisão jurídica, contato do encarregado via `NEXT_PUBLIC_DPO_EMAIL`.

## Backup e restauração

Supabase faz backups diários (planos pagos; PITR opcional). Antes de migrations destrutivas: `pg_dump`
do schema `public`. Restauração testada deve constar no RUNBOOK antes do lançamento.
