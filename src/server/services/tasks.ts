import { DomainError, type ServiceDeps } from "../context";

export interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  tags: string[];
  due_at: Date | null;
  completed_at: Date | null;
  project_id: string | null;
  project_name: string | null;
  assignee_id: string | null;
  visibility: "private" | "workspace";
  source: string;
  checklist: { text: string; done: boolean }[];
}

export interface TaskInput {
  title: string;
  notes?: string;
  priority?: TaskRow["priority"];
  dueAt?: Date | null;
  tags?: string[];
  projectId?: string;
  visibility?: "private" | "workspace";
  source?: "manual" | "ai" | "whatsapp" | "automation";
  idempotencyKey?: string;
}

const SELECT = `select t.id, t.title, t.notes, t.priority, t.tags, t.due_at, t.completed_at, t.project_id, p.name as project_name,
  t.assignee_id, t.visibility, t.source, t.checklist
  from tasks t left join projects p on p.id = t.project_id`;

export async function createTask(deps: ServiceDeps, input: TaskInput): Promise<{ task: TaskRow; created: boolean }> {
  const title = input.title.trim();
  if (!title) throw new DomainError("invalid", "Título obrigatório.");
  const rows = await deps.q.query<{ id: string }>(
    `insert into tasks (workspace_id, owner_id, visibility, title, notes, priority, due_at, tags, project_id, source, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (workspace_id, idempotency_key) do nothing returning id`,
    [deps.ctx.workspaceId, deps.ctx.userId, input.visibility ?? "private", title, input.notes ?? null, input.priority ?? "medium",
      input.dueAt ?? null, input.tags ?? [], input.projectId ?? null, input.source ?? "manual", input.idempotencyKey ?? null],
  );
  const created = rows.length > 0;
  const id = created
    ? rows[0].id
    : (await deps.q.query<{ id: string }>("select id from tasks where workspace_id = $1 and idempotency_key = $2", [deps.ctx.workspaceId, input.idempotencyKey]))[0]?.id;
  const [task] = await deps.q.query<TaskRow>(`${SELECT} where t.id = $1`, [id]);
  return { task, created };
}

export async function listTasks(
  { q, ctx }: ServiceDeps,
  f: { status?: "open" | "done" | "all"; projectId?: string; search?: string; limit?: number } = {},
): Promise<TaskRow[]> {
  return q.query<TaskRow>(
    `${SELECT}
     where t.workspace_id = $1
       and ($2 = 'all' or ($2 = 'open' and t.completed_at is null) or ($2 = 'done' and t.completed_at is not null))
       and ($3::uuid is null or t.project_id = $3)
       and ($4::text is null or t.title ilike '%' || $4 || '%')
     order by t.completed_at nulls first, t.due_at nulls last,
       case t.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end
     limit $5`,
    [ctx.workspaceId, f.status ?? "open", f.projectId ?? null, f.search ?? null, Math.min(f.limit ?? 200, 500)],
  );
}

export async function findTasksByTitle(deps: ServiceDeps, title: string): Promise<TaskRow[]> {
  return listTasks(deps, { status: "open", search: title, limit: 5 });
}

export async function completeTask({ q, ctx }: ServiceDeps, id: string): Promise<TaskRow> {
  const rows = await q.query<{ id: string }>(
    "update tasks set completed_at = now() where id = $1 and workspace_id = $2 and completed_at is null returning id",
    [id, ctx.workspaceId],
  );
  if (!rows.length) throw new DomainError("not_found", "Tarefa não encontrada ou já concluída.");
  const [task] = await q.query<TaskRow>(`${SELECT} where t.id = $1`, [id]);
  return task;
}

export async function reopenTask({ q, ctx }: ServiceDeps, id: string): Promise<void> {
  await q.query("update tasks set completed_at = null where id = $1 and workspace_id = $2", [id, ctx.workspaceId]);
}

export async function deleteTask({ q, ctx }: ServiceDeps, id: string): Promise<boolean> {
  const rows = await q.query("delete from tasks where id = $1 and workspace_id = $2 returning id", [id, ctx.workspaceId]);
  return rows.length > 0;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  due_on: string | null;
  open_tasks: number;
  done_tasks: number;
}

export async function listProjects({ q, ctx }: ServiceDeps): Promise<ProjectRow[]> {
  return q.query<ProjectRow>(
    `select p.id, p.name, p.description, p.status, p.due_on,
       count(t.id) filter (where t.completed_at is null)::bigint as open_tasks,
       count(t.id) filter (where t.completed_at is not null)::bigint as done_tasks
     from projects p left join tasks t on t.project_id = p.id
     where p.workspace_id = $1 and p.status <> 'archived'
     group by p.id order by p.created_at desc`,
    [ctx.workspaceId],
  );
}

export async function createProject(deps: ServiceDeps, input: { name: string; description?: string; dueOn?: string; visibility?: "private" | "workspace" }) {
  const name = input.name.trim();
  if (!name) throw new DomainError("invalid", "Nome obrigatório.");
  const [row] = await deps.q.query<{ id: string }>(
    "insert into projects (workspace_id, owner_id, visibility, name, description, due_on) values ($1, $2, $3, $4, $5, $6) returning id",
    [deps.ctx.workspaceId, deps.ctx.userId, input.visibility ?? "workspace", name, input.description ?? null, input.dueOn ?? null],
  );
  return row.id;
}
