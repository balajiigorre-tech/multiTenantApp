import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool, withUser } from "../src/lib/db";
import * as svc from "../src/lib/services";
import { summarizeProject } from "../src/lib/summarize";
import { MockProvider } from "../src/lib/llm";
import { IDS, MISSING_ID, adminQuery, expectApiError, resetSeed } from "./helpers";

beforeEach(async () => { await resetSeed(); });
afterAll(async () => { await pool.end(); });

async function globexSnapshot() {
  const r = await adminQuery(
    `select (select count(*)::int from projects where workspace_id = $1) as projects,
            (select count(*)::int from notes where workspace_id = $1) as notes,
            (select title from notes where id = $2) as note_title,
            (select name from projects where id = $3) as project_name`,
    [IDS.globex, IDS.globexNote, IDS.globexRoadmap],
  );
  return r.rows[0];
}

describe("workspace A user (Bob, Acme) cannot touch workspace B (Globex) — service layer / URL & body ids", () => {
  it("sanity: Bob can read his own workspace", async () => {
    const projects = await withUser(IDS.bob, (db) => svc.listProjects(db, IDS.acme));
    expect(projects.map((p: { id: string }) => p.id)).toContain(IDS.acmeSite);
  });

  it("read: every read of Globex returns 404", async () => {
    await expectApiError(withUser(IDS.bob, (db) => svc.listProjects(db, IDS.globex)), 404);
    await expectApiError(withUser(IDS.bob, (db) => svc.getProject(db, IDS.globexRoadmap)), 404);
    await expectApiError(withUser(IDS.bob, (db) => svc.listNotes(db, IDS.globexRoadmap)), 404);
    await expectApiError(withUser(IDS.bob, (db) => svc.listMembers(db, IDS.globex)), 404);
  });

  it("write: create / update / delete against Globex all return 404 and change nothing", async () => {
    const before = await globexSnapshot();
    await expectApiError(withUser(IDS.bob, (db) => svc.createProject(db, { workspaceId: IDS.globex, name: "x", description: "" })), 404);
    await expectApiError(withUser(IDS.bob, (db) => svc.updateProject(db, IDS.globexRoadmap, { name: "pwned" })), 404);
    await expectApiError(withUser(IDS.bob, (db) => svc.deleteProject(db, IDS.globexRoadmap)), 404);
    await expectApiError(withUser(IDS.bob, (db) => svc.createNote(db, { projectId: IDS.globexRoadmap, title: "x", content: "y" })), 404);
    await expectApiError(withUser(IDS.bob, (db) => svc.updateNote(db, IDS.globexNote, { title: "pwned" })), 404);
    await expectApiError(withUser(IDS.bob, (db) => svc.deleteNote(db, IDS.globexNote)), 404);
    await expectApiError(withUser(IDS.bob, (db) => svc.inviteMember(db, IDS.globex, "bob@example.com", "owner")), 404);
    await expectApiError(summarizeProject(IDS.bob, IDS.globexRoadmap, new MockProvider()), 404);
    expect(await globexSnapshot()).toEqual(before);
  });

  it("does not reveal whether the other workspace exists: foreign ids look exactly like missing ids", async () => {
    const calls: [string, (id: string) => Promise<unknown>][] = [
      ["getProject", (id) => withUser(IDS.bob, (db) => svc.getProject(db, id))],
      ["listProjects", (id) => withUser(IDS.bob, (db) => svc.listProjects(db, id))],
      ["updateNote", (id) => withUser(IDS.bob, (db) => svc.updateNote(db, id, { title: "x" }))],
      ["createNote", (id) => withUser(IDS.bob, (db) => svc.createNote(db, { projectId: id, title: "x", content: "" }))],
      ["listMembers", (id) => withUser(IDS.bob, (db) => svc.listMembers(db, id))],
    ];
    const foreign: Record<string, string> = {
      getProject: IDS.globexRoadmap, listProjects: IDS.globex, updateNote: IDS.globexNote,
      createNote: IDS.globexRoadmap, listMembers: IDS.globex,
    };
    for (const [name, call] of calls) {
      const a = await expectApiError(call(foreign[name]), 404);
      const b = await expectApiError(call(MISSING_ID), 404);
      expect(a.message, name).toBe(b.message);
      const c = await expectApiError(call("not-a-uuid"), 404);
      expect(c.message, name).toBe(b.message);
    }
  });
});

describe("direct database calls as Bob (RLS is the last line of defence)", () => {
  it("SELECT / UPDATE / DELETE of Globex rows affect zero rows", async () => {
    const before = await globexSnapshot();
    await withUser(IDS.bob, async (db) => {
      expect((await db.query("select * from notes where workspace_id = $1", [IDS.globex])).rows).toHaveLength(0);
      expect((await db.query("select * from projects where id = $1", [IDS.globexRoadmap])).rows).toHaveLength(0);
      expect((await db.query("select * from workspaces where id = $1", [IDS.globex])).rows).toHaveLength(0);
      expect((await db.query("select * from memberships where workspace_id = $1", [IDS.globex])).rows).toHaveLength(0);
      expect((await db.query("update notes set title = 'pwned' where workspace_id = $1", [IDS.globex])).rowCount).toBe(0);
      expect((await db.query("update projects set name = 'pwned' where id = $1", [IDS.globexRoadmap])).rowCount).toBe(0);
      expect((await db.query("delete from notes where workspace_id = $1", [IDS.globex])).rowCount).toBe(0);
      expect((await db.query("delete from projects where id = $1", [IDS.globexRoadmap])).rowCount).toBe(0);
    });
    expect(await globexSnapshot()).toEqual(before);
  });

  it("INSERT into Globex is rejected by RLS (42501)", async () => {
    await expect(
      withUser(IDS.bob, (db) =>
        db.query(
          "insert into notes (workspace_id, project_id, title, content, created_by) values ($1,$2,'x','x',$3)",
          [IDS.globex, IDS.globexRoadmap, IDS.bob],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      withUser(IDS.bob, (db) =>
        db.query("insert into projects (workspace_id, name, created_by) values ($1,'x',$2)", [IDS.globex, IDS.bob]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot re-home a row into Globex, forge created_by, or cross-wire project/workspace", async () => {
    // workspace_id is not an updatable column for app_user
    await expect(
      withUser(IDS.bob, (db) => db.query("update notes set workspace_id = $1 where id = $2", [IDS.globex, IDS.acmeNote1])),
    ).rejects.toMatchObject({ code: "42501" });
    // forged author
    await expect(
      withUser(IDS.bob, (db) =>
        db.query("insert into notes (workspace_id, project_id, title, content, created_by) values ($1,$2,'x','x',$3)", [IDS.acme, IDS.acmeSite, IDS.carol]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    // Acme workspace + Globex project: composite FK refuses
    await expect(
      withUser(IDS.bob, (db) =>
        db.query("insert into notes (workspace_id, project_id, title, content, created_by) values ($1,$2,'x','x',$3)", [IDS.acme, IDS.globexRoadmap, IDS.bob]),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("cannot read password hashes or the sessions table", async () => {
    await expect(withUser(IDS.bob, (db) => db.query("select password_hash from users"))).rejects.toMatchObject({ code: "42501" });
    await expect(withUser(IDS.bob, (db) => db.query("select * from sessions"))).rejects.toMatchObject({ code: "42501" });
  });

  it("fails closed: no user context, empty, or malformed user id => zero rows, no error", async () => {
    const none = await pool.query("select count(*)::int as c from notes");
    expect(none.rows[0].c).toBe(0);
    for (const bad of ["", "not-a-uuid", "00000000-0000-0000-0000-000000000000", "' or 1=1 --"]) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query("select set_config('app.user_id', $1, true)", [bad]);
        const r = await c.query("select (select count(*)::int from notes) as n, (select count(*)::int from projects) as p, (select count(*)::int from workspaces) as w");
        expect(r.rows[0], `user_id=${JSON.stringify(bad)}`).toEqual({ n: 0, p: 0, w: 0 });
        await c.query("rollback");
      } finally {
        c.release();
      }
    }
  });

  it("a policy mistake still denies: a sloppy USING (true) policy cannot expose other workspaces", async () => {
    const admin = (await import("pg")).Client;
    const { config } = await import("../src/lib/config");
    const c = new admin({ connectionString: config.adminDatabaseUrl });
    await c.connect();
    try {
      await c.query("begin");
      // Simulate a developer adding an over-broad permissive policy...
      await c.query("create policy oops on notes for select to app_user using (true)");
      await c.query("create policy oops on projects for select to app_user using (true)");
      await c.query("set local role app_user");
      // ...with no identity at all:
      let r = await c.query("select count(*)::int as n from notes");
      expect(r.rows[0].n).toBe(0);
      // ...and as Bob: Acme rows only, Globex still invisible thanks to the RESTRICTIVE tenant_boundary policy.
      await c.query("select set_config('app.user_id', $1, true)", [IDS.bob]);
      r = await c.query("select count(*)::int as n from notes where workspace_id = $1", [IDS.globex]);
      expect(r.rows[0].n).toBe(0);
      r = await c.query("select count(*)::int as n from projects where workspace_id = $1", [IDS.globex]);
      expect(r.rows[0].n).toBe(0);
      r = await c.query("select count(*)::int as n from notes where workspace_id = $1", [IDS.acme]);
      expect(r.rows[0].n).toBeGreaterThan(0);
    } finally {
      await c.query("rollback").catch(() => undefined);
      await c.end();
    }
  });

  it("every table has row-level security enabled", async () => {
    const r = await adminQuery(
      `select relname, relrowsecurity from pg_class
        where relname in ('users','workspaces','memberships','projects','notes','project_summaries','sessions') and relkind = 'r'`,
    );
    expect(r.rows).toHaveLength(7);
    for (const row of r.rows) expect(row.relrowsecurity, row.relname).toBe(true);
  });
});

describe("symmetry: Carol (Globex) cannot touch Acme either", () => {
  it("is denied", async () => {
    await expectApiError(withUser(IDS.carol, (db) => svc.getProject(db, IDS.acmeSite)), 404);
    await expectApiError(withUser(IDS.carol, (db) => svc.deleteNote(db, IDS.acmeNote1)), 404);
    const r = await withUser(IDS.carol, (db) => db.query("select count(*)::int as c from notes where workspace_id = $1", [IDS.acme]));
    expect(r.rows[0].c).toBe(0);
  });
});

describe("roles", () => {
  it("viewer (Dave) can read but gets 403 on every write, and RLS agrees", async () => {
    const projects = await withUser(IDS.dave, (db) => svc.listProjects(db, IDS.acme));
    expect(projects.length).toBeGreaterThan(0);
    await expectApiError(withUser(IDS.dave, (db) => svc.createProject(db, { workspaceId: IDS.acme, name: "x", description: "" })), 403);
    await expectApiError(withUser(IDS.dave, (db) => svc.updateProject(db, IDS.acmeSite, { name: "x" })), 403);
    await expectApiError(withUser(IDS.dave, (db) => svc.createNote(db, { projectId: IDS.acmeSite, title: "x", content: "" })), 403);
    await expectApiError(withUser(IDS.dave, (db) => svc.updateNote(db, IDS.acmeNote1, { title: "x" })), 403);
    await expectApiError(withUser(IDS.dave, (db) => svc.deleteNote(db, IDS.acmeNote1)), 403);
    await expectApiError(summarizeProject(IDS.dave, IDS.acmeSite, new MockProvider()), 403);
    // even bypassing the service layer:
    await withUser(IDS.dave, async (db) => {
      expect((await db.query("update notes set title = 'x' where id = $1", [IDS.acmeNote1])).rowCount).toBe(0);
      expect((await db.query("delete from notes where id = $1", [IDS.acmeNote1])).rowCount).toBe(0);
    });
    await expect(
      withUser(IDS.dave, (db) => db.query("insert into projects (workspace_id, name, created_by) values ($1,'x',$2)", [IDS.acme, IDS.dave])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("editor (Bob) can create and edit but cannot invite", async () => {
    const p = await withUser(IDS.bob, (db) => svc.createProject(db, { workspaceId: IDS.acme, name: "New", description: "d" }));
    const n = await withUser(IDS.bob, (db) => svc.createNote(db, { projectId: p.id, title: "t", content: "c" }));
    const u = await withUser(IDS.bob, (db) => svc.updateNote(db, n.id, { content: "changed" }));
    expect(u.content).toBe("changed");
    await expectApiError(withUser(IDS.bob, (db) => svc.inviteMember(db, IDS.acme, "carol@example.com", "viewer")), 403);
    // direct SQL attempt to grant himself/anyone membership is denied (no INSERT privilege on memberships)
    await expect(
      withUser(IDS.bob, (db) => db.query("insert into memberships (workspace_id, user_id, role) values ($1,$2,'owner')", [IDS.acme, IDS.carol])),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("owner (Alice) can invite; the invited user then gains access, nobody else does", async () => {
    await expectApiError(withUser(IDS.carol, (db) => svc.getProject(db, IDS.acmeSite)), 404);
    const res = await withUser(IDS.alice, (db) => svc.inviteMember(db, IDS.acme, "Carol@Example.com", "viewer"));
    expect(res.result).toBe("invited");
    const p = await withUser(IDS.carol, (db) => svc.getProject(db, IDS.acmeSite));
    expect(p.role).toBe("viewer");
    await expectApiError(withUser(IDS.evan, (db) => svc.getProject(db, IDS.acmeSite)), 404);
    await expectApiError(withUser(IDS.alice, (db) => svc.inviteMember(db, IDS.acme, "nobody@example.com", "viewer")), 404);
  });
});
