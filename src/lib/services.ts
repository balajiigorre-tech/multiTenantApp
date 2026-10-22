import type { Db } from "./db";
import { ApiError, assertUuid, forbidden, notFound } from "./errors";

export type Role = "owner" | "editor" | "viewer";
const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

/**
 * Application-level authorization (layer 1). RLS (layer 2) enforces the same rules in the
 * database, so a bug here cannot leak data and a bug in a policy cannot be exploited via
 * a forgotten check.
 *
 * Non-member => 404 (same as "does not exist"); member with too little power => 403.
 */
export async function roleIn(db: Db, workspaceId: string): Promise<Role | null> {
  assertUuid(workspaceId);
  const r = await db.query("select app.role_in($1) as role", [workspaceId]);
  return (r.rows[0].role as Role | null) ?? null;
}

export async function requireRole(db: Db, workspaceId: string, min: Role): Promise<Role> {
  const role = await roleIn(db, workspaceId);
  if (!role) throw notFound();
  if (RANK[role] < RANK[min]) throw forbidden();
  return role;
}

// ---------------------------------------------------------------- workspaces / members
export async function listWorkspaces(db: Db) {
  const r = await db.query(
    `select w.id, w.name, m.role
       from workspaces w
       join memberships m on m.workspace_id = w.id and m.user_id = app.current_user_id()
      order by w.name`,
  );
  return r.rows as { id: string; name: string; role: Role }[];
}

export async function listMembers(db: Db, workspaceId: string) {
  await requireRole(db, workspaceId, "viewer");
  const r = await db.query(
    `select u.id, u.email, u.name, m.role
       from memberships m join users u on u.id = m.user_id
      where m.workspace_id = $1 order by u.name`,
    [workspaceId],
  );
  return r.rows;
}

export async function inviteMember(db: Db, workspaceId: string, email: string, role: Role) {
  await requireRole(db, workspaceId, "owner");
  const r = await db.query("select app.invite_member($1, $2, $3) as result", [workspaceId, email, role]);
  const result = r.rows[0].result as "invited" | "exists" | "no_user";
  if (result === "no_user") throw new ApiError(404, "No registered user with that email");
  return { result };
}

// ---------------------------------------------------------------- projects
const PROJECT_COLS = "id, workspace_id, name, description, created_at, updated_at";

export async function loadProject(db: Db, id: string) {
  assertUuid(id);
  const r = await db.query(`select ${PROJECT_COLS} from projects where id = $1`, [id]);
  if (!r.rows[0]) throw notFound(); // RLS hides other workspaces' rows, so this is also "not yours"
  return r.rows[0] as {
    id: string; workspace_id: string; name: string; description: string; created_at: string; updated_at: string;
  };
}

export async function listProjects(db: Db, workspaceId: string) {
  await requireRole(db, workspaceId, "viewer");
  const r = await db.query(
    `select ${PROJECT_COLS} from projects where workspace_id = $1 order by created_at desc`,
    [workspaceId],
  );
  return r.rows;
}

export async function createProject(db: Db, input: { workspaceId: string; name: string; description: string }) {
  await requireRole(db, input.workspaceId, "editor");
  const r = await db.query(
    `insert into projects (workspace_id, name, description, created_by)
     values ($1, $2, $3, app.current_user_id()) returning ${PROJECT_COLS}`,
    [input.workspaceId, input.name, input.description],
  );
  return r.rows[0];
}

export async function getProject(db: Db, id: string) {
  const project = await loadProject(db, id);
  const role = await requireRole(db, project.workspace_id, "viewer");
  const s = await db.query(
    `select id, summary, meta, model, created_at from project_summaries
      where project_id = $1 order by created_at desc limit 1`,
    [id],
  );
  return { project, role, latestSummary: s.rows[0] ?? null };
}

export async function updateProject(db: Db, id: string, patch: { name?: string; description?: string }) {
  const project = await loadProject(db, id);
  await requireRole(db, project.workspace_id, "editor");
  const r = await db.query(
    `update projects set name = coalesce($2, name), description = coalesce($3, description), updated_at = now()
      where id = $1 returning ${PROJECT_COLS}`,
    [id, patch.name ?? null, patch.description ?? null],
  );
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}

export async function deleteProject(db: Db, id: string) {
  const project = await loadProject(db, id);
  await requireRole(db, project.workspace_id, "editor");
  const r = await db.query("delete from projects where id = $1", [id]);
  if (r.rowCount === 0) throw notFound();
}

// ---------------------------------------------------------------- notes
const NOTE_COLS = "id, workspace_id, project_id, title, content, created_at, updated_at";

async function loadNote(db: Db, id: string) {
  assertUuid(id);
  const r = await db.query(`select ${NOTE_COLS} from notes where id = $1`, [id]);
  if (!r.rows[0]) throw notFound();
  return r.rows[0] as { id: string; workspace_id: string; project_id: string };
}

export async function listNotes(db: Db, projectId: string) {
  const project = await loadProject(db, projectId);
  await requireRole(db, project.workspace_id, "viewer");
  const r = await db.query(`select ${NOTE_COLS} from notes where project_id = $1 order by created_at`, [projectId]);
  return r.rows;
}

export async function createNote(db: Db, input: { projectId: string; title: string; content: string }) {
  // workspace_id is DERIVED from the project row the caller is allowed to see — never taken from the client.
  const project = await loadProject(db, input.projectId);
  await requireRole(db, project.workspace_id, "editor");
  const r = await db.query(
    `insert into notes (workspace_id, project_id, title, content, created_by)
     values ($1, $2, $3, $4, app.current_user_id()) returning ${NOTE_COLS}`,
    [project.workspace_id, project.id, input.title, input.content],
  );
  return r.rows[0];
}

export async function updateNote(db: Db, id: string, patch: { title?: string; content?: string }) {
  const note = await loadNote(db, id);
  await requireRole(db, note.workspace_id, "editor");
  const r = await db.query(
    `update notes set title = coalesce($2, title), content = coalesce($3, content), updated_at = now()
      where id = $1 returning ${NOTE_COLS}`,
    [id, patch.title ?? null, patch.content ?? null],
  );
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}

export async function deleteNote(db: Db, id: string) {
  const note = await loadNote(db, id);
  await requireRole(db, note.workspace_id, "editor");
  const r = await db.query("delete from notes where id = $1", [id]);
  if (r.rowCount === 0) throw notFound();
}
