# WhatsApp — provedores

Contrato único `MessagingProvider` (`src/server/messaging/types.ts`): `receive`, `sendText`,
`sendInteractiveIfSupported`, `sendMediaIfSupported`, `downloadMedia?`, `ack`, `registerKnownPhones?`, `health`, `disconnect`.

| Provedor | Estado | Webhook |
|---|---|---|
| `MetaCloudProvider` (Cloud API oficial) | Implementado, **pendente de credenciais/teste real** | `GET/POST /api/webhooks/meta` (verify token + `X-Hub-Signature-256`) |
| `WhaileysProvider` (motor próprio, botões e listas) | Implementado, **pendente de instância criada e teste real** (motor respondendo `health` em 20/11/2026) | `POST /api/webhooks/whaileys` (HMAC `x-whaileys-timestamp` + `x-whaileys-signature`) |
| `EvolutionProvider` (v2) | Implementado, **pendente de host e teste real** | `POST /api/webhooks/evolution` (header `x-gema-webhook-secret`) |
| Painel (`dashboard`) | Funcional | `/api/ai/chat` |

Saída (verificação de número e notificações): Meta (oficial) > Whaileys > Evolution — o primeiro configurado.
O número fica vinculado ao provedor que enviou o código (`channel_accounts.provider`).

## Regras aplicadas

- Titular identificado **somente** por `channel_accounts` verificada (código de 6 dígitos enviado ao número, até 5 tentativas, expira em 10 min). Número no payload não autentica.
- Ignora `fromMe`, grupos e status (anti-loop); dedupe por `provider_message_id`; replay protection por id de evento.
- Número desconhecido: nada é processado nem respondido.
- Ação que exige confirmação: botões **✅ Confirmar / Cancelar** (ids `confirmar`/`cancelar`), com as opções também numeradas no texto; clique, `1`/`2` ou digitação funcionam igual. Evolution sem botões: só o texto numerado.
- Nunca envio em massa. Respostas só a mensagens recebidas; notificações apenas para quem verificou e consentiu (`opted_in_at`).
- **Meta**: fora da janela de 24 h só templates aprovados — envio proativo pela Cloud API requer templates cadastrados (pendente).
- Falha de entrega ⇒ status registrado e fallback para e-mail/push se consentido, sem duplicar.

## Whaileys

Motor Baileys com botões/listas hospedado em VM própria (fora da Vercel). Administrado pelo script da skill
`whaileys-integration` (`wh.sh`), que grava as credenciais direto no `.env.local` sem exibi-las.

- **Webhook**: corpo cru; `HMAC-SHA256(segredo, "${timestamp}.${corpo}")` em hex; timestamp em ms com janela de 5 min; inválido ⇒ 401 e registro sem payload. Erros de negócio respondem 200 (o motor reentrega até 3× em 5xx); dedupe por `key.id`.
- **Instância**: eventos de `instanceKey` diferente são ignorados.
- **Remetente**: `remoteJid` `@s.whatsapp.net`; se vier só `@lid`, usa `key.senderPn`; sem telefone resolvido, a mensagem é ignorada. Ao iniciar a verificação, o número é enviado a `/known-phones` para o motor conseguir resolver LIDs.
- **Recebe**: texto, cliques (botão, lista, native flow) e mídia inline (`media.data`, áudio/imagem até 8 MB) — vai direto ao Gemini, sem download extra.
- **Envia**: texto (até 4000), até 3 botões (título 20). **Não envia mídia** (`sendMediaIfSupported` ⇒ `unsupported`).
- **Sessão desconectada**: envio retorna 409 ⇒ `delivered: false`, sem derrubar o processamento; Super Admin → Canais mostra o estado.
- Variáveis (somente servidor): `WHAILEYS_API_URL`, `WHAILEYS_INSTANCE`, `WHAILEYS_TOKEN`, `WHAILEYS_WEBHOOK_SECRET`.

Implantação: ver `docs/VERCEL_DEPLOY.md` (variáveis e webhook) e `docs/RUNBOOK.md` (sessão caída).

## Aviso sobre conectores não oficiais

Whaileys e Evolution usam o protocolo do WhatsApp Web (Baileys), não a API oficial. Há risco de bloqueio do número
e de violação dos termos da Meta. Use número dedicado, volume baixo, apenas conversas iniciadas pelo
usuário, e prefira a Cloud API para escala. Uma instância não deve atender vários clientes sem desenho
e consentimento específicos (o modelo "um número por cliente" usa chave de parceiro — não adotado no MVP).
