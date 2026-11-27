 Testada | `src/server/ai/agents.ts` (13 agentes, roteamento, escopo de ferramentas); `tests/ai/approvals-agents.test.ts` (Super Admin edição: pendente) || migration `20261126000002_approvals.sql`; `tests/ai/approvals-agents.test.ts` || `financialHealth` com metodologia; `healthScore` retorna null sem dados || `projectCashflow`, `cashflowProjection`, ferramenta `cashflow_forecast` (backend; tela pendente) || `detectRecurring`, `recurring_candidates` (backend; tela pendente) || `simulatePayoff`, `compareDebtStrategies` (backend; tela pendente) || `goals`/`goal_contributions`; `tests/db/finance-core.test.ts` (backend; tela pendente) || `resultEffect`/`periodTotals`; `card_payment` não é despesa; dedupe `external_id`; testes 31–34 || `src/server/services/cards.ts`; `tests/db/finance-core.test.ts`, `tests/unit/finance-engine.test.ts` (backend; tela pendente) || migration `20261126000001_finance_core.sql`; `monthSummary` só realizados/pendentes; `tests/db/finance-core.test.ts` || `docs/COMPETITOR_ANALYSIS.md` (30 URLs, 80 recursos com evidência), `docs/FEATURE_MATRIX.md` || ID | Módulo | Descrição | Pri | Dep | Critério de aceitação | Status | Evidência / Teste | Commit | Bloqueio |
|---|---|---|---|---|---|---|---|---|---|
| F0-01 | Repo | Verificar push dos commits pendentes | P0 | — | `origin/main` = HEAD local | Testada | `git status -sb` sem ahead; `a6bb4d6` no remoto | a6bb4d6 | — |
| F0-02 | Continuidade | CLAUDE.md, BLOCKERS, IMPLEMENTATION_STATUS, EXECUTION_PLAN, CHANGELOG | P0 | — | Arquivos existem e são lidos no início da sessão | Implementada | arquivos na raiz | (este commit) | — |
| F0-03 | Benchmark | Análise pública do Meu Assessor + matriz | P0 | — | `docs/COMPETITOR_ANALYSIS.md` e `docs/FEATURE_MATRIX.md` com evidência por item | Implementada | `docs/COMPETITOR_ANALYSIS.md` (30 URLs, 80 recursos com evidência), `docs/FEATURE_MATRIX.md` | — | — |
| F0-04 | Docs | ERD, ROUTES, API, THREAT_MODEL, LGPD, COSTS, manuais, INTEGRATIONS | P1 | F0-03 | Docs refletem o código real | Pendente | — | — | — |

## Fase 1 — Fundação (multi-tenant, permissões, filas)
| ID | Módulo | Descrição | Pri | Dep | Critério | Status | Evidência / Teste | Commit | Bloqueio |
|---|---|---|---|---|---|---|---|---|---|
| F1-01 | Tenancy | Workspaces pessoal/família/empresa + RLS + isolamento | P0 | — | Testes de vazamento entre tenants | Testada | `tests/db/rls.test.ts` | 501404c | BLK-01 (real) |
| F1-02 | Tenancy | Tipo de workspace "profissional" | P1 | — | `kind = 'professional'` aceito, RLS igual | Testada | `kind = 'professional'` aceito (migration `20261127000003_roles_permissions.sql`) | — | — |
| F1-03 | Permissões | Papéis ampliados (gestor, financeiro, contador, colaborador, familiar) + permissões por módulo/ação | P0 | F1-01 | Matriz papel×módulo×ação aplicada no banco (função `app.can`) e testada | Testada | 8 papéis + `role_permissions` + `app.can(ws, módulo, ação)` com override por membro; políticas RESTRITIVAS por módulo; tela `/app/membros`; `tests/db/roles-invitations.test.ts` | — | — |
| F1-04 | Convites | Fluxo de convite por e-mail (token, expiração, aceite) | P0 | F1-03 | Convite aceito cria membership; token uso único; testes | Testada | Convite por token (hash, 7 dias, uso único, preso ao e-mail), `accept_invitation()` transacional, e-mail `workspace_invite`, página `/convite/[token]`; mesmos testes — envio real BLK-09 | — | BLK-09 (envio real) |
| F1-05 | Filas | Fila persistente genérica (`system_jobs`) com retry/backoff/DLQ e worker por cron | P0 | — | Job falho reprocessa com backoff e vai para `dead`; teste | Testada | `src/server/jobs/queue.ts` (dedupe, skip locked, backoff, DLQ, lock expirado) plugada no cron; `tests/integrations/queue.test.ts` | — | — |
| F1-06 | Idempotência | Tabela `idempotency_keys` genérica para APIs públicas/webhooks | P1 | F1-05 | Reenvio com mesma chave retorna resultado anterior | Testada | tests/db/idempotency.test.ts (8: replay, corpo diferente 422, em processamento 409, retomada, 5xx/exceção liberam, por usuário/escopo, expiração, sem acesso do cliente); aplicada em /api/documents e /api/open-finance/items; limpeza no cron | — | — |
| F1-07 | Segurança | MFA (TOTP Supabase) + página de segurança/dispositivos | P1 | — | Ativar/desativar TOTP; sessões listadas | Pendente | — | — | BLK-01 |
| F1-08 | UX | Command palette (Ctrl+K) + busca global | P1 | — | Busca em transações, tarefas, contatos, documentos, eventos sob RLS | Pendente | — | — | — |

## Fase 2 — WhatsApp
| ID | Módulo | Descrição | Pri | Dep | Critério | Status | Evidência / Teste | Commit | Bloqueio |
|---|---|---|---|---|---|---|---|---|---|
| WA-01 | Evolution | Adaptador token de instância + `x-evo-secret` + @lid + mídia base64 | P0 | — | Testes de contrato | Testada | `tests/integrations/evolution.test.ts` | a6bb4d6 | BLK-03 |
| WA-02 | Whaileys | Botões ✅ Confirmar/Cancelar, HMAC, dedupe | P0 | — | Testes de contrato | Testada | `tests/integrations/whaileys.test.ts` | 7009035 | BLK-03 |
| WA-03 | Meta Cloud | Adaptador oficial | P1 | — | Testes de contrato | Testada | `tests/integrations/whatsapp.test.ts` | 74610c2 | BLK-10 |
| WA-04 | Vinculação | Fluxo V3: usuário pede código no painel e ENVIA o código ao número oficial (inbound) — além do fluxo outbound existente | P0 | WA-01 | Código uso único, expira, limite de tentativas, conflito de número, auditoria; testes | Testada | migration `20261127000002_whatsapp_linking.sql`; `createLinkCode`/`consumeLinkCode` (uso único, 15 min, 5 falhas/h por número, conflito, troca de número, auditoria); UI em Integrações; `tests/integrations/whatsapp-linking.test.ts` — homologação real BLK-03 | — | — |
| WA-05 | Ingestão | Ingestão assíncrona via fila (responder 200 rápido, processar no worker) | P1 | F1-05 | Webhook só enfileira; worker processa; retry/DLQ | Testada | `acceptWebhook` verifica+deduplica+enfileira (`whatsapp.inbound`), rotas Evolution/Meta/Whaileys respondem 2xx rápido e drenam com `after()`; cron reprocessa; `tests/integrations/inbox.test.ts` | — | — |
| WA-06 | Mídia | PDF/planilha/documento recebidos → cofre documental + extração | P1 | DOC-02 | Documento recebido vira `documents` do titular | Pendente | — | — | BLK-04 |
| WA-07 | Inbox | Central de conversas ao vivo (modos IA/humano/copiloto/pausado, lock exclusivo, notas internas) | P1 | WA-05 | Humano assume ⇒ IA não responde; testes de exclusão mútua | Testada | migration `20261127000004_live_inbox.sql`; modos IA/humano/copiloto/pausado com `lock_version` (exclusão mútua), resposta humana, notas internas, suporte com concessão temporária+justificativa+auditoria; tela `/app/conversas`; `tests/integrations/inbox.test.ts` | — | — |
| WA-08 | Status | Status de envio/entrega/leitura (`messages.update`/`MESSAGES_UPDATE`) | P2 | WA-01 | Status gravado em `notification_deliveries`/mensagens | Pendente | — | — | BLK-03 |
| WA-09 | Privacidade | Configurar quais dados o WhatsApp pode exibir (ex.: ocultar saldos) | P1 | WA-04 | Ferramenta respeita preferência; teste | Testada | `channel_accounts.show_balances/transactions/documents` (padrão: saldos ocultos); executor bloqueia consultas sensíveis no WhatsApp sem permissão; mesmos testes | — | — |

## Fase 3 — IA, agentes, memória, aprovações
| ID | Módulo | Descrição | Pri | Dep | Critério | Status | Evidência / Teste | Commit | Bloqueio |
|---|---|---|---|---|---|---|---|---|---|
| AI-01 | Ferramentas | Registry Zod + executor com estados/idempotência/auditoria | P0 | — | Testes | Testada | `tests/ai/assistant.test.ts` | 501404c | BLK-04 |
| AI-02 | Risco | Classificação de risco 1–4 por ferramenta; nível 4 bloqueado; aprovação vinculada ao hash exato dos argumentos | P0 | AI-01 | Alterar argumentos invalida aprovação; nível 4 nunca executa; testes | Testada | migration `20261126000002_approvals.sql`; `tests/ai/approvals-agents.test.ts` | — | — |
| AI-03 | Aprovações | Central de aprovações (tela + API: aprovar/rejeitar/expirar, revalidação) | P0 | AI-02 | Tela lista pendências reais; ações auditadas | Implementada | Tela `/app/aprovacoes` (pendentes com risco/expiração, aprovar/rejeitar, histórico). Backend testado em `tests/ai/approvals-agents.test.ts`; E2E autenticado pendente (BLK-01) | — | — |
| AI-04 | Agentes | Catálogo de 13 agentes especializados (tabela `ai_agents` + versões), roteamento por intenção, subconjunto de ferramentas por agente | P0 | AI-01 | Orquestrador escolhe agente; agente só vê suas ferramentas; Super Admin edita prompt versionado | Testada | `src/server/ai/agents.ts` (13 agentes, roteamento, escopo de ferramentas); `tests/ai/approvals-agents.test.ts` (edição no Super Admin: pendente) | — | — |
| AI-05 | Orquestração | Planos multi-etapa (`execution_plans`), dependências, cancelamento, tracing | P1 | AI-04 | Pedido composto vira plano com passos e status; teste | Pendente | — | — | — |
| AI-06 | Memória | Memória com categorias, visualizar/corrigir/excluir/exportar, separação por workspace, pgvector | P1 | — | Memória só do titular+workspace; teste de contaminação | Pendente | — | — | BLK-04 (embeddings) |
| AI-07 | Custos | Model routing (modelo por agente/tarefa) + custo por agente | P1 | AI-04 | `ai_usage` com agente; Super Admin mostra custo por agente | Pendente | — | — | — |
| AI-08 | Voz | Resposta em áudio (TTS) e modo voz | P2 | — | Áudio gerado a partir de texto real | Pendente | — | — | BLK-04 |

## Fase 4 — Motor financeiro
| ID | Módulo | Descrição | Pri | Dep | Critério | Status | Evidência / Teste | Commit | Bloqueio |
|---|---|---|---|---|---|---|---|---|---|
| FIN-01 | Lançamentos | Receitas/despesas/orçamentos/categorias/CSV | P0 | — | Testes | Testada | `tests/db/rls.test.ts`, `assistant.test.ts` | 501404c | — |
| FIN-02 | Estados | Status ampliado: realizado/pendente/projetado/conciliado/cancelado/estornado + tipo transferência/estorno/reembolso | P0 | — | Constraints + cálculo exclui transferências próprias e cancelados; testes | Testada | migration `20261126000001_finance_core.sql`; `monthSummary` só realizados/pendentes; `tests/db/finance-core.test.ts` | — | — |
| FIN-03 | Cartões | Cartões, faturas (fechamento/vencimento), parcelamentos com parcelas futuras, limite usado/disponível, simulador | P0 | FIN-02 | Compra parcelada gera N parcelas nas faturas certas; pagamento de fatura não conta como despesa; testes | Testada | `src/server/services/cards.ts`; `tests/db/finance-core.test.ts`, `tests/unit/finance-engine.test.ts` (backend; tela pendente) | — | — |
| FIN-04 | Anti-duplicidade | Prevenção de dupla contabilização (transferência própria, pagamento de fatura, importação repetida, pendente→confirmada) | P0 | FIN-02 | Testes 31–34 do prompt | Testada | `resultEffect`/`periodTotals`; `card_payment` não é despesa; dedupe `external_id`; testes 31–34 | — | — |
| FIN-05 | Metas | Metas com contribuições, progresso, plano de contribuição | P0 | — | Cálculo determinístico; testes | Testada | `goals`/`goal_contributions`; `tests/db/finance-core.test.ts` (backend; tela pendente) | — | — |
| FIN-06 | Dívidas | Dívidas, simulação bola de neve vs avalanche | P1 | — | Simulação determinística testada | Testada | `simulatePayoff`, `compareDebtStrategies` (backend; tela pendente) | — | — |
| FIN-07 | Recorrências | Detecção de recorrências/assinaturas + variação de preço | P1 | FIN-02 | Sugestão a partir de histórico; confirmação; testes | Testada | `detectRecurring`, `recurring_candidates` (backend; tela pendente) | — | — |
| FIN-08 | Fluxo de caixa | Projeção diária/mensal (pendentes + recorrências + faturas) e simuladores | P0 | FIN-03 | Projeção verificável com hipóteses; testes | Testada | `projectCashflow`, `cashflowProjection`, ferramenta `cashflow_forecast` (backend; tela pendente) | — | — |
| FIN-09 | Saúde | Indicador de saúde financeira com metodologia transparente | P1 | FIN-08 | Fórmula documentada e testada; não é score de crédito | Testada | `financialHealth` com metodologia; `healthScore` retorna null sem dados (backend; tela pendente) | — | — |
| FIN-10 | Regras | Regras de categorização do usuário (aprendidas de correções) | P1 | — | Correção vira regra opcional; teste | Testada | tests/db/statement-import.test.ts (regra aprendida na correção, aplicada em importação e lançamento manual, tipo respeitado, isolada por workspace); seletor em Lançamentos | — | — |
| FIN-11 | Importação | Importar CSV/OFX com deduplicação | P1 | FIN-04 | OFX/CSV reimportado não duplica; teste | Testada | tests/unit/statement-import.test.ts (28: OFX SGML/XML, CSV BR, débito/crédito, ids estáveis), tests/db/statement-import.test.ts (prévia, idempotência, sobreposição, isolamento); /app/financas/importar | — | — |
| FIN-12 | Dashboard | Dashboard financeiro avançado com gráficos, filtros e modo privacidade | P0 | FIN-03 | Gráficos com dados reais; ocultar valores | Implementada | Telas `/app/financas/cartoes`, `/fluxo` (gráfico de saldo projetado + saúde + recorrências), `/planejamento` (metas e dívidas). E2E autenticado pendente (BLK-01) | — | — |
| FIN-13 | Relatórios | PDF/XLSX + proteção CSV injection | P1 | — | Exportação sem fórmula executável; teste | Testada | tests/unit/report-formats.test.ts (CSV injection, XLSX sem <f>, PDF xref/paginação/WinAnsi), tests/db/monthly-report.test.ts (regras de soma, RLS, permissão reports.export); XLSX validado com openpyxl e PDF renderizado com PyMuPDF; /app/financas/relatorios | — | — |
| PAT-01 | Patrimônio | Ativos, passivos, snapshots, patrimônio líquido | P1 | — | Cálculo testado | Testada | tests/unit/net-worth.test.ts (7), tests/db/patrimony.test.ts (6: sem dupla contagem banco×lançamentos e fatura, isolamento, fotografias); /app/financas/patrimonio; ferramentas net_worth/register_asset; fotografia mensal na fila | — | — |

## Fase 5 — Open Finance
| ID | Módulo | Descrição | Pri | Dep | Critério | Status | Evidência / Teste | Commit | Bloqueio |
|---|---|---|---|---|---|---|---|---|---|
| OF-01 | Arquitetura | `BankProvider` + schema (conexões, consentimentos, contas, snapshots, sync jobs/logs) + RLS | P0 | F1-05 | Migrations + testes de isolamento | Testada | migration `20261127000001_open_finance.sql` (conexões, contas, snapshots, logs, cursores; RLS e escrita só pelo servidor); `src/server/open-finance/types.ts` | — | — |
| OF-02 | Pluggy | Adaptador Pluggy (auth, connect token, items, accounts, transactions, webhooks) | P0 | OF-01 | Testes de contrato | Testada | `src/server/open-finance/pluggy.ts` (contrato da doc oficial 27/11/2026, /v2 por cursor, webhook HMAC); `tests/integrations/open-finance.test.ts` — sandbox real pendente (BLK-05) | — | BLK-05 |
| OF-03 | Sync | Sincronização inicial/incremental/paginada, idempotente, normalização para `transactions` | P0 | OF-02 | Reimportação não duplica; testes | Testada | `syncConnection` idempotente (pendente→postado, sem duplicar), fila `open_finance.sync` + varredura diária, tratamento de 429; mesmos testes | — | BLK-05 |
| OF-04 | Consentimentos | Central de bancos/consentimentos, revogação interrompe sync | P0 | OF-01 | Revogado ⇒ sync bloqueado; teste | Implementada | Tela `/app/financas/bancos` (saldo consolidado com data, consentimentos, sync, reconectar, revogar, histórico); revogação testada; E2E autenticado pendente (BLK-01/05) | — | BLK-05 |
| OF-05 | Belvo | Adaptador futuro (interface apenas) | P2 | OF-01 | Stub com status "Não implementado" | Pendente | Interface `BankProvider` pronta; flag `integration.belvo` desligada | — | — |

## Fase 6 — Produtividade e Google
| ID | Módulo | Descrição | Pri | Dep | Critério | Status | Evidência / Teste | Commit | Bloqueio |
|---|---|---|---|---|---|---|---|---|---|
| AG-01 | Agenda | Agenda local + Google Calendar OAuth + sync | P0 | — | Testes | Testada | `google.test.ts` | 74610c2 | BLK-07 |
| AG-02 | Agenda pública | Página pública de agendamento (disponibilidade sem expor detalhes, anti-duplicidade) | P1 | — | Reserva concorrente não duplica; testes | Pendente | — | — | — |
| AG-03 | Reuniões | Processar transcrição/áudio fornecido → resumo, decisões, tarefas | P1 | AI-04 | Tarefas criadas a partir de transcrição; teste | Pendente | — | — | BLK-04 |
| TSK-01 | Tarefas | Subtarefas/checklist, comentários, dependências, Kanban, visões Hoje/Semana/Atrasadas | P1 | — | Kanban persiste status; testes | Pendente | — | — | — |
| TSK-02 | Hábitos | Hábitos e registros | P2 | — | Streak calculado; teste | Pendente | — | — | — |
| SHOP-01 | Compras | Listas de compras compartilhadas | P1 | — | CRUD + compartilhamento família; testes | Pendente | — | — | — |
| DOC-01 | Documentos | Upload privado, URL assinada, extração com revisão | P0 | — | Testes | Testada | `rls.test.ts`, `config-billing.test.ts` | d27854d | BLK-01 |
| DOC-02 | Documentos | Pastas, vencimentos com alerta, busca textual/semântica | P1 | — | Vencimento gera alerta; busca sob RLS | Pendente | — | — | BLK-04 (semântica) |
| MAIL-01 | Gmail | OAuth Gmail (escopo mínimo) e detecção de boletos | P2 | — | Contrato testado | Pendente | — | — | BLK-07 |
| DRV-01 | Drive | Importar arquivo do Google Drive | P2 | — | Contrato testado | Pendente | — | — | BLK-07 |

## Fase 7 — Expansão (família, empresa, fiscal, pesquisa)
| ID | Módulo | Descrição | Pri | Dep | Critério | Status | Evidência / Teste | Commit | Bloqueio |
|---|---|---|---|---|---|---|---|---|---|
| FAM-01 | Família | Despesas compartilhadas com divisão e saldos entre membros | P1 | F1-03 | Divisão determinística; privacidade; testes | Pendente | — | — | — |
| BIZ-01 | CRM | Clientes/leads/pipeline/propostas | P1 | F1-03 | CRUD + pipeline; testes | Pendente | — | — | — |
| BIZ-02 | Empresa | Contas a pagar/receber, centros de custo, DRE gerencial | P1 | FIN-02 | DRE caixa vs competência testada | Pendente | — | — | — |
| PAY-01 | Cobranças | `PaymentProvider` + Asaas (cobrança PIX/boleto, webhook) + régua de cobrança | P1 | BIZ-01 | Testes de contrato | Pendente | — | — | BLK-06 |
| FIS-01 | Fiscal | `FiscalProvider` + rascunho/validação de NFS-e (sem emissão real) | P2 | BIZ-01 | Rascunho validado; emissão bloqueada sem provedor | Pendente | — | — | BLK-08 |
| RES-01 | Pesquisa | Agente de pesquisa com grounding e fontes obrigatórias | P1 | AI-04 | Resposta sem fonte é recusada; teste | Pendente | — | — | BLK-04/13 |
| TRV-01 | Viagens | Planejamento de viagem (roteiro, orçamento, checklist) | P2 | — | CRUD; testes | Pendente | — | — | — |

## Fase 8 — Proatividade
| ID | Módulo | Descrição | Pri | Dep | Critério | Status | Evidência / Teste | Commit | Bloqueio |
|---|---|---|---|---|---|---|---|---|---|
| AUT-01 | Automações | 5 modelos por ocorrência + outbox + quiet hours | P0 | — | Testes | Testada | `automations.test.ts` | 74610c2 | — |
| AUT-02 | Construtor | Gatilho→condições→ações genérico (JSON validado), simulação, versionamento, limites anti-loop | P1 | F1-05 | Regra criada por formulário executa; modo simulação não altera dados; testes | Pendente | — | — | — |
| AUT-03 | Novos gatilhos | Saldo baixo, gasto acima do padrão, fatura 80% do limite, documento vencendo, meta atingida | P1 | FIN-03, DOC-02 | Gatilhos testados | Pendente | — | — | — |
| INS-01 | Insights | Feed de insights persistido (origem, cálculo, confiança, dispensar/criar tarefa) | P1 | FIN-08 | Insight com origem rastreável; testes | Pendente | — | — | — |

## Fase 9 — Comercial
| ID | Módulo | Descrição | Pri | Dep | Critério | Status | Evidência / Teste | Commit | Bloqueio |
|---|---|---|---|---|---|---|---|---|---|
| SAAS-01 | Planos | Planos editáveis no Super Admin (preço não fixo no código), entitlements por módulo, cupons, add-ons | P0 | — | Plano criado no admin aparece em /planos; limites aplicados | Testada | tests/db/saas-plans.test.ts (11), whatsapp-linking (entitlement); /super-admin/planos edita preço/limites/recursos/cupons; /planos lê do banco | — | — |
| SAAS-02 | Billing | Asaas para assinaturas (checkout, webhook idempotente, upgrade/downgrade) | P1 | SAAS-01, PAY-01 | Testes de contrato | Pendente | — | — | BLK-06 |
| SAAS-03 | Custos | Custos de provedores configuráveis, custo por cliente/plano, margem, alertas | P1 | — | Cálculo testado; valores vindos de configuração | Pendente | — | — | — |
| ADM-01 | Super Admin | Agentes/prompts versionados, feature flags editáveis, health real | P1 | AI-04 | Edição auditada | Pendente | — | — | — |

## Fase 10 — Experiência
| ID | Módulo | Descrição | Pri | Dep | Critério | Status | Evidência / Teste | Commit | Bloqueio |
|---|---|---|---|---|---|---|---|---|---|
| UX-01 | Navegação | Barra mobile Início · Finanças · GEMA (central) · Agenda · Mais | P1 | — | E2E mobile | Implementada | Barra mobile Início · Finanças · GEMA AI (central destacado) · Agenda · Mais + página `/app/mais` | — | — |
| UX-02 | Tema | Tema automático (sistema) além de claro/escuro | P2 | — | Preferência persistida | Pendente | — | — | — |
| UX-03 | Demo | `/demo` interativo com dados fictícios isolados (sem banco real, sem envios) | P1 | — | Visitante navega módulos; nenhuma chamada externa; E2E | Testada | tests/unit/demo-scenario.test.ts (5); E2E /demo (axe, 0 requisições externas/API, interação nos 5 módulos); docs/screenshots/*-demo.png | — | — |
| UX-04 | Landing | Landing V3 (agentes, Open Finance, WhatsApp, família, empresas) sem métricas inventadas | P1 | — | E2E a11y | Testada | Landing com agentes, Open Finance, família, empresa e CTA /demo; tests/unit/marketing-claims.test.ts (14 páginas); E2E a11y das páginas públicas | — | — |
| UX-05 | Treinamento | Central "O que posso pedir ao GEMA?" + trilhas | P2 | AI-04 | Conteúdo ligado às ferramentas reais | Pendente | — | — | — |
| UX-06 | Push | UI de inscrição Web Push | P1 | — | Inscrição gravada em `push_subscriptions` | Pendente | — | — | — |
| APP-01 | Nativo | Preparação Capacitor + requisitos de lojas | P2 | — | Docs + config | Pendente | — | — | BLK-12 |

## Fase 11/12 — Homologação e comercial
| ID | Módulo | Descrição | Pri | Dep | Critério | Status | Evidência / Teste | Commit | Bloqueio |
|---|---|---|---|---|---|---|---|---|---|
| HML-01 | Fluxos A–P | Homologação ponta a ponta em staging | P0 | BLK-01..10 | Evidências por fluxo | Bloqueada externamente | — | — | BLK-01..10 |
| HML-02 | Segurança | Revisão independente (agente auditor) + correções | P0 | — | Achados resolvidos ou registrados | Pendente | — | — | — |
| HML-03 | Carga | Teste de carga em staging | P2 | HML-01 | Resultados documentados | Bloqueada externamente | — | — | BLK-01 |
