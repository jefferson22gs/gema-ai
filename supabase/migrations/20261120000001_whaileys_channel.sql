-- GEMA AI — Canal WhatsApp via motor Whaileys (botões e listas) em host persistente próprio.
-- O provedor 'baileys_whaileys' já existe nos checks de channel_accounts; aqui só a flag é atualizada.
update public.feature_flags
set description = 'Canal WhatsApp via motor Whaileys (botões e listas). Conector não oficial; requer WHAILEYS_* configuradas.',
    enabled = true,
    updated_at = now()
where key = 'integration.baileys_whaileys';
