# Plano de execução — prompt mestre V3.0

Estratégia: fatias verticais completas (migration + RLS + serviço determinístico + ferramenta de IA + tela + testes + docs),
priorizando o que **não depende de credencial externa**. Integrações bloqueadas recebem adaptador + testes de contrato +
entrada em `BLOCKERS.md`, e o trabalho segue.

## Ordem (dependências primeiro)
1. **Fase 0** — continuidade (feito), benchmark (agente em paralelo), docs canônicos.
2. **F1-05** fila persistente genérica (base de WA-05, OF-03, AUT-02).
3. **FIN-02 → FIN-03 → FIN-04 → FIN-05 → FIN-08** motor financeiro determinístico (cartões, parcelas, anti-duplicidade, metas, fluxo de caixa).
4. **AI-02 → AI-03 → AI-04** risco/aprovações exatas → central de aprovações → catálogo de agentes.
5. **OF-01 → OF-02 → OF-03 → OF-04** Open Finance (Pluggy em contrato; sandbox quando houver BLK-05).
6. **WA-04** vinculação inbound; **WA-05** ingestão por fila; **WA-07** inbox.
7. **F1-03 / F1-04** permissões granulares e convites.
8. **SAAS-01** planos editáveis; **UX-01/03/04** navegação mobile, demo, landing.
9. Demais P1/P2 conforme backlog.

## Próxima tarefa executável
**SAAS-01** — planos editáveis no Super Admin (preço e limites fora do código), entitlements por módulo aplicados no
servidor, cupons. Depois **UX-03** (/demo com dados fictícios isolados) e **UX-04** (landing V3).

## Registro de decisões
| Data | Decisão | Motivo |
|---|---|---|
| 26/11/2026 | Docs canônicos permanecem em `docs/` (nomes da V1); `CLAUDE.md` mapeia nomes pedidos na V3 | Evitar duplicação de documentação |
| 26/11/2026 | Paleta: manter Dark Executive (grafite + dourado) | Prompt V3 manda preservar identidade existente; esmeralda era "sugerida, caso compatível" |
| 26/11/2026 | Open Finance começa somente leitura | Exigência regulatória e do prompt |
| 26/11/2026 | Cálculo financeiro em módulo puro `src/server/finance/` testado | IA não pode ser calculadora oficial |
