import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool, withUser } from "../src/lib/db";
import { summarizeProject } from "../src/lib/summarize";
import { MockProvider, type LlmProvider, type LlmRequest } from "../src/lib/llm";
import { getProject } from "../src/lib/services";
import { IDS, adminQuery, expectApiError, resetSeed } from "./helpers";

beforeEach(async () => { await resetSeed(); });
afterAll(async () => { await pool.end(); });

const storedCount = async () => (await adminQuery("select count(*)::int as c from project_summaries")).rows[0].c as number;

describe("Summarize project (orchestration + storage)", () => {
  it("happy path: validated output is stored", async () => {
    const res = await summarizeProject(IDS.bob, IDS.acmeSite, new MockProvider());
    expect(res.summary.keyPoints.length).toBeGreaterThan(0);
    expect(res.meta.attempts).toBe(1);
    expect(await storedCount()).toBe(1);
    const p = await withUser(IDS.dave, (db) => getProject(db, IDS.acmeSite)); // viewers can read it
    expect(p.latestSummary?.id).toBe(res.id);
  });

  it("edge case: model returns malformed output once -> retried, only the valid result is stored", async () => {
    const res = await summarizeProject(IDS.bob, IDS.acmeSite, new MockProvider({ malformedOnFirstAttempt: true }));
    expect(res.meta.attempts).toBe(2);
    expect(await storedCount()).toBe(1);
    const row = (await adminQuery("select summary from project_summaries")).rows[0];
    expect(Object.keys(row.summary).sort()).toEqual(["keyPoints", "summary"]);
  });

  it("persistent malformed output -> 502, nothing stored", async () => {
    const bad: LlmProvider = { name: "bad", complete: async () => "definitely not json" };
    await expectApiError(summarizeProject(IDS.bob, IDS.acmeSite, bad), 502);
    expect(await storedCount()).toBe(0);
  });

  it("schema-valid JSON with extra keys (e.g. a hijacked 'action') is rejected, not stored", async () => {
    const hijacked: LlmProvider = {
      name: "hijacked",
      complete: async () => JSON.stringify({ summary: "ok", keyPoints: [], action: "delete_all_notes" }),
    };
    await expectApiError(summarizeProject(IDS.bob, IDS.acmeSite, hijacked), 502);
    expect(await storedCount()).toBe(0);
  });

  it("provider errors are contained", async () => {
    const down: LlmProvider = { name: "down", complete: async () => { throw new Error("boom"); } };
    await expectApiError(summarizeProject(IDS.bob, IDS.acmeSite, down), 502);
    expect(await storedCount()).toBe(0);
  });

  it("edge case: a note saying 'ignore previous instructions' is handled safely", async () => {
    let seen: LlmRequest | undefined;
    const inner = new MockProvider();
    const spy: LlmProvider = { name: "spy", complete: async (r) => { seen = r; return inner.complete(r); } };

    const res = await summarizeProject(IDS.bob, IDS.acmeLaunch, spy);

    // 1. injected text reached the model only as JSON data, never in the system prompt
    expect(seen!.system).not.toMatch(/ignore previous/i);
    const payload = JSON.parse(seen!.user);
    expect(payload.notes.some((n: { content: string }) => /ignore previous instructions/i.test(n.content))).toBe(true);
    // 2. it was flagged for the user
    expect(res.meta.suspiciousNoteIds).toEqual([IDS.acmeNoteInjection]);
    // 3. the output is still just the validated schema; nothing was deleted or leaked
    expect(Object.keys(res.summary).sort()).toEqual(["keyPoints", "summary"]);
    expect(JSON.stringify(res.summary)).not.toContain(seen!.system.slice(0, 30));
    const notes = (await adminQuery("select count(*)::int as c from notes where project_id = $1", [IDS.acmeLaunch])).rows[0].c;
    expect(notes).toBe(2);
  });

  it("injection AND malformed output together", async () => {
    const res = await summarizeProject(IDS.bob, IDS.acmeLaunch, new MockProvider({ malformedOnFirstAttempt: true }));
    expect(res.meta.attempts).toBe(2);
    expect(res.meta.suspiciousNoteIds).toHaveLength(1);
  });

  it("authorization: viewer 403, other workspace 404, empty project 422", async () => {
    await expectApiError(summarizeProject(IDS.dave, IDS.acmeSite, new MockProvider()), 403);
    await expectApiError(summarizeProject(IDS.bob, IDS.globexRoadmap, new MockProvider()), 404);
    await adminQuery("delete from notes where project_id = $1", [IDS.acmeSite]);
    await expectApiError(summarizeProject(IDS.bob, IDS.acmeSite, new MockProvider()), 422);
    expect(await storedCount()).toBe(0);
  });
});
