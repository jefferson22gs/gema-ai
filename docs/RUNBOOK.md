# Runbook operacional

## Verificações rápidas

| Sintoma | Onde olhar | Ação |
|---|---|---|
| App fora | `GET /api/health` (database `error` ⇒ 503) | Status do Supabase; `DATABASE_URL`/pooler |
| Assistente responde "Não configurado" | `GEMINI_API_KEY` | Definir e redeploy |
| Assistente "indisponível (limite de custo)" | Super Admin → custo Gemini do mês | Avaliar uso; ajustar `GEMINI_MAX_MONTHLY_USD` |
| WhatsApp sem resposta | Super Admin → Canais / Monitoramento | Instância desconectada ⇒ reparear QR no host; 401 em massa ⇒ segredo divergente |
| Whaileys desconectado | Super Admin → Canais; `wh.sh status <instância>` | `wh.sh connect <instância>` (QR) ou com telefone (código de 8 dígitos); segredo divergente ⇒ `wh.sh rotate <instância> secret` e atualizar a Vercel |
| Lembretes/automações não chegam | Super Admin → Automações; `automation_runs` com `failed/dead`; `notification_outbox` `dead` | Ver `last_error`; cron rodando? (`CRON_SECRET`) |
| E-mails `ambiguous` | Super Admin → E-mails | Conferir no painel do provedor antes de qualquer reenvio manual |
| Google "erro" | `integrations.last_error` | Usuário reconecta; `invalid_grant` = revogado no Google |

## Reprocessar

- Outbox falho: `update notification_outbox set status = 'pending', next_attempt_at = now() where id = '<id>';` (dedupe por canal evita duplicidade em canais já aceitos).
- Automação: `update automation_rules set next_run_at = now() where id = '<id>';` (ocorrência já executada não repete).

## Incidentes de segurança

1. Rotacionar segredo afetado (Supabase keys, `OAUTH_ENCRYPTION_KEY`*, webhooks, `CRON_SECRET`).
2. Revisar `audit_logs` e `provider_webhook_events` (rejeições).
3. Comunicar titulares/ANPD conforme LGPD quando aplicável.

\* Rotacionar `OAUTH_ENCRYPTION_KEY` invalida tokens Google existentes (usuários precisam reconectar) — rotação com dupla chave (`key_version`) está prevista no schema e pendente no código.

## Backup / restauração

Supabase: backups diários (+ PITR se contratado). Teste de restauração em projeto de staging antes do lançamento e a cada trimestre. Evolution: ver `EVOLUTION_DOCKER.md`.
