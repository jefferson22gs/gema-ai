# Changelog

## [Não lançado]

### 26/11/2026 — Prompt mestre V3.0
- Push de `7009035` (Whaileys) e `a6bb4d6` (Evolution 2.3.7) para `origin/main`.
- Sistema de continuidade: `CLAUDE.md`, `IMPLEMENTATION_STATUS.md` (backlog com IDs), `EXECUTION_PLAN.md`, `BLOCKERS.md`.
- Benchmark público do Meu Assessor (`docs/COMPETITOR_ANALYSIS.md`) e matriz de funcionalidades (`docs/FEATURE_MATRIX.md`).
- Motor financeiro determinístico (`src/server/finance/engine.ts`): resultado sem dupla contabilização, faturas, parcelas,
  limite, simulador de compra, metas, fluxo de caixa com hipóteses, dívidas (bola de neve/avalanche), recorrências, saúde financeira.
- Migration `finance_core`: tipos/estados ampliados de transação, cartões, faturas, metas, dívidas, recorrências detectadas,
  regras de categorização, patrimônio; trigger que impede vínculo entre workspaces.
- **Correção**: resumo do mês e orçamento contavam despesas canceladas e projetadas; agora só pagos/conciliados/pendentes,
  com reembolso abatendo.
- Central de Aprovações (backend): risco 1–4 por ferramenta, risco 4 bloqueado também no banco, aprovação vinculada ao hash
  exato dos argumentos, expiração, rejeição auditada.
- 13 agentes especializados com roteamento determinístico e escopo de ferramentas por agente.
- Novas ferramentas: cartões, compra parcelada, "posso comprar?", fluxo de caixa, metas, saúde financeira, automações.

### 27/11/2026
- Telas: Finanças → Cartões, Fluxo de caixa (gráfico, saúde financeira, recorrências), Metas e dívidas; Central de Aprovações;
  navegação mobile com GEMA AI central e página Mais.
- Fila persistente (`system_jobs`) com dedupe, backoff exponencial, dead-letter e recuperação de lock, rodando no cron.
- Open Finance (somente leitura): `BankProvider` + Pluggy (contrato da doc oficial: `/v2/transactions` por cursor, webhook
  `X-Pluggy-Signature`), sincronização idempotente via fila, varredura diária, Central de Bancos e Consentimentos, revogação
  que exclui o item no provedor, widget oficial `pluggy-connect-sdk` (CSP liberada só para `connect.pluggy.ai`).
  Ferramenta de IA `bank_balances` informa a data do saldo (não finge tempo real).
- Vinculação do WhatsApp pelo fluxo V3: código `GEMA-XXXX-XXXX` gerado no painel e enviado pelo usuário ao número oficial
  (uso único, 15 min, bloqueio após 5 falhas/h por número, conflito com outra conta, troca de número, auditoria).
- Privacidade do canal: saldos, limites e projeções ocultos no WhatsApp por padrão; titular escolhe o que pode aparecer.
- Papéis ampliados (Proprietário, Administrador, Gestor, Financeiro, Contador, Colaborador, Familiar, Visualizador),
  permissões por módulo × ação aplicadas no banco (políticas restritivas + override individual), workspace profissional.
- Convites com token de uso único (7 dias, preso ao e-mail), e-mail de convite, página `/convite/[token]`, tela Membros.
- **Segurança**: redirecionamento pós-login restrito a caminhos internos conhecidos.
- Central de Conversas (`/app/conversas`): modos IA automática, atendimento humano, copiloto (sugere sem enviar) e IA pausada,
  com troca atômica (`lock_version`) que impede IA e humano de responderem ao mesmo tempo; notas internas; ações executadas.
- Acesso do suporte às conversas só com autorização do titular no chamado, justificativa, prazo curto e auditoria por leitura.
- Webhooks de WhatsApp agora só verificam e enfileiram (2xx imediato); o processamento roda na fila com retry/dead-letter.
- Planos SaaS editáveis no Super Admin (preço mensal/anual, teste, limites, recursos, visibilidade) com auditoria antes/depois;
  cupons (percentual ou valor fixo, validade, usos, plano e ciclo) e add-ons que somam limites. Novo plano Business.
- Entitlements aplicados no servidor: WhatsApp (ingestão), Open Finance (+ limite de conexões), automações (limite) e
  convites (equipe + limite de membros). Recursos essenciais e dados do usuário nunca são bloqueados.
- **Correção**: `/planos` tinha preços fixos no código; agora lê do banco. Workspace acompanha o plano da assinatura.
- `/demo` público: cenário fictício sinalizado (finanças, cartões com simulador, metas e dívidas, agenda e conversa
  roteirizada) calculado pelo motor financeiro real, sem banco, sem IA e sem nenhuma requisição externa.
- Landing V3: agentes especializados, Open Finance somente leitura, família e empresa, garantias de segurança e chamada
  para a demonstração. Removidos "14 dias" fixo e nome real do exemplo; teste impede métricas/preços inventados.
- Importação de extratos OFX (1.x/2.x) e CSV de bancos brasileiros (`/app/financas/importar`): prévia antes de gravar,
  ids estáveis (FITID ou hash), reimportação e períodos sobrepostos sem duplicar, Latin-1 aceito, linhas inválidas listadas.
- Regras de categorização aprendidas: ao corrigir a categoria em Lançamentos com "lembrar", a regra passa a valer para
  importações e novos lançamentos do mesmo estabelecimento (respeita despesa/receita; regras excluíveis).
- Relatório mensal (`/app/financas/relatorios`) com exportação PDF, XLSX e CSV gerados sem dependências externas,
  sob RLS e permissão `reports.export`, auditado.
- **Segurança**: exportação CSV de lançamentos não protegia contra fórmulas (`=`, `+`, `-`, `@`); agora neutraliza, e o
  XLSX grava texto sempre como texto.
- Patrimônio (`/app/financas/patrimonio`): bens com valor informado e data, saldos bancários, contas registradas,
  dívidas e compras de cartão não pagas, com liquidez, avisos (saldo não informado, avaliação antiga, possível dupla
  contagem) e fotografias mensais automáticas. Conta ligada a banco conectado entra pelo saldo do banco, sem somar os
  lançamentos de novo; pagar fatura não altera o patrimônio. Agente Patrimônio ativo com `net_worth` e `register_asset`.
- `Idempotency-Key` genérica (tabela `idempotency_keys`) no upload de documentos e na conexão de bancos: reenvio após
  queda de rede não duplica; corpo diferente com a mesma chave é recusado. Upload passa a respeitar add-ons de storage.
- Agenda pública de agendamento (`/agendar/[endereço]`, configurada em Agenda → Agenda pública): grade semanal com até
  dois períodos por dia, duração, folga, antecedência e janela; o visitante vê só horários livres (sem detalhes da agenda),
  reserva concorrente nunca duplica, o compromisso entra na agenda e o dono é notificado; cancelamento por link.

### 20/11/2026
- Canal Whaileys com botões ✅ Confirmar/Cancelar (`7009035`).
- Evolution 2.3.7 compartilhada: token da instância e `x-evo-secret` (`a6bb4d6`).

### 19/11/2026
- Fundação SaaS, RLS, motor de IA, integrações (e-mail, WhatsApp, Google), painel, Super Admin, PWA, CI e docs
  (`501404c`, `74610c2`, `d27854d`, `ea30830`).
