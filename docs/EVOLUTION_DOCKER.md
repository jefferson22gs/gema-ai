# Evolution API — host persistente

## Caminho principal: Evolution compartilhada existente

Já existe uma Evolution **v2.3.7** em VM própria (Oracle `tubarao-v2`), pública em
`https://api.tubaraoemprestimo.com.br` via túnel Cloudflare, atendendo outros sistemas. O GEMA AI usa **uma instância
própria** nela, administrada pelo script da skill `evolution-integration` (`evo.sh`).

- O app recebe só o **token da instância** (`EVOLUTION_INSTANCE_TOKEN`) — a Evolution o aceita apenas para essa instância;
  a chave global (`AUTHENTICATION_API_KEY`) fica na VM e **não** vai para o GEMA AI.
- Webhook com header `x-evo-secret` (a Evolution não assina o corpo), `webhookBase64: true` (mídia inline), eventos
  `MESSAGES_UPSERT,CONNECTION_UPDATE`.
- Não reiniciar/atualizar o container da Evolution: outros sistemas dependem dele.

Passos (do diretório do projeto; o script grava as credenciais no `.env.local` sem exibi-las):
1. `bash evo.sh create gema-ai https://<APP_DOMAIN>/api/webhooks/evolution` (ação de produção — confirmar antes).
2. `bash evo.sh push-env .env.local <projeto-vercel>` (ou copiar as 4 variáveis para o painel da Vercel).
3. Deploy do GEMA AI (a rota precisa estar no ar com o segredo antes de mensagens chegarem).
4. `bash evo.sh connect gema-ai` (QR) ou `bash evo.sh connect gema-ai 11999998888` (código); `bash evo.sh status gema-ai` até `open`.
5. `bash evo.sh send gema-ai <seu número> "teste"`, responder e conferir Super Admin → Monitoramento.

Smoke: `curl https://api.tubaraoemprestimo.com.br/` → `"version":"2.3.7"`.

## Alternativa: host dedicado (`infra/evolution/`)

Para isolar o GEMA AI em VM própria: `docker-compose.yml` (Evolution + Postgres + Redis + Caddy), `Caddyfile`, `.env.example`.
Não testado em host real (sem Docker disponível neste ciclo); validar tag da imagem contra a versão homologada.

1. VPS (2 vCPU / 2–4 GB), Docker + Compose, firewall 80/443.
2. `cd infra/evolution && cp .env.example .env` e preencher (`EVOLUTION_API_KEY` global forte, senha do banco).
3. DNS `wa.<dominio>` → IP (Cloudflare proxied, SSL Full strict). `docker compose up -d`.
4. Criar a instância e configurar o webhook com header `x-evo-secret` (mesmo contrato do caminho principal).

Backup: volumes `evolution_instances`, `evolution_pg`, `evolution_redis` (ex.:
`docker run --rm -v gema-evolution_evolution_instances:/d -v $PWD:/b alpine tar czf /b/instances-$(date +%F).tgz -C /d .`
e `pg_dump`), guardados fora da VM e cifrados. Manager bloqueado no Caddy (`/manager*` → 403); liberar só via Cloudflare Access.
