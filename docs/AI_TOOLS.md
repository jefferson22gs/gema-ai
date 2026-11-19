# Ferramentas de IA

Definidas em `src/server/ai/tools.ts`. O Gemini recebe as declarações (JSON Schema gerado do Zod) e
devolve chamadas; o executor (`executor.ts`) valida, autoriza (RLS do ator), registra e executa.

## Estados

`proposed → awaiting_confirmation → running → succeeded | failed | cancelled`

Cada chamada tem registro próprio em `ai_tool_executions` (idempotente por `provider:mensagem:índice`).
Falha de uma ação não desfaz as demais; a resposta lista o status de cada item.

## Catálogo

| Ferramenta | Confirmação | Observações |
|---|---|---|
| `get_day_briefing` | não | Somente dados reais; lacunas explícitas |
| `list_calendar_events` | não | |
| `check_availability` | não | |
| `create_calendar_event` | se `sync_google`, convidados ou `allow_conflict` | Conflito ⇒ volta para `awaiting_confirmation` com `allow_conflict: true` |
| `update_calendar_event` / `cancel_calendar_event` | sim | |
| `create_contact` | sim | E.164, dedupe por telefone/e-mail, Google opcional |
| `find_contact` | não | |
| `create_expense` / `create_income` | se algum item ≥ R$ 5.000 | Vários itens em uma chamada |
| `list_transactions`, `create_task`, `complete_task`, `create_reminder`, `list_reminders`, `search_documents`, `generate_report` | não | |
| `list_business_integrations` | não | Apenas lista status; nenhuma ação externa |
| `request_confirmation` | — | Pergunta ao usuário sem executar |

Confirmações expiram em 30 minutos. No WhatsApp: responder `1`/`sim` ou `2`/`cancelar`.

## Modelo e custos

- `GEMINI_MODEL` (padrão `gemini-flash-latest`), temperatura 0.2, timeout 25 s, máx. 10 chamadas por mensagem.
- Áudio e imagem enviados como `inlineData` (até 8 MB). Sem escuta contínua: só processa o que o usuário envia.
- Custo estimado = tokens × `GEMINI_PRICE_*_PER_MTOK` (ajuste conforme a tabela vigente do Google).
- Sem Gemini configurado: resposta explícita "Não configurado", nenhuma ação.
