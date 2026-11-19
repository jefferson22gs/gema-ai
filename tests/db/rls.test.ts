import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, createUser } from "./harness";

let db: PGlite;
let alice: { id: string; personalWorkspaceId: string };
let bob: { id: string; personalWorkspaceId: string };
let familyId: string;

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, "alice@example.test");
  bob = await createUser(db, "bob@example.test");
  familyId = await asUser(db, alice.id, async (tx) => {
    const { rows } = await tx.query<{ id: string }>("select public.create_workspace('Família', 'family') as id");
    return rows[0].id;
  });
});

describe("cadastro e workspace pessoal (critério 1)", () => {
  it("novo usuário recebe perfil, preferências, workspace pessoal owner e trial", async () => {
    const result = await asUser(db, alice.id, async (tx) => ({
      profile: (await tx.query("select timezone, currency from profiles")).rows,
      members: (await tx.query("select role from workspace_members where workspace_id = $1", [alice.personalWorkspaceId])).rows,
      sub: (await tx.query("select status from subscriptions where workspace_id = $1", [alice.personalWorkspaceId])).rows,
    }));
    expect(result.profile).toEqual([{ timezone: "America/Sao_Paulo", currency: "BRL" }]);
    expect(result.members).toEqual([{ role: "owner" }]);
    expect(result.sub).toEqual([{ status: "trialing" }]);
  });

  it("workspace pessoal não aceita outros membros", async () => {
    await expect(
      db.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')", [alice.personalWorkspaceId, bob.id]),
    ).rejects.toThrow(/workspace pessoal/);
  });
});

describe("isolamento entre tenants (critério 2)", () => {
  it("Bob não lê nem altera transações do workspace de Alice", async () => {
    await asUser(db, alice.id, (tx) =>
      tx.query(
        "insert into transactions (workspace_id, owner_id, kind, description, amount_cents, occurred_on) values ($1, $2, 'expense', 'Aluguel', 250000, current_date)",
        [alice.personalWorkspaceId, alice.id],
      ),
    );
    const seen = await asUser(db, bob.id, (tx) => tx.query("select * from transactions"));
    expect(seen.rows).toHaveLength(0);

    const updated = await asUser(db, bob.id, (tx) => tx.query("update transactions set amount_cents = 1"));
    expect(updated.affectedRows ?? 0).toBe(0);

    await expect(
      asUser(db, bob.id, (tx) =>
        tx.query(
          "insert into transactions (workspace_id, owner_id, kind, description, amount_cents, occurred_on) values ($1, $2, 'expense', 'Invasão', 100, current_date)",
          [alice.personalWorkspaceId, bob.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("Bob não vê workspaces, contatos ou eventos de Alice", async () => {
    await asUser(db, alice.id, async (tx) => {
      await tx.query("insert into contacts (workspace_id, owner_id, name) values ($1, $2, 'Contato privado')", [alice.personalWorkspaceId, alice.id]);
      await tx.query(
        "insert into calendar_events (workspace_id, owner_id, title, starts_at, ends_at) values ($1, $2, 'Reunião', now(), now() + interval '1 hour')",
        [alice.personalWorkspaceId, alice.id],
      );
    });
    const r = await asUser(db, bob.id, async (tx) => ({
      ws: (await tx.query("select id from workspaces")).rows,
      contacts: (await tx.query("select id from contacts")).rows,
      events: (await tx.query("select id from calendar_events")).rows,
    }));
    expect(r.ws.map((w) => (w as { id: string }).id)).toEqual([bob.personalWorkspaceId]);
    expect(r.contacts).toHaveLength(0);
    expect(r.events).toHaveLength(0);
  });

  it("anon não lê dados de negócio, apenas planos públicos", async () => {
    const plans = await asAnon(db, (tx) => tx.query("select id from plans"));
    expect(plans.rows.length).toBeGreaterThanOrEqual(4);
    await expect(asAnon(db, (tx) => tx.query("select * from transactions"))).rejects.toThrow(/permission denied/);
  });
});

describe("workspace família: privado vs compartilhado", () => {
  beforeAll(async () => {
    await asUser(db, alice.id, (tx) =>
      tx.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')", [familyId, bob.id]),
    );
    await asUser(db, alice.id, async (tx) => {
      await tx.query(
        "insert into transactions (workspace_id, owner_id, visibility, kind, description, amount_cents, occurred_on) values ($1, $2, 'workspace', 'expense', 'Mercado da casa', 40000, current_date)",
        [familyId, alice.id],
      );
      await tx.query(
        "insert into transactions (workspace_id, owner_id, visibility, kind, description, amount_cents, occurred_on) values ($1, $2, 'private', 'expense', 'Presente surpresa', 9000, current_date)",
        [familyId, alice.id],
      );
    });
  });

  it("membro vê apenas itens compartilhados do workspace família", async () => {
    const { rows } = await asUser(db, bob.id, (tx) =>
      tx.query<{ description: string }>("select description from transactions where workspace_id = $1", [familyId]),
    );
    expect(rows.map((r) => r.description)).toEqual(["Mercado da casa"]);
  });

  it("pertencer à família não expõe o workspace pessoal", async () => {
    const { rows } = await asUser(db, bob.id, (tx) =>
      tx.query("select id from transactions where workspace_id = $1", [alice.personalWorkspaceId]),
    );
    expect(rows).toHaveLength(0);
  });

  it("membro não altera item compartilhado de outro (só admin/owner)", async () => {
    const res = await asUser(db, bob.id, (tx) =>
      tx.query("update transactions set amount_cents = 1 where workspace_id = $1", [familyId]),
    );
    expect(res.affectedRows ?? 0).toBe(0);
  });

  it("conversas são privadas mesmo dentro da família", async () => {
    await asUser(db, alice.id, async (tx) => {
      const c = await tx.query<{ id: string }>("insert into conversations (workspace_id, owner_id) values ($1, $2) returning id", [familyId, alice.id]);
      await tx.query("insert into messages (conversation_id, workspace_id, owner_id, role, content) values ($1, $2, $3, 'user', 'segredo')", [c.rows[0].id, familyId, alice.id]);
    });
    const { rows } = await asUser(db, bob.id, (tx) => tx.query("select content from messages"));
    expect(rows).toHaveLength(0);
  });
});

describe("documentos privados (critério 11)", () => {
  it("objeto de storage só é legível por quem lê o documento", async () => {
    const path = `${alice.personalWorkspaceId}/${alice.id}/abc-recibo.pdf`;
    await asUser(db, alice.id, async (tx) => {
      await tx.query("insert into storage.objects (bucket_id, name) values ('documents', $1)", [path]);
      await tx.query(
        "insert into documents (workspace_id, owner_id, storage_path, file_name, mime_type, size_bytes) values ($1, $2, $3, 'recibo.pdf', 'application/pdf', 1000)",
        [alice.personalWorkspaceId, alice.id, path],
      );
    });
    const own = await asUser(db, alice.id, (tx) => tx.query("select name from storage.objects"));
    const other = await asUser(db, bob.id, (tx) => tx.query("select name from storage.objects"));
    expect(own.rows).toHaveLength(1);
    expect(other.rows).toHaveLength(0);
  });

  it("não permite upload no caminho de outro usuário/workspace", async () => {
    await expect(
      asUser(db, bob.id, (tx) =>
        tx.query("insert into storage.objects (bucket_id, name) values ('documents', $1)", [`${alice.personalWorkspaceId}/${alice.id}/x.pdf`]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("dados server-only e superadmin (critério 12)", () => {
  it("tokens OAuth, webhooks e admins não são acessíveis ao cliente", async () => {
    for (const table of ["encrypted_oauth_tokens", "provider_webhook_events", "platform_admins", "email_messages", "system_jobs"]) {
      await expect(asUser(db, alice.id, (tx) => tx.query(`select * from ${table}`))).rejects.toThrow(/permission denied/);
    }
  });

  it("ser super admin não concede leitura de mensagens via RLS", async () => {
    const admin = await createUser(db, "admin@example.test");
    await db.query("insert into platform_admins (user_id) values ($1)", [admin.id]);
    const { rows } = await asUser(db, admin.id, (tx) => tx.query("select * from messages"));
    expect(rows).toHaveLength(0);
  });

  it("toda tabela pública tem RLS habilitada", async () => {
    const { rows } = await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and not rowsecurity",
    );
    expect(rows).toEqual([]);
  });
});

describe("idempotência e dedupe no banco (critério 3)", () => {
  it("mesma idempotency_key não cria transação duplicada", async () => {
    const insert = (tx: Parameters<Parameters<typeof asUser>[2]>[0]) =>
      tx.query(
        `insert into transactions (workspace_id, owner_id, kind, description, amount_cents, occurred_on, idempotency_key)
         values ($1, $2, 'expense', 'Almoço', 8500, current_date, 'msg-1:0') on conflict (workspace_id, idempotency_key) do nothing`,
        [alice.personalWorkspaceId, alice.id],
      );
    await asUser(db, alice.id, insert);
    await asUser(db, alice.id, insert);
    const { rows } = await asUser(db, alice.id, (tx) => tx.query("select id from transactions where idempotency_key = 'msg-1:0'"));
    expect(rows).toHaveLength(1);
  });
});
