# Matriz de funcionalidades — Meu Assessor × GEMA AI

**Data:** 26/11/2026. **Evidências:** [`COMPETITOR_ANALYSIS.md`](./COMPETITOR_ANALYSIS.md). Os códigos F1, A2 etc. remetem à seção 3 de lá e sempre levam URL e trecho.

**Fontes do lado GEMA AI:**
- documentos: `docs/ROADMAP.md`, `docs/AI_TOOLS.md`, `docs/WHATSAPP_PROVIDERS.md`, `docs/TEST_REPORT.md`, `IMPLEMENTATION_STATUS.md`, `BLOCKERS.md`;
- rotas: `src/app/**/page.tsx` e `src/app/api/**/route.ts`;
- banco e código: `supabase/migrations/*.sql`, `src/server/**`;
- testes: `tests/**`.

**Status permitidos:** Pendente · Implementada · Testada · Homologada · Sandbox · Bloqueada externamente.
- **Implementada:** há código no repositório, mas nenhum teste automatizado cobre o item.
- **Testada:** há código e teste automatizado, com Postgres real (PGlite) e mocks de contrato.
- **Homologada:** nenhum item está Homologado hoje, porque não há ambiente real (ver `BLOCKERS.md`).
- **Estado parcial:** quando só existe a tabela ou o motor de cálculo, o status reflete a funcionalidade para o usuário final. A parte já existente aparece na coluna "Funcionalidade GEMA AI".

> `src/server/finance/engine.ts` e `tests/unit/finance-engine.test.ts` ainda **não estão commitados** (`git status`: não rastreados). Os 12 testes passaram localmente em 26/11/2026 (`npx vitest run tests/unit/finance-engine.test.ts`).

**Prioridade:** P0 = núcleo vendável · P1 = paridade com o concorrente · P2 = diferencial ou expansão. Segue o critério de `IMPLEMENTATION_STATUS.md`.

## Financeiro

| Funcionalidade do concorrente | Evidência pública | Funcionalidade GEMA AI | Status atual | Melhoria proposta | Teste | Prioridade |
|---|---|---|---|---|---|---|
| Open Finance somente leitura | F1 — meuassessor.com/seguranca: "cópia de leitura: saldo, extrato e faturas de cartão" | Não existe. Previsto em OF-01..OF-04 (`BankProvider` + Pluggy) | Pendente | Implementar `BankProvider` e o adaptador Pluggy em sandbox, com consentimento revogável e sync idempotente. Conta Pluggy pendente (BLK-05) | a criar | P0 |
| Contas bancárias (+200 bancos, conta manual) | F2/F2b — home: "+200 bancos · Suas contas · Open Finance" | Só a tabela `financial_accounts` (tipos checking/savings/credit_card/cash/investment); não há tela nem serviço de contas | Pendente | CRUD de contas manuais com saldo inicial e tela em `/app/financas`. Depois, vincular às contas do Open Finance | a criar | P0 |
| Saldos consolidados | F3 — home: "reunir saldos, extratos e faturas" | O KPI "Saldo do mês" (receitas − despesas) em `/app/financas`. Não há saldo por conta | Pendente | Saldo por conta (inicial + lançamentos realizados) e consolidado, sem contar transferências próprias (`resultEffect` do motor) | a criar | P0 |
| Extratos | F4 — /como-usar: "o que caiu no extrato hoje?" | Lista de lançamentos manuais em `/app/financas/transacoes` e ferramenta `list_transactions`. Não há extrato bancário | Pendente | Extrato por conta e importação OFX/CSV com deduplicação (FIN-11), depois via Open Finance | a criar | P1 |
| Cartões (limite usado e disponível) | F5 — /financas: "Contas, cartões, faturas e parcelas, na mesma visão." | Tabelas `credit_cards`/`credit_card_bills` + RLS; `cardSummary` (limite usado/disponível com parcelas futuras); ferramentas `list_credit_cards`, `simulate_purchase`. Sem tela ainda | Testada | Tela de cartões (FIN-12) | `tests/unit/finance-engine.test.ts`, `tests/db/finance-core.test.ts` | P0 |
| Faturas | F6 — /financas: "Consulte o valor da fatura, a data de vencimento e as compras parceladas." | Faturas persistidas por ciclo; total calculado das transações; `payBill` registra `card_payment` (não é despesa) e baixa a fatura | Testada | Tela de faturas + fechamento automático por job | `tests/unit/finance-engine.test.ts`, `tests/db/finance-core.test.ts` | P0 |
| Parcelamentos | F7 — /financas: "registrar uma compra parcelada e acompanhar as parcelas previstas" | `createCardPurchase` gera N parcelas nas faturas certas (idempotente); parcelas futuras = `projected`; ferramenta `create_card_purchase` | Testada | Tela de parcelas futuras | `tests/unit/finance-engine.test.ts`, `tests/db/finance-core.test.ts` | P0 |
| Categorias | F8 — ajuda/16141059: "criar, renomear, listar e excluir categorias conversando com o Martin" | Tabela `categories`. A IA atribui categoria em `create_expense`/`create_income` | Testada | Ferramentas de IA para criar, renomear e excluir categorias (excluir com confirmação) e regras aprendidas com correções (FIN-10) | `tests/ai/assistant.test.ts` | P1 |
| Limites (orçamento) por categoria | F9 — /financas: "Orçamento por categoria, com valor definido por você." | Tabela `budgets` e tela `/app/financas/orcamentos` com barra de progresso | Implementada | Teste de cálculo do orçamento, ferramenta de IA `set_budget` e aviso de 80% do limite (AUT-03) | a criar | P1 |
| Gráficos personalizados salvos | F10 — /financas: "criar gráficos personalizados, salvá-los no painel e no app" | Só barras CSS fixas por categoria em `/app/financas`. Não há gráficos salvos | Pendente | Dashboard financeiro (FIN-12) com gráficos sobre dados reais e uma ferramenta de IA para gerar e salvar recortes | a criar | P0 |
| Fluxo de caixa | F11 — home: "Entradas e saídas previstas para o período." | `cashflowProjection` (saldo realizado + pendentes + faturas em aberto, com hipóteses); ferramenta `cashflow_forecast`. Sem tela | Testada | Tela de fluxo de caixa com gráfico (FIN-12) | `tests/unit/finance-engine.test.ts`, `tests/db/finance-core.test.ts` | P0 |
| Projeção financeira (saldo diário) | F12 — home: "Saldo de outubro, com projeção para os próximos dias." | `projectCashflow` + `canAfford`; ferramenta `simulate_purchase` responde "posso comprar?" com hipóteses | Testada | Gráfico realizado × projetado | `tests/unit/finance-engine.test.ts`, `tests/db/finance-core.test.ts` | P0 |
| Relatório em PDF | F13 — /financas: "PDF para ler. Planilha para continuar o trabalho." | `generate_report` só devolve um resumo em texto do mês corrente. Não gera PDF | Pendente | Geração de PDF por período e categoria, entregue no painel e por WhatsApp quando houver envio de mídia (FIN-13) | a criar | P1 |
| Exportação Excel | F14 — /como-usar: "manda um excel dos gastos por categoria" | Exportação **CSV** em `GET /api/export/transactions` (BOM UTF-8). Não gera XLSX | Implementada | Gerar XLSX, proteger contra CSV injection (FIN-13) e testar a exportação | a criar | P1 |
| Lançamento por texto e áudio | F15 — /financas: "Mande o almoço por mensagem, o abastecimento por áudio" | Chat `/api/ai/chat` e WhatsApp com Gemini multimodal: 3 ações independentes por áudio, sem duplicar em webhook repetido | Testada | Validar com o Gemini real (BLK-04) | `tests/ai/assistant.test.ts`, `tests/integrations/whatsapp.test.ts` | P0 |
| Lançamento por foto (comprovante) | F15 — /financas: "...ou a foto da nota." | Extração com revisão (`src/server/ai/extraction.ts`, `POST /api/documents/[id]/extract`). Recebimento de imagem testado no adaptador Evolution | Implementada | Teste da extração e conversão da extração revisada em lançamento com um clique (ROADMAP P1) | `tests/integrations/evolution.test.ts` (só recebimento); extração: a criar | P1 |
| Entrada por PDF e planilha | F16 — home: "Texto / Áudio / Foto / PDF / Planilha" | Upload pelo painel (`/api/documents`, validação de MIME). Documento recebido no WhatsApp não vira `documents` | Pendente | WA-06: mídia recebida vai para o cofre documental e depois para a extração | `tests/unit/config-billing.test.ts` (só MIME); WA-06: a criar | P1 |
| Contas recorrentes | F17 — /financas: "Contas recorrentes e vencimentos organizados." | Tabela `recurring_transactions` sem job. Motor `detectRecurring` testado | Pendente | Job de recorrência e sugestão de assinaturas detectadas (FIN-07) | `tests/unit/finance-engine.test.ts` (só a detecção) | P1 |
| Valores a receber | F18 — /financas: "Valores a receber acompanhados até a baixa." | Lançamentos `income` com status pendente aparecem em "contas a vencer" | Implementada | Tela de recebíveis com baixa e ligação com cobrança (PAY-01) | a criar | P1 |
| Transferência entre contas | F19 — /como-usar: "transferi 500 da Nubank pra Caixa" | Motor trata `transfer` com `internalTransfer` (não é despesa). Sem schema nem ferramenta | Pendente | Tipo transferência no banco (FIN-02) e ferramenta de IA | `tests/unit/finance-engine.test.ts` (só o motor) | P0 |
| Links de cobrança (Pix, cartão, boleto) | F23 — ajuda/16733399: "Pix, cartão de crédito ou boleto" | Não existe. Previsto em PAY-01 (Asaas) | Pendente | `PaymentProvider` + Asaas em sandbox (BLK-06) | a criar | P2 |

## Agenda

| Funcionalidade do concorrente | Evidência pública | Funcionalidade GEMA AI | Status atual | Melhoria proposta | Teste | Prioridade |
|---|---|---|---|---|---|---|
| Google Agenda nos dois sentidos | A1/A1b — /agenda: "Marcou aqui. Apareceu lá. E o contrário também." | OAuth (`/api/oauth/google/*`), criação com `sync_google` e confirmação, sync manual incremental. Escopos `calendar.events` e `freebusy` | Testada | Push `events.watch` para sincronizar na hora (ROADMAP P1). Validar com credenciais reais (BLK-07) | `tests/integrations/google.test.ts`, `tests/ai/assistant.test.ts` | P0 |
| Transcrição de reuniões do Meet, ata e tarefas | A2/A2b/A2c — /como-usar: "Sofi, entra nessa reunião: meet.google.com/…" | Não existe. Não há escopo Meet nem bot. AG-03 prevê processar uma transcrição ou áudio fornecido pelo usuário | Pendente | AG-03: áudio ou transcrição enviados geram resumo, decisões e tarefas. Não entrar em reuniões sem o consentimento de todos os participantes | a criar | P1 |
| Agenda pública (link de agendamento) | A3 — /agenda: "A pessoa escolhe entre os horários livres e marca com você" | Não existe. `check_availability` só é usada pela IA | Pendente | AG-02: página pública com disponibilidade sem detalhes e reserva sem duplicidade | a criar | P1 |
| Recados a contatos pelo WhatsApp | A4 — /agenda: "A Sofi cuida da mensagem pelo WhatsApp" | Não existe. A política atual só responde a quem mandou mensagem e só notifica quem verificou e consentiu (`WHATSAPP_PROVIDERS.md`) | Pendente | Recado por e-mail ou link de convite. Pelo WhatsApp só com template aprovado da Meta e opt-in do destinatário (BLK-10) | a criar | P1 |
| Reunião com link do Meet e convites | A5 — /agenda: "deixe o link do Meet junto do compromisso" | `create_calendar_event` com convidados (exige confirmação). Não gera link do Meet | Implementada | Pedir `conferenceData` ao Google e testar convidados mais link | `tests/ai/assistant.test.ts` (convidados/confirmação); Meet: a criar | P1 |
| Remarcar e avisar participantes | A6 — /agenda: "peça para remarcar e avisar os participantes" | `update_calendar_event` e `cancel_calendar_event` com confirmação. O aviso aos participantes depende do Google | Implementada | Teste de remarcação com `sendUpdates` | a criar | P1 |
| Resumo diário configurável | A7 — /agenda: "Receba um resumo no horário que combina com sua rotina." | Briefing (`get_day_briefing`, `/app/briefings`, automações) só com dados reais | Testada | Horário configurável pela conversa | `tests/integrations/automations.test.ts` | P0 |
| Lembretes recorrentes | A8 — /agenda: "Uma vez, toda semana ou todo mês." | `create_reminder` (daily/weekly/monthly), disparo único por ocorrência e DST | Testada | — | `tests/integrations/automations.test.ts`, `tests/unit/time-money.test.ts` | P0 |

## Tarefas e documentos

| Funcionalidade do concorrente | Evidência pública | Funcionalidade GEMA AI | Status atual | Melhoria proposta | Teste | Prioridade |
|---|---|---|---|---|---|---|
| Tarefas com prazo e prioridade | T1 — home: "A Luna organiza tarefas, prazos e prioridades." | `create_task` e `complete_task`, tela `/app/tarefas` | Testada | Subtarefas, Kanban e visões Hoje/Semana/Atrasadas (TSK-01) | `tests/ai/assistant.test.ts` | P0 |
| Projetos com checklist | T2 — /tarefas: "A pendência ganha prazo. O projeto ganha caminho." | Tabela `projects` (status, prazo) e tela `/app/projetos` | Implementada | Checklist e progresso por projeto, mais teste | a criar | P1 |
| Listas de compras compartilhadas | T3 — /tarefas: "A lista do mercado, as tarefas da casa…" | Só a tabela genérica `task_lists`. Não há lista de compras | Pendente | SHOP-01: lista compartilhada no workspace família, com ferramenta de IA para adicionar itens | a criar | P1 |
| Drive inteligente (pastas, busca pelo assunto) | T4/T5 — /tarefas: "Você lembra do assunto. A Luna acha o arquivo." | `search_documents` busca por nome e tipo. Não há pastas nem busca semântica | Pendente | DOC-02: pastas, busca textual e semântica (pgvector) sob RLS | a criar | P1 |
| Documentos (upload privado) | T4 — /tarefas: "Documentos, fotos, PDFs e planilhas ficam no Meu Drive" | `/app/documentos`, `/api/documents`, URL assinada, políticas de Storage | Testada | Validar com Storage real (BLK-01) | `tests/db/rls.test.ts`, `tests/unit/config-billing.test.ts` | P0 |
| Documento com lembrete de renovação | T6 — /tarefas: "Guarde o documento e combine quando quer ser avisado." | Não existe vínculo entre documento e vencimento | Pendente | DOC-02: data de vencimento no documento gera lembrete | a criar | P1 |
| Link público de pasta revogável | T7 — /tarefas: "Você também pode desativar esse link" | Não existe. Só há URL assinada temporária | Pendente | Link de visualização com expiração e revogação, auditado | a criar | P2 |
| Relatórios de tarefas em PDF e Excel | T8 — ajuda/16141104: "5 modelos de organização (...) em PDF ou Excel" | Não existe | Pendente | Reaproveitar o gerador do FIN-13 | a criar | P2 |

## Fiscal

| Funcionalidade do concorrente | Evidência pública | Funcionalidade GEMA AI | Status atual | Melhoria proposta | Teste | Prioridade |
|---|---|---|---|---|---|---|
| Emissão de NFS-e | N1 — ajuda/16733392: "emite notas fiscais de serviço eletrônicas (NFS-e) direto do painel" | Não existe. FIS-01 prevê só rascunho e validação; a emissão real depende de provedor homologado e certificado A1 | Bloqueada externamente | `FiscalProvider` com rascunho validado, emissão bloqueada até o provedor existir (BLK-08) | a criar | P2 |
| Cadastro e perfil fiscal (cartão CNPJ) | N2 — /notas-fiscais: "Envie os dados da empresa, o cartão CNPJ ou o contrato social." | Não existe | Pendente | Perfil fiscal do workspace empresa (serviços, códigos, alíquotas) | a criar | P2 |
| PDF e XML da nota | N3 — /notas-fiscais: "disponível em PDF e XML" | Não existe | Pendente | Depende do provedor fiscal (BLK-08) | a criar | P2 |
| Envio de nota fiscal ao cliente ou a terceiro | N4/N4b — /operacao: "Manda a nota de R$ 1.280 do Rafael para a Ana do financeiro." | Não existe. Whaileys não envia mídia (`sendMediaIfSupported` ⇒ `unsupported`) | Pendente | Envio por e-mail (Resend/Brevo já existe) e mídia pelos provedores que suportam | a criar | P2 |
| Rejeição, cancelamento e resumo fiscal | N5/N6/N7 — /notas-fiscais: "Se houver uma rejeição, explica o motivo" | Não existe | Pendente | Depois do FIS-01 | a criar | P2 |

## Pesquisa

| Funcionalidade do concorrente | Evidência pública | Funcionalidade GEMA AI | Status atual | Melhoria proposta | Teste | Prioridade |
|---|---|---|---|---|---|---|
| Pesquisa com fontes | P1/P1b — /pesquisas: "volta com um resumo e as fontes para você decidir" | Não existe | Pendente | RES-01: agente com grounding; resposta sem fonte é recusada (BLK-04/BLK-13) | a criar | P1 |
| Pesquisa e comparação de preços | P2 — /pesquisas: "Ítalo, pesquisa o preço médio desse notebook." | Não existe | Pendente | Parte do RES-01, comparando o mesmo modelo e configuração, com fonte por preço | a criar | P1 |
| Passagens | P3 — /pesquisas: "Compare opções de voo, pesquise uma hospedagem" | Não existe. TRV-01 cobre só o planejamento | Pendente | Pesquisa informativa com links, sem reserva nem compra (BLK-13) | a criar | P2 |
| Hotéis | P4 — /como-usar: "hotel em Gramado pro feriado, até 600 a diária, casal" | Não existe | Pendente | Igual ao item de passagens | a criar | P2 |
| Acesso autorizado a portais (login guardado) | P5/P5b — /como-usar: "entra no portal do plano de saúde com meu login" | Não existe | Pendente | **Não guardar senhas de terceiros.** Preferir upload do documento ou integração oficial. Se um dia existir, usar cofre, consentimento por portal e nível de risco 4 (AI-02) | a criar | P2 |
| Histórico de pesquisas | P6 — /pesquisas: "ficam na mesa de Pesquisas do painel e do app" | Não existe (as conversas ficam em `conversations` e `messages`) | Pendente | Persistir pesquisas com fontes | a criar | P2 |

## Operações

| Funcionalidade do concorrente | Evidência pública | Funcionalidade GEMA AI | Status atual | Melhoria proposta | Teste | Prioridade |
|---|---|---|---|---|---|---|
| Orquestração de pedidos compostos | O1 — /operacao: "O Theo entende os assuntos e reúne os assessores" | Orquestrador com até 10 ferramentas por mensagem e estados independentes por ação | Testada | Agentes especializados e planos com passos (AI-04/AI-05) | `tests/ai/assistant.test.ts` | P0 |
| Pendências e próximos passos | O2 — /operacao: "organiza as pendências e mostra o próximo passo" | Executor com risco 1–4, aprovação vinculada ao hash dos argumentos, expiração, rejeição auditada; risco 4 bloqueado no banco. Sem tela de central | Testada | Tela Central de Aprovações (AI-03) | `tests/ai/approvals-agents.test.ts` | P0 |
| Avisos automáticos | O3 — home: "Seu resumo financeiro chega sem você precisar pedir." | Automações com 5 modelos, outbox, quiet hours e briefing. Push PWA envia, mas falta a tela de inscrição | Testada | Novos gatilhos: saldo baixo, fatura em 80%, documento vencendo (AUT-03); tela de inscrição push (UX-06) | `tests/integrations/automations.test.ts` | P0 |
| Participantes compartilhados (workspace) | O4 — home: "sem limite de participantes e sem cobrança por pessoa" | Workspaces `family`/`business` com `create_workspace` e isolamento por RLS | Testada | Validar com Supabase real (BLK-01) | `tests/db/rls.test.ts` | P0 |
| Convidar participantes | O4 — home: "Convide sua família, seus sócios ou sua equipe" | Tabela `workspace_invitations` sem fluxo nem tela | Pendente | F1-04: convite por e-mail com token de uso único | a criar | P0 |
| Permissões por participante | O5 — /operacao: "acompanha a permissão que você definiu" | Papéis básicos em `workspace_members`. Não há matriz por módulo | Pendente | F1-03: papel × módulo × ação (`app.can`) | a criar | P0 |
| Histórico de atividades | O6 — /operacao: "Consulte os avisos e o histórico de atividades." | `audit_logs` e `ai_tool_executions`. Tela só no Super Admin (`/super-admin/auditoria`) | Implementada | Linha do tempo de atividades para o usuário | a criar | P1 |
| Personalização (nome, horário, fuso) | O7 — /operacao: "o horário do resumo, o fuso de onde você está" | `/app/configuracoes` com fuso horário | Implementada | Ajuste pela conversa e horário do resumo | a criar | P2 |
| Confirmação e recibo por ação | O8 — Google Play: "Toda ação vem com recibo" | Confirmação ✅/Cancelar, idempotência e registro por execução | Testada | Recibo padronizado com o que, quanto, quando e onde | `tests/ai/assistant.test.ts`, `tests/integrations/whaileys.test.ts` | P0 |
| Conector MCP somente leitura | O9 — ajuda/17827887: "O acesso é somente leitura" | Não existe e não está no backlog | Pendente | Avaliar um servidor MCP somente leitura com OAuth e escopos por módulo | a criar | P2 |
| Suporte humano | O10 — home: "suporte humano ajuda com plano, cobrança e acesso" | `support_cases` (usada em `src/app/app/actions.ts` e no Super Admin) e `/app/ajuda` | Implementada | Teste do fluxo de chamado | a criar | P1 |

## Canais

| Funcionalidade do concorrente | Evidência pública | Funcionalidade GEMA AI | Status atual | Melhoria proposta | Teste | Prioridade |
|---|---|---|---|---|---|---|
| WhatsApp como canal principal | C1 — home: "Você só manda uma mensagem no WhatsApp." | Meta Cloud, Whaileys e Evolution com o contrato `MessagingProvider`; verificação de número; anti-loop; dedupe | Testada | Criar a instância e homologar com número real (BLK-03). Fluxo de vínculo pelo código enviado pelo usuário (WA-04) | `tests/integrations/whatsapp.test.ts`, `tests/integrations/whaileys.test.ts`, `tests/integrations/evolution.test.ts` | P0 |
| Conta comercial verificada pela Meta | C1b — /seguranca: "conta comercial verificada pela Meta" | Adaptador Cloud API sem credenciais. Whaileys e Evolution não são oficiais (risco de bloqueio, conforme o documento) | Bloqueada externamente | Verificação Business e templates aprovados (BLK-10) | `tests/integrations/whatsapp.test.ts` (contrato) | P1 |
| Cada participante no próprio WhatsApp | C1c — /financas: "Cada uma conversa pelo próprio WhatsApp" | `channel_accounts` verificada por usuário; o titular é identificado só pelo número verificado | Testada | Testar múltiplos membros do mesmo workspace pelo WhatsApp | `tests/integrations/whatsapp.test.ts` | P1 |
| Painel web | C2/C2b — home: "O painel abre no navegador" | Rotas `/app/*` (finanças, agenda, tarefas, projetos, contatos, assistente, documentos, briefings, automações, integrações e outras) | Implementada | E2E autenticado (depende do BLK-01). Busca global e Ctrl+K (F1-08) | `tests/e2e/public.spec.ts` (só páginas públicas e estados não configurados) | P0 |
| App móvel | C3/C4 — Google Play: "este app é o seu painel completo" | PWA: `manifest.webmanifest`, `sw.js`, `/offline`. Não há app nativo | Testada | Barra mobile (UX-01) e Capacitor para as lojas (APP-01, BLK-12) | `tests/e2e/public.spec.ts` (PWA, desktop + Pixel 7) | P1 |

## Planos e preços

| Funcionalidade do concorrente | Evidência pública | Funcionalidade GEMA AI | Status atual | Melhoria proposta | Teste | Prioridade |
|---|---|---|---|---|---|---|
| Plano único: anual em 12x de R$ 29,90 e mensal a R$ 59,90 (promoção: 12x de R$ 19,90 até 30/11) | Home, FAQ: "O mensal custa R$ 59,90 por mês." | Página `/planos`, tabela `plans`, `/super-admin/planos`. Assinatura com `BillingProvider` e webhook assinado, sem provedor nem checkout | Implementada | SAAS-01 (preços editáveis no admin) e SAAS-02 com Asaas (BLK-06) | `tests/unit/config-billing.test.ts` | P0 |
| Garantia de 7 dias | Home: "7 dias para testar. Não gostou? devolvemos tudo na hora." | Não há política de trial ou garantia no código | Pendente | Definir trial ou garantia junto com o billing; revisão jurídica (BLK-11) | a criar | P1 |
| Usuários ilimitados com Uso Justo | Home e termos, cláusula 26.1: "limites quantitativos de referência" | Limites por plano (ROADMAP P1) e tabela `rate_limits` | Implementada | Limites publicados de forma transparente, com custo por cliente (SAAS-03) | `tests/unit/config-billing.test.ts` | P1 |

## Maiores lacunas (ordem de prioridade)

1. **Open Finance** (contas, saldos consolidados, extratos): P0, depende do BLK-05 (Pluggy sandbox).
2. **Cartões, faturas e parcelamentos** persistidos e na tela. O motor já está testado: P0.
3. **Fluxo de caixa e projeção diária** na tela: P0.
4. **Convites e permissões por participante** (F1-03/F1-04): P0.
5. **Dashboard com gráficos personalizados salvos** (FIN-12): P0.
6. **Central de pendências e aprovações** (AI-03): P0.
7. **Homologação do WhatsApp real** (instância e número; Cloud API verificada): P0, depende do BLK-03 e do BLK-10.
8. **Relatórios PDF e XLSX** com proteção contra CSV injection (FIN-13): P1.
9. **Pesquisa com fontes e comparação de preços** (RES-01): P1, depende do BLK-04 e do BLK-13.
10. **Agenda pública e processamento de reuniões** (transcrição, ata e tarefas) (AG-02/AG-03): P1.
