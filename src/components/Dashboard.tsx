"use client";
import { useEffect, useState, type FormEvent } from "react";

type Role = "owner" | "editor" | "viewer";
type Workspace = { id: string; name: string; role: Role };
type Project = { id: string; workspace_id: string; name: string; description: string };
type Note = { id: string; title: string; content: string };
type Summary = {
  id: string;
  summary: { summary: string; keyPoints: string[] };
  meta: { attempts: number; suspiciousNoteIds: string[] };
  model: string;
  created_at: string;
};
type Member = { id: string; email: string; name: string; role: Role };

async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) window.location.href = "/login";
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ data: s.data, loading: true }));
    fn().then(
      (data) => alive && setState({ data, loading: false }),
      (e: Error) => alive && setState({ loading: false, error: e.message }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await fn(); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }
  return { busy, error, run };
}

const canWrite = (r?: Role) => r === "owner" || r === "editor";

export default function Dashboard({ user }: { user: { name: string; email: string } }) {
  const me = useLoad(() => api<{ workspaces: Workspace[] }>("/api/me"), []);
  const [sel, setSel] = useState<{ w?: string; p?: string }>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setSel({ w: q.get("w") ?? undefined, p: q.get("p") ?? undefined });
    setReady(true);
  }, []);

  function select(next: { w?: string; p?: string }) {
    setSel(next);
    const q = new URLSearchParams();
    if (next.w) q.set("w", next.w);
    if (next.p) q.set("p", next.p);
    window.history.replaceState(null, "", q.toString() ? `?${q}` : "/");
  }

  const workspaces = me.data?.workspaces ?? [];
  const wsId = sel.w ?? workspaces[0]?.id;
  const role = workspaces.find((w) => w.id === wsId)?.role;

  return (
    <>
      <header className="top">
        <strong>Workspace Notes</strong>
        <label>
          Workspace{" "}
          <select value={wsId ?? ""} onChange={(e) => select({ w: e.target.value })} disabled={!workspaces.length}>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name} ({w.role})</option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <span className="muted">{user.name}</span>
        <button onClick={async () => { await api("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}>
          Sign out
        </button>
      </header>
      {me.error && <div className="error">{me.error}</div>}
      {me.loading && !me.data && <p className="muted" style={{ padding: 20 }}>Loading…</p>}
      {ready && wsId && (
        <main className="layout">
          <div>
            <ProjectsPanel key={wsId} wsId={wsId} role={role} selected={sel.p} onSelect={(p) => select({ w: wsId, p })} />
            <MembersPanel key={`m-${wsId}`} wsId={wsId} role={role} />
          </div>
          <div>
            {sel.p ? (
              <ProjectDetail key={sel.p} id={sel.p} onGone={() => select({ w: wsId })} />
            ) : (
              <p className="muted">Select or create a project.</p>
            )}
          </div>
        </main>
      )}
    </>
  );
}

function ProjectsPanel(props: { wsId: string; role?: Role; selected?: string; onSelect: (id?: string) => void }) {
  const list = useLoad(() => api<Project[]>(`/api/projects?workspaceId=${encodeURIComponent(props.wsId)}`), [props.wsId]);
  const [name, setName] = useState("");
  const act = useAction();

  async function create(e: FormEvent) {
    e.preventDefault();
    const ok = await act.run(async () => {
      const p = await api<Project>("/api/projects", { method: "POST", body: { workspaceId: props.wsId, name } });
      setName("");
      props.onSelect(p.id);
    });
    if (ok) list.reload();
  }

  return (
    <section className="card">
      <h2>Projects</h2>
      {list.loading && <p className="muted">Loading projects…</p>}
      {list.error && <div className="error" role="alert">{list.error}</div>}
      <ul className="list">
        {list.data?.map((p) => (
          <li key={p.id} className={p.id === props.selected ? "active" : ""} onClick={() => props.onSelect(p.id)}>{p.name}</li>
        ))}
      </ul>
      {list.data?.length === 0 && <p className="muted">No projects yet.</p>}
      {canWrite(props.role) && (
        <form onSubmit={create} style={{ marginTop: 8 }}>
          <input placeholder="New project name" value={name} onChange={(e) => setName(e.target.value)} required />
          <button className="primary" disabled={act.busy}>{act.busy ? "Creating…" : "Create project"}</button>
          {act.error && <div className="error" role="alert">{act.error}</div>}
        </form>
      )}
    </section>
  );
}

function MembersPanel({ wsId, role }: { wsId: string; role?: Role }) {
  const members = useLoad(() => api<Member[]>(`/api/workspaces/${encodeURIComponent(wsId)}/members`), [wsId]);
  const [email, setEmail] = useState("");
  const [r, setR] = useState<Role>("viewer");
  const act = useAction();
  const [info, setInfo] = useState<string | null>(null);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setInfo(null);
    const ok = await act.run(async () => {
      const res = await api<{ result: string }>(`/api/workspaces/${encodeURIComponent(wsId)}/members`, { method: "POST", body: { email, role: r } });
      setInfo(res.result === "invited" ? "Member added." : "Already a member.");
      setEmail("");
    });
    if (ok) members.reload();
  }

  return (
    <section className="card">
      <h2>Members</h2>
      {members.loading && <p className="muted">Loading…</p>}
      {members.error && <div className="error" role="alert">{members.error}</div>}
      <ul className="list">
        {members.data?.map((m) => (
          <li key={m.id} style={{ cursor: "default" }}>{m.name}<span className="badge">{m.role}</span></li>
        ))}
      </ul>
      {role === "owner" && (
        <form onSubmit={invite} style={{ marginTop: 8 }}>
          <input type="email" placeholder="Invite by email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <select value={r} onChange={(e) => setR(e.target.value as Role)}>
            <option value="viewer">viewer</option><option value="editor">editor</option><option value="owner">owner</option>
          </select>{" "}
          <button className="primary" disabled={act.busy}>Invite</button>
          {act.error && <div className="error" role="alert">{act.error}</div>}
          {info && <div className="muted">{info}</div>}
        </form>
      )}
    </section>
  );
}

function ProjectDetail({ id, onGone }: { id: string; onGone: () => void }) {
  const detail = useLoad(() => api<{ project: Project; role: Role; latestSummary: Summary | null }>(`/api/projects/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const act = useAction();
  const sumAct = useAction();
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => { if (detail.data) setSummary(detail.data.latestSummary); }, [detail.data]);

  if (detail.loading && !detail.data) return <p className="muted">Loading project…</p>;
  if (detail.error || !detail.data) return <div className="error" role="alert">{detail.error ?? "Not found"}</div>;
  const { project, role } = detail.data;
  const writable = canWrite(role);

  async function save(e: FormEvent) {
    e.preventDefault();
    const ok = await act.run(() => api(`/api/projects/${id}`, { method: "PATCH", body: { name, description } }));
    if (ok) { setEditing(false); detail.reload(); }
  }

  return (
    <>
      <section className="card">
        {editing ? (
          <form onSubmit={save}>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            <button className="primary" disabled={act.busy}>{act.busy ? "Saving…" : "Save"}</button>
            <button type="button" onClick={() => setEditing(false)}>Cancel</button>
            {act.error && <div className="error" role="alert">{act.error}</div>}
          </form>
        ) : (
          <>
            <h2>{project.name} <span className="badge">{role}</span></h2>
            <p className="muted">{project.description || "No description"}</p>
            {writable && (
              <>
                <button onClick={() => { setName(project.name); setDescription(project.description); setEditing(true); }}>Edit</button>
                <button onClick={async () => { if (confirm("Delete this project and its notes?") && (await act.run(() => api(`/api/projects/${id}`, { method: "DELETE" })))) onGone(); }}>Delete</button>
              </>
            )}
            {act.error && <div className="error" role="alert">{act.error}</div>}
          </>
        )}
      </section>

      <NotesPanel projectId={id} writable={writable} suspicious={summary?.meta.suspiciousNoteIds ?? []} />

      <section className="card">
        <h2>Summary</h2>
        {writable && (
          <button
            className="primary"
            disabled={sumAct.busy}
            onClick={() => sumAct.run(async () => setSummary(await api<Summary>(`/api/projects/${id}/summarize`, { method: "POST" })))}
          >
            {sumAct.busy ? "Summarizing…" : "Summarize project"}
          </button>
        )}
        {sumAct.error && <div className="error" role="alert">{sumAct.error}</div>}
        {summary ? (
          <div>
            {/* Rendered as plain text by React: model output can never inject markup. */}
            <p>{summary.summary.summary}</p>
            <ul>{summary.summary.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
            <p className="muted">
              {summary.model} · {new Date(summary.created_at).toLocaleString()} · attempts: {summary.meta.attempts}
              {summary.meta.suspiciousNoteIds.length > 0 && (
                <span className="badge warn">{summary.meta.suspiciousNoteIds.length} note(s) contained instruction-like text; treated as data</span>
              )}
            </p>
          </div>
        ) : (
          <p className="muted">No summary yet.</p>
        )}
      </section>
    </>
  );
}

function NotesPanel({ projectId, writable, suspicious }: { projectId: string; writable: boolean; suspicious: string[] }) {
  const notes = useLoad(() => api<Note[]>(`/api/projects/${projectId}/notes`), [projectId]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eContent, setEContent] = useState("");
  const act = useAction();

  async function create(e: FormEvent) {
    e.preventDefault();
    const ok = await act.run(() => api("/api/notes", { method: "POST", body: { projectId, title, content } }));
    if (ok) { setTitle(""); setContent(""); notes.reload(); }
  }
  async function save(id: string) {
    const ok = await act.run(() => api(`/api/notes/${id}`, { method: "PATCH", body: { title: eTitle, content: eContent } }));
    if (ok) { setEditId(null); notes.reload(); }
  }

  return (
    <section className="card">
      <h2>Notes</h2>
      {notes.loading && <p className="muted">Loading notes…</p>}
      {notes.error && <div className="error" role="alert">{notes.error}</div>}
      {notes.data?.length === 0 && <p className="muted">No notes yet.</p>}
      {notes.data?.map((n) => (
        <div className="note" key={n.id}>
          {editId === n.id ? (
            <>
              <input value={eTitle} onChange={(e) => setETitle(e.target.value)} />
              <textarea rows={3} value={eContent} onChange={(e) => setEContent(e.target.value)} />
              <button className="primary" disabled={act.busy} onClick={() => save(n.id)}>Save</button>
              <button onClick={() => setEditId(null)}>Cancel</button>
            </>
          ) : (
            <>
              <strong>{n.title}</strong>
              {suspicious.includes(n.id) && <span className="badge warn">instruction-like text</span>}
              <pre>{n.content}</pre>
              {writable && (
                <>
                  <button onClick={() => { setEditId(n.id); setETitle(n.title); setEContent(n.content); }}>Edit</button>
                  <button onClick={async () => { if (await act.run(() => api(`/api/notes/${n.id}`, { method: "DELETE" }))) notes.reload(); }}>Delete</button>
                </>
              )}
            </>
          )}
        </div>
      ))}
      {act.error && <div className="error" role="alert">{act.error}</div>}
      {writable && (
        <form onSubmit={create} style={{ marginTop: 10 }}>
          <input placeholder="Note title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <textarea placeholder="Note content" rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
          <button className="primary" disabled={act.busy}>{act.busy ? "Saving…" : "Add note"}</button>
        </form>
      )}
    </section>
  );
}
