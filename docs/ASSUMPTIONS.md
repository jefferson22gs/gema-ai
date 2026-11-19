# Suposições e verificações

Data: 19/11/2026. Documentação consultada localmente (pacotes instalados), sem acesso às contas dos provedores.

| Tema | Verificado | Suposição / pendência |
|---|---|---|
| Next.js 16.4.6 | Docs em `node_modules/next/dist/docs`: Cache Components, `proxy.ts`, `connection()`, `refresh()`, `PageProps/LayoutProps/RouteContext` | — |
| `@google/genai` 3.6 | Tipos: `parametersJsonSchema`, `functionCalls`, `usageMetadata`, `responseJsonSchema`, `httpOptions.timeout` | Nome de modelo padrão `gemini-flash-latest` — confirmar o alias disponível na conta; preços por token configuráveis |
| `@supabase/ssr` 0.12 | API `getAll/setAll` | Projeto Supabase com `auth.uid()` lendo `request.jwt.claims` (padrão Supabase) |
| Conexão direta Postgres | — | Role usada no `DATABASE_URL` precisa poder `set role authenticated` e `service_role` (o usuário `postgres` do Supabase pode) |
| Evolution API v2 | Não testado | Endpoints `/message/sendText`, `/message/sendButtons`, `/message/sendMedia`, `/chat/getBase64FromMediaMessage`, `/instance/connectionState`, `/instance/logout` e header `apikey` conforme docs públicas da v2; payload `messages.upsert`. Validar contra a versão implantada |
| Meta Cloud API | Não testado | Graph `v21.0` (configurável no código); assinatura `X-Hub-Signature-256` |
| Resend | Não testado | `POST /emails`, header `Idempotency-Key`, webhooks Svix |
| Brevo | Não testado | `POST /v3/smtp/email`, header `api-key`; webhook autenticado por Bearer configurado no painel |
| Google | Não testado | Endpoints Calendar v3 / People v1 e OAuth padrão; app precisa de verificação para escopos sensíveis |
| Whaileys (motor próprio) | `GET /health` respondeu `ok` em 20/11/2026; API e formato do webhook conforme a skill `whaileys-integration` | Instância do GEMA ainda não criada; envio/recebimento reais não testados (testes com motor simulado) |
| AgendaFácil365 | Código não lido | Apenas contrato proposto |
| Preços dos planos | — | Valores de exemplo para validação comercial |
| Billing | — | Nenhum provedor escolhido; envelope genérico assinado |
