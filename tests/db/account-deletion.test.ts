import { describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser } from "./harness";

describe("exclusão de conta (LGPD)", () => {
  it("remove dados do titular e preserva workspace compartilhado de outro owner", async () => {
    const db = await createTestDb();
    const owner = await createUser(db, "owner@del.test");
    const leaver = await createUser(db, "leaver@del.test");
    const familyId = await asUser(db, owner.id, async (tx) => {
      const { rows } = await tx.query<{ id: string }>("select public.create_workspace('Casa', 'family') as id");
      await tx.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')", [rows[0].id, leaver.id]);
      return rows[0].id;
    });
    await asUser(db, leaver.id, async (tx) => {
      await tx.query("insert into tasks (workspace_id, owner_id, title, visibility) values ($1, $2, 'Tarefa do leaver', 'workspace')", [familyId, leaver.id]);
      await tx.query("insert into transactions (workspace_id, owner_id, kind, description, amount_cents, occurred_on) values ($1, $2, 'expense', 'X', 100, current_date)", [leaver.personalWorkspaceId, leaver.id]);
      const c = await tx.query<{ id: string }>("insert into conversations (workspace_id, owner_id) values ($1, $2) returning id", [familyId, leaver.id]);
      await tx.query("insert into messages (conversation_id, workspace_id, owner_id, role, content) values ($1, $2, $3, 'user', 'oi')", [c.rows[0].id, familyId, leaver.id]);
    });
    // Mesmo fluxo da action: apaga workspaces onde é único owner e depois o usuário do Auth.
    await db.query(
      `delete from workspaces w where w.created_by = $1 and not exists (
         select 1 from workspace_members m where m.workspace_id = w.id and m.role = 'owner' and m.user_id <> $1)`,
      [leaver.id],
    );
    await db.query("delete from auth.users where id = $1", [leaver.id]);

    const left = await db.query<{ n: number }>(
      `select (select count(*) from tasks where owner_id = $1) + (select count(*) from transactions where owner_id = $1)
            + (select count(*) from messages where owner_id = $1) + (select count(*) from profiles where id = $1) as n`,
      [leaver.id],
    );
    expect(Number(left.rows[0].n)).toBe(0);
    const family = await db.query("select id from workspaces where id = $1", [familyId]);
    expect(family.rows).toHaveLength(1);
  });
});
