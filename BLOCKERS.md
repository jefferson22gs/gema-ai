# Bloqueios externos

Itens que dependem de ação humana, contratação, credencial ou aprovação. Cada um referencia tarefas do backlog.

| ID | Bloqueio | Ação humana necessária | Tarefas afetadas | Desde |
|---|---|---|---|---|
| BLK-01 | Supabase de produção/staging não provisionado | Criar projetos, `supabase db push`, preencher `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` | Todos os fluxos reais (A–P), E2E autenticado | 19/11/2026 |
| BLK-02 | Domínio de produção / deploy Vercel | Informar domínio, importar repo na Vercel, DNS Registro.br → Cloudflare | Webhooks WhatsApp, OAuth Google, PWA instalável real | 19/11/2026 |
| BLK-03 | Instância `gema-ai` na Evolution/Whaileys não criada | Autorizar `evo.sh create` / `wh.sh create` (requer BLK-02) e parear o número | WA-* homologação, Fluxos A/B/C/M | 20/11/2026 |
| BLK-04 | `GEMINI_API_KEY` | Criar chave no Google AI Studio / Vertex e definir teto de custo | IA real, transcrição, OCR, pesquisa com grounding | 19/11/2026 |
| BLK-05 | Pluggy (Open Finance) | Conta Pluggy (sandbox é gratuita) → `PLUGGY_CLIENT_ID/SECRET`; contrato de produção depende de aprovação | OF-* homologação, Fluxo D | 26/11/2026 |
| BLK-06 | Asaas (cobranças SaaS e clientes) | Conta sandbox Asaas → `ASAAS_API_KEY`, `ASAAS_WEBHOOK_SECRET` | PAY-*, SAAS-*, Fluxos J/N | 26/11/2026 |
| BLK-07 | Google Cloud OAuth (Calendar, People, Gmail, Drive, Meet) | Projeto GCP, tela de consentimento, verificação do app para escopos sensíveis/restritos (Gmail/Drive) | AG-*, MAIL-*, DRV-*, MEET-* | 19/11/2026 |
| BLK-08 | Provedor fiscal homologado (NFS-e) | Escolher provedor (ex.: emissor homologado/padrão nacional), certificado digital A1 da empresa de teste | FIS-* emissão, Fluxo K | 26/11/2026 |
| BLK-09 | Resend/Brevo | Chaves + domínio verificado (SPF/DKIM) | Notificações por e-mail reais | 19/11/2026 |
| BLK-10 | WhatsApp Cloud API (Meta) | Conta Business verificada, número, templates aprovados | WA-CLOUD-*, avisos fora da janela 24 h | 19/11/2026 |
| BLK-11 | Revisão jurídica (LGPD, termos, DPO) | Advogado/DPO revisar minutas, definir encarregado | LGPD-*, publicação comercial | 19/11/2026 |
| BLK-12 | Lojas de aplicativos | Contas Google Play / Apple Developer, ambiente macOS para iOS | APP-* builds nativos | 26/11/2026 |
| BLK-13 | Pesquisa web / preços de viagens | Gemini com grounding (BLK-04) ou provedor de busca contratado | RES-* resultados reais | 26/11/2026 |
