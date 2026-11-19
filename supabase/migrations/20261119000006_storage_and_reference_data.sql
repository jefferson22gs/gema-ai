-- GEMA AI — Bucket privado de documentos e dados de referência (planos, categorias, flags).

-- Caminho obrigatório: <workspace_id>/<owner_id>/<uuid>-<arquivo>. Bucket privado; acesso via URL assinada.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'])
on conflict (id) do update set public = false;

create policy documents_bucket_read on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
      where d.storage_path = storage.objects.name
        and d.deleted_at is null
        and app.can_read(d.workspace_id, d.visibility, d.owner_id)
    )
  );

create policy documents_bucket_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[2] = auth.uid()::text
    and app.is_member(((storage.foldername(name))[1])::uuid, 'member')
  );

create policy documents_bucket_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[2] = auth.uid()::text);

-- Planos (preços em centavos BRL; valores comerciais a confirmar pelo proprietário).
insert into public.plans (id, name, description, price_cents, limits, features, sort_order) values
  ('essential', 'Essential', 'Agenda, finanças, tarefas e relatórios básicos.', 2990,
   '{"ai_messages_month": 300, "ai_tokens_month": 600000, "storage_mb": 200, "automations": 3, "members": 1, "whatsapp_messages_month": 0}',
   array['agenda', 'financas', 'tarefas', 'contatos', 'relatorios_basicos'], 1),
  ('premium', 'Premium', 'Briefing diário, áudio, memória consentida, documentos, automações e integrações.', 5990,
   '{"ai_messages_month": 1500, "ai_tokens_month": 3000000, "storage_mb": 2048, "automations": 20, "members": 1, "whatsapp_messages_month": 1000}',
   array['agenda', 'financas', 'tarefas', 'contatos', 'relatorios_basicos', 'briefing', 'audio', 'memoria', 'documentos', 'automacoes', 'integracoes'], 2),
  ('executive', 'Executive', 'Multiagenda, relatórios executivos, projetos e integrações de negócios.', 11990,
   '{"ai_messages_month": 5000, "ai_tokens_month": 10000000, "storage_mb": 10240, "automations": 100, "members": 10, "whatsapp_messages_month": 5000}',
   array['agenda', 'financas', 'tarefas', 'contatos', 'relatorios_basicos', 'briefing', 'audio', 'memoria', 'documentos', 'automacoes', 'integracoes', 'multiagenda', 'relatorios_executivos', 'projetos', 'integracoes_negocio'], 3),
  ('family', 'Family / Teams', 'Membros, convites, compartilhamento seletivo e funções por workspace.', 8990,
   '{"ai_messages_month": 4000, "ai_tokens_month": 8000000, "storage_mb": 8192, "automations": 50, "members": 6, "whatsapp_messages_month": 3000}',
   array['agenda', 'financas', 'tarefas', 'contatos', 'relatorios_basicos', 'briefing', 'audio', 'documentos', 'automacoes', 'integracoes', 'membros', 'compartilhamento'], 4)
on conflict (id) do update set
  name = excluded.name, description = excluded.description, price_cents = excluded.price_cents,
  limits = excluded.limits, features = excluded.features, sort_order = excluded.sort_order;

insert into public.categories (workspace_id, slug, name, kind, icon) values
  (null, 'alimentacao', 'Alimentação', 'expense', 'utensils'),
  (null, 'transporte', 'Transporte', 'expense', 'car'),
  (null, 'combustivel', 'Combustível', 'expense', 'fuel'),
  (null, 'moradia', 'Moradia', 'expense', 'home'),
  (null, 'saude', 'Saúde', 'expense', 'heart-pulse'),
  (null, 'educacao', 'Educação', 'expense', 'graduation-cap'),
  (null, 'lazer', 'Lazer', 'expense', 'party-popper'),
  (null, 'compras', 'Compras', 'expense', 'shopping-bag'),
  (null, 'servicos', 'Serviços e assinaturas', 'expense', 'receipt'),
  (null, 'impostos', 'Impostos e taxas', 'expense', 'landmark'),
  (null, 'outros-despesa', 'Outros', 'expense', 'circle'),
  (null, 'salario', 'Salário', 'income', 'wallet'),
  (null, 'vendas', 'Vendas e serviços', 'income', 'briefcase'),
  (null, 'investimentos', 'Investimentos', 'income', 'trending-up'),
  (null, 'outros-receita', 'Outras receitas', 'income', 'circle')
on conflict do nothing;

insert into public.feature_flags (key, description, enabled) values
  ('integration.google', 'Integração Google Calendar/Contacts (requer GOOGLE_CLIENT_ID/SECRET).', true),
  ('integration.evolution', 'Canal WhatsApp via Evolution API (requer host persistente externo).', true),
  ('integration.meta_cloud', 'Canal WhatsApp Cloud API oficial da Meta.', true),
  ('integration.baileys_whaileys', 'Adaptador Baileys/Whaileys — desativado: repositório sem código verificado.', false),
  ('integration.agendafacil365', 'Conector AgendaFácil365 — aguardando API oficial.', false),
  ('feature.audio', 'Comandos por áudio via Gemini.', true),
  ('feature.document_extraction', 'Extração de comprovantes via Gemini com revisão humana.', true),
  ('feature.push', 'Notificações push PWA (requer chaves VAPID).', true)
on conflict (key) do nothing;
