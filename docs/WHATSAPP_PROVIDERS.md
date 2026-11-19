# WhatsApp — provedores

Contrato único `MessagingProvider` (`src/server/messaging/types.ts`): `receive`, `sendText`,
`sendInteractiveIfSupported`, `sendMediaIfSupported`, `downloadMedia?`, `ack`, `health`, `disconnect`.

| Provedor | Estado | Webhook |
|---|---|---|
| `MetaCloudProvider` (Cloud API oficial) | Implementado, **pendente de credenciais/teste real** | `GET/POST /api/webhooks/meta` (verify token + `X-Hub-Signature-256`) |
| `EvolutionProvider` (v2) | Implementado, **pendente de host e teste real** | `POST /api/webhooks/evolution` (header `x-gema-webhook-secret`) |
| `BaileysWhaileysProvider` | **Stub de contrato** — repositório vazio em 19/11/2026 | — |
| Painel (`dashboard`) | Funcional | `/api/ai/chat` |

Saída preferencial: Meta (oficial) se configurada; senão Evolution.

## Regras aplicadas

- Titular identificado **somente** por `channel_accounts` verificada (código de 6 dígitos enviado ao número, até 5 tentativas, expira em 10 min). Número no payload não autentica.
- Ignora `fromMe`, grupos e status (anti-loop); dedupe por `provider_message_id`; replay protection por id de evento.
- Número desconhecido: nada é processado nem respondido.
- Botões: fallback textual (`1) Confirmar 2) Cancelar`) quando não suportado/aprovado.
- Nunca envio em massa. Respostas só a mensagens recebidas; notificações apenas para quem verificou e consentiu (`opted_in_at`).
- **Meta**: fora da janela de 24 h só templates aprovados — envio de notificações proativas pela Cloud API requer templates cadastrados (pendente).
- Falha de entrega ⇒ status registrado e fallback para e-mail/push se consentido, sem duplicar.

## Aviso sobre conectores não oficiais

Evolution/Baileys usam o protocolo do WhatsApp Web, não a API oficial. Há risco de bloqueio do número
e de violação dos termos da Meta. Use número dedicado, volume baixo, apenas conversas iniciadas pelo
usuário, e prefira a Cloud API para produção. Uma instância não deve atender vários clientes sem desenho
e consentimento específicos.

## Baileys/Whaileys

Nada do repositório `jefferson22gs/baileys_whaileys_button_list` foi presumido. Para ativar:
1. Publicar código real; 2. revisar compatibilidade e licença; 3. implementar o contrato acima em
serviço persistente (não Vercel); 4. ligar a flag `integration.baileys_whaileys`.
