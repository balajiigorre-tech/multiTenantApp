import { withUser } from "./db";
import { ApiError } from "./errors";
import { getProvider, type LlmProvider } from "./llm";
import { loadProject, requireRole } from "./services";
import { SYSTEM_PROMPT, MAX_NOTES, buildUserMessage, detectInjection, parseModelOutput, type Summary } from "./summary";

const MAX_ATTEMPTS = 2;
const PROVIDER_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("provider timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export type StoredSummary = {
  id: string;
  summary: Summary;
  meta: { attempts: number; suspiciousNoteIds: string[] };
  model: string;
  created_at: string;
};

/**
 * 1) read notes under RLS (short transaction)  2) call the model OUTSIDE any DB transaction
 * 3) validate against the schema, retrying once  4) store only validated output.
 * Invalid output is never stored and never shown.
 */
export async function summarizeProject(
  userId: string,
  projectId: string,
  provider: LlmProvider = getProvider(),
): Promise<StoredSummary> {
  const { project, notes } = await withUser(userId, async (db) => {
    const project = await loadProject(db, projectId);
    await requireRole(db, project.workspace_id, "editor");
    const r = await db.query(
      "select id, title, content from notes where project_id = $1 order by created_at limit $2",
      [project.id, MAX_NOTES],
    );
    return { project, notes: r.rows as { id: string; title: string; content: string }[] };
  });
  if (notes.length === 0) throw new ApiError(422, "This project has no notes to summarize");

  const suspiciousNoteIds = notes.filter((n) => detectInjection(n.title) || detectInjection(n.content)).map((n) => n.id);
  const user = buildUserMessage(notes);

  let value: Summary | undefined;
  let attempts = 0;
  while (!value && attempts < MAX_ATTEMPTS) {
    attempts++;
    try {
      const raw = await withTimeout(provider.complete({ system: SYSTEM_PROMPT, user, attempt: attempts - 1 }), PROVIDER_TIMEOUT_MS);
      const parsed = parseModelOutput(raw);
      if (parsed.ok) value = parsed.value;
      else console.warn(`[summarize] attempt ${attempts} rejected: ${parsed.reason}`); // never log note text
    } catch (e) {
      console.warn(`[summarize] attempt ${attempts} provider error: ${(e as Error).message}`);
    }
  }
  if (!value) throw new ApiError(502, "The summary could not be generated. Nothing was saved. Please try again.");

  return withUser(userId, async (db) => {
    // Re-check: the caller's role may have changed while the model was running.
    await requireRole(db, project.workspace_id, "editor");
    const meta = { attempts, suspiciousNoteIds };
    const r = await db.query(
      `insert into project_summaries (workspace_id, project_id, summary, meta, model, created_by)
       values ($1, $2, $3::jsonb, $4::jsonb, $5, app.current_user_id())
       returning id, summary, meta, model, created_at`,
      [project.workspace_id, project.id, JSON.stringify(value), JSON.stringify(meta), provider.name],
    );
    return r.rows[0] as StoredSummary;
  });
}
