import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { acceptInvitation, createInvitation, myPermissions, removeMember, revokeInvitation, updateMemberRole } from "@/server/services/members";
import { asUser, createTestDb, createUser } from "./harness";
import { pgliteDatabase } from "../support/pglite-db";

let pg: PGlite;
let db: Database;
let owner: { id: string; personalWorkspaceId: string };
let ana: { id: string; personalWorkspaceId: string };
let carlos: { id: string; personalWorkspaceId: string };
let companyId: string;

beforeAll(async () => {
  pg = await createTestDb();
  db = pgliteDatabase(pg);
  owner = await createUser(pg, "dona@empresa.test");
  ana = await createUser(pg, "ana@empresa.test");
  carlos = await createUser(pg, "carlos@contabil.test");
  companyId = await asUser(pg, owner.id, async (tx) => (await tx.query<{ id: string }>("select public.create_workspace('Empresa X', 'business') as id")).rows[0].id);
  await asUser(pg, owner.id, (tx) =>
    tx.query(
      "insert into transactions (workspace_id, owner_id, visibility, kind, description, amount_cents, occurred_on) values ($1, $2, 'workspace', 'expense', 'Aluguel do escritório', 500000, current_date)",
      [companyId, owner.id],
    ),
  );
});

describe("convites (teste 6)", () => {
  let token: string;

  it("só quem pode gerenciar membros convida; workspace pessoal não aceita convite", async () => {
    await expect(db.asUser(owner.id, (q) => createInvitation(q, { workspaceId: owner.personalWorkspaceId, invitedBy: owner.id, email: "x@x.test", role: "member" }))).rejects.toThrow(/pessoal/);
    const inv = await db.asUser(owner.id, (q) => createInvitation(q, { workspaceId: companyId, invitedBy: owner.id, email: "Ana@Empresa.test", role: "finance" }));
    token = inv.token;
    expect(token.length).toBeGreaterThan(30);
    const stored = (await pg.query<{ token_hash: string }>("select token_hash from workspace_invitations where id = $1", [inv.id])).rows[0];
    expect(stored.token_hash).not.toBe(token); // só o hash é guardado
  });

  it("outro e-mail não aceita; o convidado aceita uma única vez", async () => {
    await expect(db.asUser(carlos.id, (q) => acceptInvitation(q, token))).rejects.toThrow(/outro e-mail/);
    expect(await db.asUser(ana.id, (q) => acceptInvitation(q, token))).toBe(companyId);
    await expect(db.asUser(ana.id, (q) => acceptInvitation(q, token))).rejects.toThrow(/já utilizado/);
    const [m] = (await pg.query<{ role: string }>("select role from workspace_members where workspace_id = $1 and user_id = $2", [companyId, ana.id])).rows;
    expect(m.role).toBe("finance");
  });

  it("convite expirado ou revogado não funciona", async () => {
    const inv = await db.asUser(owner.id, (q) => createInvitation(q, { workspaceId: companyId, invitedBy: owner.id, email: "carlos@contabil.test", role: "accountant" }));
    await pg.query("update workspace_invitations set expires_at = now() - interval '1 day' where id = $1", [inv.id]);
    await expect(db.asUser(carlos.id, (q) => acceptInvitation(q, inv.token))).rejects.toThrow(/expirou/);
    const inv2 = await db.asUser(owner.id, (q) => createInvitation(q, { workspaceId: companyId, invitedBy: owner.id, email: "carlos@contabil.test", role: "accountant" }));
    expect(await db.asUser(owner.id, (q) => revokeInvitation(q, companyId, inv2.id))).toBe(true);
    await expect(db.asUser(carlos.id, (q) => acceptInvitation(q, inv2.token))).rejects.toThrow(/inválido/);
    const inv3 = await db.asUser(owner.id, (q) => createInvitation(q, { workspaceId: companyId, invitedBy: owner.id, email: "carlos@contabil.test", role: "accountant" }));
    expect(await db.asUser(carlos.id, (q) => acceptInvitation(q, inv3.token))).toBe(companyId);
  });

  it("membro sem members.manage não convida nem vê convites", async () => {
    await expect(db.asUser(ana.id, (q) => createInvitation(q, { workspaceId: companyId, invitedBy: ana.id, email: "z@z.test", role: "viewer" }))).rejects.toThrow(/row-level security/);
    expect((await db.asUser(ana.id, (q) => q.query("select id from workspace_invitations"))).length).toBe(0);
  });
});

describe("papéis e permissões por módulo (teste 8)", () => {
  it("matriz efetiva por papel", async () => {
    const fin = await db.asUser(ana.id, (q) => myPermissions(q, companyId));
    expect(fin.finance).toEqual(["read", "write", "delete", "export"]);
    expect(fin.members).toEqual([]);
    const acc = await db.asUser(carlos.id, (q) => myPermissions(q, companyId));
    expect(acc.finance).toEqual(["read", "export"]);
    expect(acc.tasks).toEqual([]);
  });

  it("contador lê finanças compartilhadas mas não lança nem cria tarefas", async () => {
    const rows = await db.asUser(carlos.id, (q) => q.query<{ description: string }>("select description from transactions where workspace_id = $1", [companyId]));
    expect(rows.map((r) => r.description)).toEqual(["Aluguel do escritório"]);
    await expect(
      db.asUser(carlos.id, (q) =>
        q.query("insert into transactions (workspace_id, owner_id, kind, description, amount_cents, occurred_on) values ($1, $2, 'expense', 'x', 1, current_date)", [companyId, carlos.id]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.asUser(carlos.id, (q) => q.query("insert into tasks (workspace_id, owner_id, title) values ($1, $2, 'x')", [companyId, carlos.id])),
    ).rejects.toThrow(/row-level security/);
  });

  it("override individual: retirar 'finance.read' de um membro esconde as finanças compartilhadas", async () => {
    await pg.query(`update workspace_members set permissions = '{"finance": {"read": false}}' where workspace_id = $1 and user_id = $2`, [companyId, carlos.id]);
    const rows = await db.asUser(carlos.id, (q) => q.query("select id from transactions where workspace_id = $1", [companyId]));
    expect(rows).toHaveLength(0);
    await pg.query("update workspace_members set permissions = '{}' where workspace_id = $1 and user_id = $2", [companyId, carlos.id]);
  });

  it("financeiro não altera papéis; proprietário altera e é auditado", async () => {
    await expect(db.asUser(ana.id, (q) => updateMemberRole(q, companyId, carlos.id, "viewer"))).rejects.toThrow(/Sem permissão/);
    await db.asUser(owner.id, (q) => updateMemberRole(q, companyId, carlos.id, "viewer"));
    expect((await pg.query("select 1 from audit_logs where action = 'workspace.member.role_changed'")).rows).toHaveLength(1);
  });

  it("proprietário não pode ser rebaixado nem removido por ninguém", async () => {
    await expect(db.asUser(owner.id, (q) => updateMemberRole(q, companyId, owner.id, "viewer"))).rejects.toThrow(/Sem permissão/);
    await expect(db.asUser(owner.id, (q) => removeMember(q, companyId, owner.id))).rejects.toThrow(/Sem permissão/);
  });
});

describe("revogação de acesso (teste 9)", () => {
  it("membro removido perde acesso imediato aos dados do workspace", async () => {
    expect((await db.asUser(ana.id, (q) => q.query("select id from transactions where workspace_id = $1", [companyId]))).length).toBe(1);
    await db.asUser(owner.id, (q) => removeMember(q, companyId, ana.id));
    expect((await db.asUser(ana.id, (q) => q.query("select id from transactions where workspace_id = $1", [companyId]))).length).toBe(0);
    expect((await db.asUser(ana.id, (q) => q.query("select id from workspaces where id = $1", [companyId]))).length).toBe(0);
  });
});
