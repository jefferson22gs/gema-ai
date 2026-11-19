# Roadmap

## P0 — entregue neste ciclo
Esqueleto SaaS, design system, site público, Auth/workspaces/RLS, finanças, agenda local, tarefas,
projetos, contatos, chat Gemini com ferramentas, ingestão de canais, briefing, e-mail Resend/Brevo,
automações + outbox, auditoria, Super Admin básico, OAuth Google pronto para credenciais, PWA, testes, CI, docs.

## P1 — implementado, pendente de validação externa
- Conector Evolution e Meta Cloud API (código + testes de contrato; falta host/credenciais).
- Sincronização Google (manual incremental; falta push `events.watch`).
- Áudio pelo painel e WhatsApp (Gemini multimodal).
- Extração de comprovantes com revisão.
- Push PWA (envio implementado; **falta UI de inscrição** do navegador e chaves VAPID).
- Assinaturas: BillingProvider + webhook assinado (falta escolher provedor e implementar checkout).
- Limites por plano, workspace família, chamados de suporte.

## P1 — pendente de implementação
- Convites de membros por e-mail (tabela pronta; falta fluxo/UI).
- Conversão de extração revisada em lançamento com 1 clique.
- Recorrência de transações (tabela pronta; job pendente).
- Templates aprovados Meta para notificações fora da janela de 24 h.
- Retenção automática de conversas (`ai_retention_days`) via job.
- Rotação de `OAUTH_ENCRYPTION_KEY` com múltiplas versões.
- 2FA (Supabase MFA TOTP).
- Busca global / command bar.
- Antivírus de upload (ex.: ClamAV em worker).
- Sentry (variável prevista).

## P2 — arquitetura
Viagens, projetos multiusuário avançados, relatórios 360 executivos, integrador AgendaFácil365 (contrato
em `AGENDA_FACIL_CONNECTOR.md`), ComandaZero/Frota Easy/Portaria Prime, white-label/custom domain,
Open Finance com parceiro autorizado, IA proativa, exportação PDF.
