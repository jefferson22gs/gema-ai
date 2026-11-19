# Relatório de testes — 19/11/2026

Ambiente: Windows, Node 26.13, sem credenciais de provedores. Integrações externas testadas por
**mocks de contrato apenas nos testes**. Banco: Postgres real (PGlite/WASM) aplicando as migrations do repositório.

## Resultados

| Etapa | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | 0 erros, 0 avisos |
| Typecheck | `npm run typecheck` | 0 erros |
| Unit/integração/RLS | `npm test` | **101/101** (10 arquivos; 20/11/2026, inclui canal Whaileys) |
| Build | `npm run build` | sucesso, 61 rotas |
| E2E | `PW_CHANNEL=chrome npm run test:e2e` | **42/42** (desktop + Pixel 7) |
| Audit | `npm audit --omit=dev --audit-level=high` | 0 vulnerabilidades |

## Critérios de aceite

| # | Critério | Teste | Status |
|---|---|---|---|
| 1 | Cadastro cria workspace pessoal | `tests/db/rls.test.ts` (trigger em `auth.users`) | ✅ banco · login real pendente de Supabase |
| 2 | Isolamento entre tenants (API + RLS) | `rls.test.ts`, `automations.test.ts` (briefing de outro ws vazio) | ✅ |
| 3 | 2 despesas, sem duplicar no webhook repetido | `assistant.test.ts`, `whatsapp.test.ts` | ✅ |
| 4 | Áudio com 3 ações, estados independentes | `assistant.test.ts` | ✅ (modelo roteirizado) |
| 5 | Timezone e conflito não silencioso | `assistant.test.ts`, `time-money.test.ts` | ✅ |
| 6 | Google (mock) com confirmação e id externo | `assistant.test.ts`, `google.test.ts` | ✅ contrato · real pendente |
| 7 | Resend falha → Brevo; ambíguo não duplica | `email.test.ts` | ✅ contrato · real pendente |
| 8 | Webhook inválido rejeitado e logado | `whatsapp.test.ts`, `whaileys.test.ts` (+ Meta, Svix, billing) | ✅ |
| — | Whaileys: HMAC/anti-replay, dedupe por `key.id`, `fromMe`, LID, botões ✅ Confirmar, "2" cancela, áudio inline, sessão 409 | `whaileys.test.ts` | ✅ contrato · real pendente |
| 9 | Briefing só com dados autorizados, sem inventar | `automations.test.ts` | ✅ |
| 10 | Lembrete recorrente 1×/ocorrência com DST | `automations.test.ts`, `time-money.test.ts` | ✅ |
| 11 | Upload privado sem acesso cruzado | `rls.test.ts` (storage), `config-billing.test.ts` (MIME) | ✅ políticas · Storage real pendente |
| 12 | Superadmin sem mensagens pessoais | `rls.test.ts` | ✅ |
| 13 | E2E mobile+desktop, a11y, PWA | `tests/e2e/public.spec.ts` | ✅ páginas públicas e estados não configurados · fluxo autenticado pendente de Supabase de teste |
| 14 | Build/lint/typecheck | acima | ✅ |

## Não testado (exige ambiente real)
Login/cadastro reais no Supabase Auth, Storage real, chamadas reais ao Gemini, Resend, Brevo, Google,
Meta e Evolution, cron em produção, push no navegador, Docker do host Evolution.

Capturas do ambiente de teste: `docs/screenshots/`.
