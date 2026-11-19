# Conector AgendaFácil365 (planejado)

**Estado: não implementado como integração ativa.** Não foram presumidos endpoints, tabelas ou credenciais
do AgendaFácil365 (`github.com/jefferson22gs/agendafacil365`). O GEMA AI **não** acessa o banco de produção
do AgendaFácil e **não** usa service role de outro projeto.

## Contrato proposto (a implementar no AgendaFácil, em projeto separado)

Autenticação: OAuth 2.0 (authorization code + PKCE) ou API key por empresa com escopos.

| Método | Endpoint | Escopo | Uso no GEMA |
|---|---|---|---|
| GET | `/api/v1/me/businesses` | `businesses:read` | Escolher empresa vinculada |
| GET | `/api/v1/businesses/{id}/appointments?from&to` | `appointments:read` | Agenda executiva / briefing |
| POST | `/api/v1/businesses/{id}/appointments` (Idempotency-Key) | `appointments:write` | Criar agendamento após confirmação |
| PATCH | `/api/v1/appointments/{id}` | `appointments:write` | Reagendar/cancelar após confirmação |
| GET | `/api/v1/businesses/{id}/availability?date` | `availability:read` | Horários livres |
| Webhook | `appointment.created/updated/cancelled` (HMAC) | — | Sincronização |

Requisitos: paginação por cursor, `updated_at` para sync incremental, ids estáveis, rate limit documentado, revogação de token.

## Do lado do GEMA (quando a API existir)

Adapter em `src/server/integrations/agendafacil/` seguindo o padrão do Google (tokens cifrados, `integrations.provider = 'agendafacil365'`, flag `integration.agendafacil365`), e ferramentas de IA novas com confirmação obrigatória.
