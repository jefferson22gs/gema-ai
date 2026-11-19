# Evolution API — host persistente

Arquivos em `infra/evolution/`: `docker-compose.yml` (Evolution + Postgres + Redis + Caddy), `Caddyfile`, `.env.example`.

> Não testado em host real neste ciclo (sem Docker/VPS disponível). Valide a tag da imagem e os nomes
> de variáveis contra a documentação da versão da Evolution que for implantada.

## Passos

1. VPS (2 vCPU / 2–4 GB), Docker + Compose, firewall liberando 80/443 apenas.
2. `cd infra/evolution && cp .env.example .env` e preencher (`EVOLUTION_API_KEY` forte, senha do banco).
3. DNS `wa.<dominio>` → IP da VPS (Cloudflare proxied, SSL Full strict).
4. `docker compose up -d` e `docker compose ps` (healthchecks `healthy`).
5. Criar instância (ex.: `gema`) via API/manager com acesso restrito; ler o QR no próprio host com o número dedicado.
6. Configurar webhook da instância para `https://<app>/api/webhooks/evolution` com header `x-gema-webhook-secret: <EVOLUTION_WEBHOOK_SECRET>` e evento `MESSAGES_UPSERT`.
7. Na Vercel: `EVOLUTION_API_URL=https://wa.<dominio>`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE=gema`, `EVOLUTION_WEBHOOK_SECRET`.
8. Super Admin → Canais deve mostrar "Conectado".

## Persistência e backup

Volumes `evolution_instances` (sessão), `evolution_pg`, `evolution_redis`. Backup diário:
`docker run --rm -v gema-evolution_evolution_instances:/d -v $PWD:/b alpine tar czf /b/instances-$(date +%F).tgz -C /d .`
e `pg_dump` do Postgres da Evolution. Guardar fora da VPS, cifrado.

## Segurança

Manager bloqueado no Caddy (`/manager*` → 403) — libere apenas via Cloudflare Access. QR nunca é enviado ao GEMA AI.
