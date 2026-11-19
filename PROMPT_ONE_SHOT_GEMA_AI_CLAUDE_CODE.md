# PROMPT ONE-SHOT — GEMA AI | ASSESSOR EXECUTIVO PREMIUM

> Copie TODO este documento para o Claude Code, preferencialmente dentro da pasta de um novo repositório Git dedicado ao projeto. Data da especificação: 19/11/2026. Este é um produto novo e independente da Código Base. Nome GEMA AI é nome de trabalho, sujeito a confirmação de marca e domínio.

## PAPEL E MISSÃO

Você é um time sênior multidisciplinar atuando diretamente no repositório: arquiteto SaaS, staff engineer full-stack, engenheiro de integrações, engenheiro de IA e agentes, especialista em segurança/LGPD, designer de produto premium e QA. Sua missão é **IMPLEMENTAR**, não apenas descrever, uma plataforma chamada **GEMA AI — Assessor Executivo Inteligente 24h**, um SaaS multi-tenant B2C/B2B, mobile-first, com painel web e PWA e interfaces conversacionais por WhatsApp (conforme termos, disponibilidade e autorização). O sistema organiza finanças, agenda, contatos, tarefas, compromissos, documentos e relatórios, com ações efetivas por comandos de texto e áudio, integração Google Calendar/Contacts, e futura integração AgendaFácil365. Tenha uma experiência visual elite premium, não uma landing page genérica.

**IMPORTANTE:** o produto deve ser generalista quanto ao público (qualquer pessoa, família, profissional, empresa), mas segmentado em ferramentas e permissões. Não prometa funcionalidades de APIs indisponíveis nem infrinja políticas dos fornecedores. Não execute pagamentos/transferências, envie mensagens em nome de alguém, compartilhe dados ou apague registros críticos sem confirmação explícita. Não prometa reconhecimento contínuo de voz/hotword em segundo plano no WhatsApp ou PWA.

## PRINCÍPIOS DE EXECUÇÃO ONE-SHOT

1. Ao iniciar, inspecione o repositório existente (`pwd`, estrutura, branches, package.json, docs, testes, infra) e preserve código útil. Se estiver vazio, inicialize corretamente. Não altere nem faça deploy de outros produtos sem autorização.
2. Faça uma verificação rápida da documentação atual das bibliotecas/APIs que conseguir acessar; em caso de ausência de acesso, implemente interfaces versionadas e documente suposições em `docs/ASSUMPTIONS.md`.
3. Gere um plano em `docs/IMPLEMENTATION_PLAN.md`, mas **continue executando sem parar na fase de planejamento**. Construa código, migrações, componentes, rotas, testes e documentação.
4. Priorize funcionamento de ponta a ponta para o MVP e deixe os recursos externos sem credenciais com estado explícito `Não configurado`; implemente conectores reais prontos para credenciais e testes de contrato com mocks **apenas em ambiente de teste**. Não apresente dados falsos como dados reais.
5. Ao final rode lint, typecheck, testes e build, conserte falhas e reporte resultados verdadeiros. Nunca alegue produção pronta sem ambiente, chaves e deploy validados.
6. Não pergunte preferências visuais ou escolhas técnicas menores; use as decisões deste documento. Solicite apenas segredos/consentimentos imprescindíveis na etapa operacional e nunca grave segredos no Git.
7. Commits pequenos e claros, respeitando permissões de acesso; não force push, não remova branches, não altere produção existente.

## STACK OBRIGATÓRIA DO PROPRIETÁRIO

- **GitHub**: fonte única de código, issues, PRs e GitHub Actions para CI/CD.
- **Vercel**: deploy de site, painel web, PWA e rotas serverless compatíveis, com preview e produção, Next.js App Router + React + TypeScript (strict), Tailwind e shadcn/ui; use Zod, React Hook Form, TanStack Query onde apropriado.
- **Registro.br**: domínio adquirido pelo proprietário; **Cloudflare**: DNS, SSL, políticas de segurança, cache apropriado, rate limiting/WAF quando disponível. Não alegue que criou domínio, alterou DNS ou ativou SSL sem credenciais e confirmação.
- **Supabase**: PostgreSQL, Auth, Storage, RLS, Realtime quando justificável, Edge Functions e jobs/pg_cron ou fila confiável conforme disponibilidade do projeto. Toda migration versionada em `supabase/migrations/`.
- **Gemini API**: provedor primário e obrigatório de IA. Usar SDK oficial atual para Node, com tool/function calling estruturado, validação Zod, processamento multimodal quando modelo permitir e seleção de modelo por configuração. Não acople o domínio à resposta em texto do modelo.
- **Resend + Brevo**: ambos integrados por interface `EmailProvider`; Resend padrão, Brevo secundário configurável/fallback sob erro comprovado, com chave de idempotência, status de envio, webhooks e controle de duplicidade. Templates transacionais português brasileiro.
- **WhatsApp Evolution API**: canal integrado mediante instância configurada; suporta recursos conforme a configuração/versão real da API. Priorizar **Cloud API oficial Meta** para cenários aptos, via adaptador separado, respeitando opt-in, templates, limites de mensagens, período de atendimento e termos vigentes.
- **Baileys/Whaileys**: prever adaptador opcional para o repositório `https://github.com/jefferson22gs/baileys_whaileys_button_list.git`. **Verificação em 19/11/2026: repositório público aparece vazio**. Não invente arquivos/classes/funções desse repo, nem declare uma integração pronta. Definir contrato e documentação de onboarding; só conectar caso código real seja disponibilizado e após revisar compatibilidade e termos. Não usar contornos para burlar políticas/banimentos de WhatsApp. Aviso administrativo de riscos de conectores não oficiais.
- **Google Calendar API**: OAuth 2.0, leitura/escrita de eventos autorizados, consultas free/busy, recorrência, id externo, sincronização incremental/webhooks quando disponível, gestão de conflitos e fusos.
- **Google People API**: OAuth 2.0 e escopo mínimo para contatos, criação de contatos com confirmação, deduplicação e pesquisa. Nunca escrever na agenda do dispositivo sem API/permissão real; diferenciar agenda Google e contatos Google.
- **Agenda Fácil 365**: integração planejada com `https://github.com/jefferson22gs/agendafacil365` e `https://agendafacil365.com.br/` através de APIs/autenticação oficiais. NÃO compartilhar service role, não acessar tabelas de produção diretamente, não presumir endpoints sem ler o código/documentação. Se não houver API pública adequada, implementar contrato/adaptador e especificação de endpoints seguros a serem desenvolvidos no Agenda Fácil em projeto separado.
- **Pagamento SaaS**: abstração de BillingProvider para assinatura, webhooks assinados, faturas e limitações de plano; escolher implementação efetiva quando houver credenciais e provedor autorizado. Não simular cobrança real como concluída.

**Restrição crucial de infraestrutura:** o processo persistente da Evolution API/Baileys (conexões, QR, sockets, sessões) NÃO deve rodar em função serverless da Vercel. Criar serviço isolado containerizado com Docker Compose, healthcheck e persistência, para hospedar em VPS/serviço de contêiner separado, atrás de domínio como `wa.<dominio>` no Cloudflare. O webapp, PWA e rotas curtas permanecem na Vercel; workloads demorados/retries/schedulers ficam no Supabase/worker apropriado. Se o usuário ainda não tiver host persistente, entregar Docker e runbook sem fingir funcionamento.

## IDENTIDADE PREMIUM ELITE

Nome provisório: GEMA AI. Personalidade: assessor competente, discreto, objetivo, amigável e sofisticado, em PT-BR; nome configurável pelo usuário, sem personificação humana enganosa. Direção de arte: **Dark Executive** como padrão (grafite #111318, superfície #1C2530, dourado discreto #B8A177, off-white #F5F3EE, verde status #82C4A9), modo Light Signature, tipografia moderna (Inter/Geist ou equivalente), navegação minimalista, microinterações contidas, skeletons, motion reduzido acessível, contraste WCAG AA, mobile-first, desktop amplo. Criar tokens centralizados, componentes reutilizáveis e empty/error states. Não usar ouro brilhante excessivo, textos inflados, dados fake mascarados como produção.

Site público elegante: hero, demonstração honesta, casos de uso, como funciona, planos, FAQ, privacidade, termos, contato, chamada para cadastro. Painel e PWA com identidade premium, onboarding guiado, tour contextual, central de ajuda e treinamento. Separar workspace pessoal/família/negócios.

## PÚBLICOS, PLANOS E PERMISSÕES

- Essential: agenda, finanças, tarefas e relatórios básicos.
- Premium: briefing diário, áudio, memória consentida, documentos, automações, integrações.
- Executive: multiagenda, relatórios executivos, projetos e integrações de negócios.
- Family/Teams: membros, convites, compartilhamentos seletivos e funções por workspace.
- Super Admin SaaS: administração global com segregação, suporte auditado e minimização de dados; não ter acesso irrestrito à vida privada do cliente por padrão.

Entidades: usuário pode pertencer a múltiplos workspaces; workspace `personal`, `family` ou `business`; papéis `owner`, `admin`, `member`, `viewer`; permissões por recurso e dado. Separar informações privadas de dados compartilhados, inclusive finanças. Superadmin fora do escopo de RLS de cliente com rotas administrativas e auditoria reforçada. Limites de IA, tokens, mensagens, storage, automações e membros por plano.

## MÓDULOS FUNCIONAIS OBRIGATÓRIOS

### 1. Identidade, acesso e onboarding
Cadastro, login email/senha e OAuth Google opcional, recuperação, verificação, sessão segura, 2FA se viável; perfil, telefone, idioma pt-BR, timezone (padrão America/Sao_Paulo, customizável), moeda BRL, preferências, privacidade/consentimentos, onboarding com escolha de plano e workspace. Vincular telefone WhatsApp à conta apenas após comprovação de posse do número; não confiar em número informado em payload isolado. Página de integrações mostrando `Conectado`, `Aguardando autorização`, `Erro`, `Não configurado`.

### 2. Conversação e motor de IA
Chat em painel e WhatsApp, conversas por workspace, histórico com retenção configurável, comandos multimodais texto/áudio/imagem onde houver compatibilidade, limite de tamanho, moderação, timeouts e fallback. O Gemini deve extrair intenções e argumentos estruturados via function calling, jamais acessar o banco diretamente. Modelos: texto de conversa, transcrição/entendimento de áudio e extração de comprovantes via Gemini quando disponível; registrar custo estimado real por solicitação. Respostas curtas e precisas em PT-BR, verificar datas relativas usando timezone do usuário e relógio no servidor. Corrigir ambiguidades importantes e pedir confirmação de alterações sensíveis.

Design e implemente registry de ferramentas com Zod, autorização por workspace/ator, logging de ação, idempotência, transação e status `proposed/awaiting_confirmation/running/succeeded/failed/cancelled`:
`get_day_briefing`, `list_calendar_events`, `check_availability`, `create_calendar_event`, `update_calendar_event`, `cancel_calendar_event`, `create_contact`, `find_contact`, `create_expense`, `create_income`, `list_transactions`, `create_task`, `complete_task`, `create_reminder`, `list_reminders`, `search_documents`, `generate_report`, `list_business_integrations` (sem execução de ação externa inexistente), `request_confirmation`.

Exemplo A: 'Gema, gastei 85 no almoço e 40 no combustível' => duas despesas classificadas sem duplicar; feedback com resumo.
Exemplo B: 'Gema, marca reunião com Jefferson amanhã às 10' => identificar data real, conferir conflito, criar internamente, e se Google autorizado criar no calendário externo após confirmação conforme preferências; pedir local/duração se necessário, com defaults explícitos.
Exemplo C: 'Gema, grave o contato Jefferson +55 11 ...' => validar número E.164, confirmar operação e gravar em Google Contatos após OAuth, mostrar ID/resultado real e tratar duplicado.
Exemplo D: áudio com 3 ações => decompor, validar, executar separadamente, não perder ações por falha parcial, resposta de status por item.

### 3. Agenda executiva
Calendário dia/semana/mês, compromissos locais e Google Calendar conectados, eventos recorrentes, notas, locais, participantes, horários livres, conflitos, timezone/DST, cancelamento/reagendamento, lembretes, briefings. Deduplicação por external_id, merge e sync cursor; preservar origem e evitar loops de sincronização. Não convidar terceiros nem disparar mensagens sem confirmação.

### 4. Contatos inteligentes
CRUD local de contatos, etiquetas, vínculos com tarefas/reuniões, pesquisa, importação autorizada, deduplicação, Google People API com escopos mínimos e confirmação de escrita. Não usar lista completa de contatos para treinamento da IA ou marketing. Permitir revogar integração e remover tokens.

### 5. Finanças pessoais
Receitas/despesas, descrição, valor Decimal (ou centavos inteiros), categorias, tags, método, conta, parcelas, recorrências, vencimentos, pago/pendente, anexos de comprovantes, orçamento por categoria, metas, gráficos, comparação mensal, fluxo de caixa e alertas. Dashboard com dados reais; resumo diário/semanal/mensal; exportação CSV/PDF e importação controlada como evolução. Transações irreversíveis ou potencialmente sensíveis exigem confirmação. Não promover o sistema a assessor financeiro regulamentado. Open Finance apenas como conector futuro consentido com parceiro autorizado, jamais armazenar senha bancária ou implementar scraping.

### 6. Tarefas, projetos e automações
CRUD tarefas, prioridades, etiquetas, projetos/listas, recorrência, dependências leves, prazo, checklist, conclusão, busca, filtros e notificações. Motor de automações do tipo gatilho-condição-ação com templates: briefing às 07:00, fatura 3 dias antes, resumo semanal, tarefa atrasada, compromisso chegando; timezone por usuário, outbox/filas, retries exponenciais, dead-letter, idempotência por ocorrência, limites de frequência, quiet hours, opt-out por canal. Separar preparação de envio e decisão de canal.

### 7. Briefing Executivo 360°
Compor fontes agenda, finanças, tarefas, lembretes e projetos. Distinguir fatos confirmados de recomendações da IA, explicar origem dos dados e permitir ver detalhes. Agendamento personalizado, canais PWA push/email/WhatsApp conforme consentimentos e políticas. Modo silencioso e frequência limitada. Não alucinar transações, eventos ou métricas.

### 8. Documentos e comprovantes
Upload autenticado em Supabase Storage com bucket privado e URLs assinadas temporárias, validação MIME/tamanho, antivirus/sanitização quando houver serviço apropriado, extração de texto/valores/datas e revisão pelo usuário antes de lançar como despesa/conta. Busca por metadados com controle de acesso. Retenção, exclusão e exportação LGPD.

### 9. Modo Família / Empresário
Workspaces e permissão granular, calendário compartilhado, despesas compartilhadas só se autorizadas, tarefas delegadas e projetos, relatórios agregados permitidos. Integração futura ComandaZero/Frota Easy/Portaria Prime apenas mediante APIs seguras disponibilizadas, contratos explícitos e OAuth/API key com escopo por empresa.

### 10. Super Admin e cobrança
Painel de clientes/workspaces, planos, status de assinatura, limites, métricas MRR/uso por período, consumo de Gemini, e-mails, WhatsApp, storage, filas, jobs falhos, integrações, falhas de webhook, auditoria, templates, feature flags, saúde de provedores, suporte com trilha de acesso. Billing com estados `trialing/active/past_due/cancelled`, webhook assinado e grace period. Não armazenar número completo de cartão. Serviço de billing plugável.

### 11. Experiência de qualidade
Central de notificações, busca global, atalhos/command bar, comandos sugeridos, preferências de estilo da IA, tour de onboarding, ajuda e treinamento com telas do sistema (capturas geradas no ambiente real de teste), páginas de feedback, acessibilidade, SEO no site público, responsividade completa. PWA installable com manifest, icons gerados pelo projeto, service worker com cache seguro apenas de shell/recursos não privados, offline page, nunca cachear dados sensíveis sem proteção.

## WHATSAPP / MENSAGENS

Definir interface tipada `MessagingProvider` com implementações: `EvolutionProvider`, `MetaCloudProvider`, `BaileysWhaileysProvider` (stub de contrato enquanto repositório vazio), `DashboardChatProvider`. Funções `receive`, `sendText`, `sendInteractiveIfSupported`, `sendMediaIfSupported`, `ack`, `health`, `disconnect`. Normalizar todos os eventos recebidos para esquema único, verificar assinatura/secret e origem de webhooks por provedor, dedupe por provider_message_id, evitar auto-resposta em loop e mensagens enviadas pelo próprio bot, rate limiting e retries.

Cada workspace/usuário deve ter associação explícita a identidade de canal; número de telefone não substitui autenticação/autorização. Comandos de menu/botões com fallback textual quando tipo interativo não for suportado ou aprovado. Monitorar instância conectada/desconectada, QR apenas em ambiente/provedor apropriado e acesso administrativo, não armazenar QR livremente. Nunca enviar mensagens em massa não solicitadas. Templates aprovados fora da janela de atendimento quando aplicável. Falha de entrega => status transparente, fallback para email/push se consentido, sem duplicar alerta.

Criar Docker Compose/runbook para host persistente de Evolution, variáveis de ambiente sem segredo real, reverse proxy/TLS via Cloudflare e política de backups; Vercel não executa sessão Baileys persistente. Não usar uma instância de WhatsApp para vários clientes sem desenho/consentimento/autorização correspondentes.

## E-MAIL TRANSACIONAL

Implementar `EmailProvider` com Resend e Brevo. Templates: verificação/login, boas-vindas, cobrança/recibo, briefing, lembrete, segurança, integração desconectada, resumo semanal. Priorização e fallback configuráveis em painel admin. Idempotência por template+destinatário+evento e registro de tentativas; fallback automático apenas se 1º provedor comprovadamente não aceitou a mensagem (sem resultado ambíguo). Webhooks de entregue/falhou/bounce. SPF, DKIM, DMARC e DNS orientados em `docs/CLOUDFLARE_DNS.md`.

## MODELO DE DADOS MÍNIMO (POSTGRES/SUPABASE)

Criar migrations com PK UUID, created_at/updated_at, índices, FKs, soft-delete quando justificado, constraints, RLS + políticas testadas. Entidades sugeridas: `profiles`, `workspaces`, `workspace_members`, `roles/permissions` (ou política codificada segura), `plans`, `subscriptions`, `billing_events`, `user_preferences`, `consent_records`, `integrations`, `encrypted_oauth_tokens` (server-only), `channel_accounts`, `provider_webhook_events`, `conversations`, `messages`, `ai_tool_executions`, `ai_usage`, `contacts`, `calendar_events`, `calendar_sync_state`, `transactions`, `financial_accounts`, `categories`, `budgets`, `recurring_transactions`, `tasks`, `task_lists`, `projects`, `reminders`, `automation_rules`, `automation_runs`, `notification_outbox`, `notification_deliveries`, `documents`, `document_extractions`, `support_cases`, `audit_logs`, `feature_flags`, `system_jobs`.

Todo recurso de negócio deve incluir `workspace_id` e owner/actor apropriado. Índices compostos por workspace. RLS com memberships válidos; workspace pessoal nunca visível a outro membro só por pertencer a workspace de família. Tokens OAuth e secrets criptografados com KMS/segredo server-side, rotação e revogação, não expor secret key Supabase nem Gemini no frontend. Usar transações SQL, locks e unique key para dedupe; timezone sempre persistido em UTC com timezone do usuário para apresentação e cálculo.

## ROTAS E TELAS

Website: `/`, `/recursos`, `/como-funciona`, `/planos`, `/seguranca`, `/privacidade`, `/termos`, `/entrar`, `/cadastro`.
Painel cliente autenticado: `/app`, `/app/assistente`, `/app/agenda`, `/app/financas`, `/app/financas/transacoes`, `/app/financas/orcamentos`, `/app/tarefas`, `/app/projetos`, `/app/contatos`, `/app/documentos`, `/app/briefings`, `/app/automacoes`, `/app/integracoes`, `/app/notificacoes`, `/app/configuracoes`, `/app/assinatura`, `/app/ajuda`.
Admin: `/super-admin` e subpáginas `/clientes`, `/planos`, `/integracoes`, `/canais`, `/emails`, `/automacoes`, `/monitoramento`, `/auditoria`, `/financeiro`, `/configuracoes`.
API endpoints `/api/health`, `/api/webhooks/evolution`, `/api/webhooks/meta`, `/api/webhooks/resend`, `/api/webhooks/brevo`, `/api/webhooks/billing`, `/api/oauth/google/start`, `/api/oauth/google/callback`, `/api/ai/chat`, `/api/automations/dispatch` entre outros, implementados com auth, validação de assinatura, anti-CSRF/estado OAuth e rate limits.

A tela principal terá briefing, quatro KPIs (compromissos, pendências, gasto do mês, contas a vencer), próximas ações, insights, mini calendário e campo 'O que posso fazer por você?'. Não criar botões sem fluxo real; links de recurso externo desabilitados e explicativos quando não configurados.

## RESILIÊNCIA, SEGURANÇA, LGPD

- RLS em todas as tabelas expostas, testes de vazamento entre dois tenants, menor privilégio e server-side guards; nenhuma secret key em cliente/PWA.
- Webhooks assinados/secret, replay protection com IDs, idempotência ponta a ponta, retry com backoff, filas e dead-letter.
- Prompt injection: nunca executar instruções presentes em documentos/mensagens de terceiros como se fossem comandos do titular; conteúdos externos não têm autoridade para chamar ferramentas.
- Tool execution: catálogo estrito, parâmetros Zod, validação adicional de existência/permissão, confirmation flow, política de ações e trilha de auditoria.
- Faturas, agenda, contatos e dados pessoais confidenciais; minimizar logs, mascarar dados, retenção configurável, exportar e excluir dados, canal de contato com encarregado, política de privacidade e termos editáveis e revisáveis por jurídico.
- Autenticação com proteção de brute force, rate limit por usuário/workspace/IP (considerar proxies Cloudflare), CSRF quando aplicável, headers/CSP, validação upload, dependências auditadas, backup e restauração documentados.
- Medição de custo por workspace, circuit breaker e limites máximos de uso para evitar gasto inesperado com Gemini, WhatsApp e email.
- Não alegar 100% de autonomia/tempo de atividade nem usar métricas fabricadas em marketing; exemplos de demo claramente sinalizados.

## TESTES E CRITÉRIOS DE ACEITE

Implementar Vitest/Jest e Playwright (ou equivalentes adequados), ao menos:
1. Usuário cadastra e cria workspace pessoal e faz login.
2. Dois workspaces isolados não acessam registros um do outro (API + RLS).
3. Conversa `gastei 85 em almoço e 40 combustível` gera exatamente duas despesas por mensagem, sem duplicar quando webhook chega duas vezes.
4. Comando de voz de três ações gera três intenções, cada uma com estado independente, sem declarar sucesso em caso de erro.
5. Evento com timezone e conflito não é criado silenciosamente.
6. Conectar Google (teste mock OAuth/contrato) e criar evento e contato com confirmação; id externo persistido.
7. Resend falha antes de aceitar e Brevo tenta com idempotência; falha ambígua não produz disparo duplicado.
8. Webhook com assinatura inválida é rejeitado e logado.
9. Briefing agrega apenas dados autorizados, identifica falta de dados, sem inventar números.
10. Lembrete recorrente é gerado uma vez por ocorrência com timezone correto, inclusive DST quando aplicável.
11. Upload de documento é privado e sem acesso cruzado.
12. Superadmin não consulta mensagens pessoais por padrão; suporte tem procedimento e auditoria.
13. Testes E2E mobile + desktop, acessibilidade básica e PWA installability.
14. Build/lint/typecheck sem erros.

## ENTREGA E IMPLANTAÇÃO

Criar `.env.example` completo, sem segredos, contemplando:
```
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=
RESEND_API_KEY=
BREVO_API_KEY=
EMAIL_FROM=
EMAIL_PRIMARY_PROVIDER=resend
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_WEBHOOK_SECRET=
META_WABA_PHONE_NUMBER_ID=
META_WHATSAPP_ACCESS_TOKEN=
META_APP_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
OAUTH_ENCRYPTION_KEY=
CRON_SECRET=
BILLING_PROVIDER=
BILLING_WEBHOOK_SECRET=
SENTRY_DSN=
```
Ajustar nomes para SDKs atuais; NUNCA exigir que todas as chaves existam para build. Falta de chave deve desabilitar integração com feedback claro, não derrubar aplicação. Não colocar private keys em `NEXT_PUBLIC_*`.

Criar:
- `README.md` com instruções claras de setup e comandos.
- `docs/ARCHITECTURE.md` (C4 ou diagramas Mermaid), `docs/DB_SCHEMA.md`, `docs/RLS_AND_SECURITY.md`, `docs/AI_TOOLS.md`, `docs/WHATSAPP_PROVIDERS.md`, `docs/GOOGLE_OAUTH.md`, `docs/EMAIL_DELIVERY.md`, `docs/AGENDA_FACIL_CONNECTOR.md`, `docs/DNS_CLOUDFLARE.md`, `docs/VERCEL_DEPLOY.md`, `docs/EVOLUTION_DOCKER.md`, `docs/RUNBOOK.md`, `docs/ROADMAP.md`, `docs/TEST_REPORT.md`, `docs/RELEASE_CHECKLIST.md`.
- `Dockerfile`/`docker-compose` do serviço persistente (ou `infra/evolution/*`), README de reverse proxy e armazenamento persistente.
- `.github/workflows/ci.yml` para lint/typecheck/test/build/security audit apropriado.
- Seeds de demo separadas por flag segura, nunca executadas em produção, com rótulo claro de dados de demonstração.
- Política de feature flags por integração e testes de estados `não configurado`.

**Domínio:** Não fixar domínio inventado. Utilizar `APP_DOMAIN`/variáveis e documentar apontamento Registro.br -> nameservers Cloudflare -> Vercel, subdomínios propostos `app`, `api` (quando necessário), `wa` (container externo), `status` (opcional). Cloudflare modo SSL adequado, DNS records verificáveis, SPF/DKIM/DMARC para Resend/Brevo. Nunca alterar registros sem confirmação do proprietário. SaaS PWA não exige subdomínio individual por cliente no MVP; planejar custom-domain/white-label posteriormente.

## IMPLEMENTAÇÃO EM ETAPAS SEM PARAR NO PLANEJAMENTO

**P0 funcional (construir agora):** esqueleto SaaS, design system premium, site público e painel, Auth/workspaces/RLS, finanças, agenda local, tarefas, contatos locais, chat com Gemini/tools, ingestão de mensagens por interface de providers, briefing, e-mail Resend/Brevo, fila de automações, logs, Super Admin básico, integração OAuth Google Calendar/People pronta para configuração, documentação, testes e deploy pronto.

**P1 integrado (implementar se viável no mesmo ciclo):** conector Evolution ativo com configuração, canais Meta, sincronização Google, áudio, comprovantes, PWA push, assinaturas com provider real quando configurado, métricas/limites, family workspace, suporte.

**P2 premium (arquitetura e, se couber, implementação):** viagens, projetos multiusuário, relatórios 360, integrador AgendaFacil365, outros produtos Código Base, white-label, Open Finance parceiro, IA proativa avançada, resumos executivos empresariais.

Não deixe a IA decidir ou dizer que um serviço está sincronizado sem ter confirmação real do provedor. Para dependências externas impossíveis de validar sem credenciais, entregue implementação com mocks de teste e informe claramente `Pendente de credenciais/teste em ambiente real`.

## RESULTADO FINAL OBRIGATÓRIO

Ao concluir, apresente: arquitetura implementada e mapa de pastas, telas e fluxos funcionando, migrations aplicáveis, RLS e testes, comandos de execução local, status real de cada integração (pronto/testado/pendente de credenciais), resultado lint/typecheck/test/build, variáveis que o proprietário precisa preencher, passos GitHub -> Vercel -> Supabase -> Registro.br/Cloudflare -> Resend/Brevo -> Google OAuth -> Evolution externo, limitações e próximos passos em prioridade. **Entregue aplicação utilizável, não só relatório ou protótipo.**

COMECE AGORA: inspecione o workspace e inicie a implementação real seguindo as prioridades acima. Se o repositório estiver vazio, inicialize o projeto. Não interrompa depois de escrever o plano; implemente o máximo possível, com qualidade verificável e sem inventar integrações ou resultados.
