/**
 * Propósito: popula um workspace com DADOS DE DEMONSTRAÇÃO claramente rotulados ("[DEMO]").
 * Reutilizável: SIM. Segurança: exige ALLOW_DEMO_SEED=true e recusa NODE_ENV=production
 * ou VERCEL_ENV=production. Uso: ALLOW_DEMO_SEED=true DATABASE_URL=... node scripts/seed-demo.mjs <email-do-usuario>
 */
import postgres from "postgres";

const email = process.argv[2];
if (process.env.ALLOW_DEMO_SEED !== "true") throw new Error("Defina ALLOW_DEMO_SEED=true para executar o seed de demonstração.");
if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") throw new Error("Seed de demonstração bloqueado em produção.");
if (!process.env.DATABASE_URL || !email) throw new Error("Uso: node scripts/seed-demo.mjs <email> (com DATABASE_URL).");

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
try {
  const [user] = await sql`select p.id, w.id as workspace_id from profiles p join workspaces w on w.created_by = p.id and w.kind = 'personal' where lower(p.email) = lower(${email})`;
  if (!user) throw new Error(`Usuário ${email} não encontrado (crie a conta pelo cadastro primeiro).`);
  const ws = user.workspace_id;
  const cat = async (slug) => (await sql`select id from categories where workspace_id is null and slug = ${slug}`)[0]?.id;
  await sql.begin(async (tx) => {
    await tx`insert into transactions (workspace_id, owner_id, kind, description, amount_cents, category_id, occurred_on, source, idempotency_key)
      values (${ws}, ${user.id}, 'expense', '[DEMO] Almoço', 8500, ${await cat("alimentacao")}, current_date, 'import', 'demo:tx1'),
             (${ws}, ${user.id}, 'expense', '[DEMO] Combustível', 4000, ${await cat("combustivel")}, current_date, 'import', 'demo:tx2'),
             (${ws}, ${user.id}, 'income', '[DEMO] Honorários', 450000, ${await cat("vendas")}, current_date - 3, 'import', 'demo:tx3')
      on conflict (workspace_id, idempotency_key) do nothing`;
    await tx`insert into transactions (workspace_id, owner_id, kind, description, amount_cents, category_id, occurred_on, status, due_on, source, idempotency_key)
      values (${ws}, ${user.id}, 'expense', '[DEMO] Conta de luz', 18990, ${await cat("moradia")}, current_date, 'pending', current_date + 3, 'import', 'demo:tx4')
      on conflict (workspace_id, idempotency_key) do nothing`;
    await tx`insert into tasks (workspace_id, owner_id, title, priority, due_at, idempotency_key)
      values (${ws}, ${user.id}, '[DEMO] Enviar proposta comercial', 'high', now() + interval '1 day', 'demo:t1'),
             (${ws}, ${user.id}, '[DEMO] Revisar contrato', 'medium', now() - interval '1 day', 'demo:t2')
      on conflict (workspace_id, idempotency_key) do nothing`;
    await tx`insert into calendar_events (workspace_id, owner_id, title, starts_at, ends_at, idempotency_key)
      values (${ws}, ${user.id}, '[DEMO] Reunião de alinhamento', date_trunc('hour', now()) + interval '26 hours', date_trunc('hour', now()) + interval '27 hours', 'demo:e1')
      on conflict (workspace_id, idempotency_key) do nothing`;
  });
  console.log(`Dados [DEMO] inseridos no workspace pessoal de ${email}.`);
} finally {
  await sql.end();
}
