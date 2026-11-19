# Google OAuth (Calendar + People)

## Configuração no Google Cloud

1. Criar projeto e habilitar **Google Calendar API** e **People API**.
2. Tela de consentimento OAuth (externo), domínio verificado, links de privacidade/termos.
3. Credencial "Aplicativo da Web" com redirect: `https://<APP_DOMAIN>/api/oauth/google/callback` (e `http://localhost:3000/...` em dev).
4. Variáveis: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `OAUTH_ENCRYPTION_KEY` (32 bytes base64).
5. Escopos `calendar.events` e `contacts` são sensíveis: publicação para o público exige **verificação do app pelo Google**.

## Escopos (mínimos, por produto)

| Produto | Escopos |
|---|---|
| Agenda | `calendar.events`, `calendar.freebusy` |
| Contatos | `contacts` |

## Fluxo

`/api/oauth/google/start?product=calendar|contacts` → state (hash salvo, uso único, 10 min) + PKCE S256
→ Google → `/callback` valida state **e** usuário da sessão → troca code → tokens cifrados em
`encrypted_oauth_tokens` → `integrations.status = connected`. Refresh automático; `invalid_grant` marca erro e pede reconexão.
Desconectar revoga no Google (best-effort) e apaga tokens locais.

## Sincronização

- GEMA → Google: somente após confirmação; `extendedProperties.private.gemaOrigin = gema-ai`; `external_id` persistido.
- Google → GEMA: "Sincronizar agora" (incremental por `syncToken`, reinício em 410), dedupe por `external_id`, atualização só se `etag` mudou.
- Pendente: canal de push (`events.watch`) e reconciliação bidirecional de edições (P1).

Login com Google (Supabase Auth) é separado: configure o provedor Google no Supabase e defina `NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED=true`.
