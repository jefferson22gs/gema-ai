# Domínio: Registro.br → Cloudflare → Vercel

> Nenhum registro DNS foi criado ou alterado por este projeto. Execute apenas com confirmação do proprietário.

1. **Cloudflare**: adicionar o domínio (plano Free+) e anotar os 2 nameservers.
2. **Registro.br**: em "DNS" do domínio, trocar para os nameservers da Cloudflare. Aguardar propagação.
3. **Vercel**: Project → Domains → adicionar `APP_DOMAIN` (ex.: `app.seudominio.com.br`) e o apex se desejar.

## Registros

| Nome | Tipo | Valor | Proxy |
|---|---|---|---|
| `@` / `www` | CNAME/A | conforme a Vercel indicar | DNS only (recomendado pela Vercel) |
| `app` | CNAME | `cname.vercel-dns.com` | DNS only |
| `wa` | A | IP do host Evolution | Proxied (laranja) |
| `status` (opcional) | CNAME | provedor de status page | — |
| Resend | TXT/MX/CNAME | conforme painel Resend (SPF `include:amazonses.com`, DKIM `resend._domainkey`) | DNS only |
| Brevo | TXT/CNAME | conforme painel Brevo (código de verificação + DKIM) | DNS only |
| `_dmarc` | TXT | `v=DMARC1; p=quarantine; rua=mailto:dmarc@seudominio.com.br; adkim=s; aspf=s` | — |

Um único registro SPF por domínio: combine includes, ex.
`v=spf1 include:amazonses.com include:spf.brevo.com ~all` (confirme os includes exatos nos painéis).
Comece DMARC com `p=none` para monitorar e evolua para `quarantine`/`reject`.

## Cloudflare

- SSL/TLS: **Full (strict)** para `wa` (Caddy emite certificado de origem). Domínios na Vercel em DNS only.
- WAF/Rate limiting: regra em `/api/webhooks/*` e `/entrar` (ex.: 60 req/min por IP).
- Cloudflare Access (Zero Trust) para `wa.<dominio>/manager`.
- Não cachear `/app/*`, `/api/*`, `/super-admin/*`.

Custom domain/white-label por cliente: fora do MVP (ROADMAP).
