# workspace-notes-app

A small multi-tenant app: **workspaces → projects → notes**, with tenant isolation enforced **in the database**
(PostgreSQL row-level security), server-verified authentication, role-based permissions, and an LLM
"Summarize project" action behind a provider interface (mock included, no API keys).

**Screen recording (5–8 min):** _Pending; add a publicly accessible link before submission._

Stack: TypeScript · Next.js 15 (App Router) · Node.js · PostgreSQL 16 · Zod · Vitest.

## Run it

Requirements: Node 20+, Docker (or any Postgres 14+ you can create roles in).

```bash
npm install
npm run db:up        # Postgres in Docker on localhost:54329
npm run db:reset     # drop + migrate + seed (idempotent; use db:migrate / db:seed individually if you prefer)
npm run dev          # http://localhost:3000
```

Demo users (all `@example.com`, password `password123`):

| user  | Acme Corp | Globex Inc |
|-------|-----------|------------|
| alice | owner     | viewer     |
| bob   | editor    | –          |
| dave  | viewer    | –          |
| carol | –         | owner      |
| evan  | –         | editor     |

Using your own Postgres / Supabase: copy `.env.example` to `.env`, set `ADMIN_DATABASE_URL` (a role that can create roles/tables,
used only by migrations/seed) and `DATABASE_URL` (the restricted `app_user` the app runs as). `MOCK_LLM_MALFORMED_ONCE=1`
(default) makes the mock return broken JSON on the first attempt of every summarize call.

## Run the tests

```bash
npm run db:up        # tests need Postgres; they migrate + seed automatically
npm test             # everything (DB-backed isolation/role/auth/summarize tests + pure unit tests)
npm run test:unit    # only the pure summary-validation tests (no database needed)
npm run typecheck
```

What the tests prove:

- `tests/isolation.test.ts` – a user in workspace A cannot **read, change or delete** anything in B, through the service layer
  (ids in URL/body) **and** through raw SQL; foreign ids are indistinguishable from non-existent ids; no-identity / malformed-identity
  sessions see zero rows; a deliberately sloppy `USING (true)` policy still cannot leak; role matrix (viewer/editor/owner).
- `tests/auth.test.ts` – login, session expiry/logout, only token hashes stored.
- `tests/summary.test.ts` – schema validation (malformed, truncated, fenced, extra keys, wrong types, size limits) and prompt-injection handling.
- `tests/summarize.test.ts` – retry-once on malformed output, nothing invalid is ever stored, injected note text is data-only and flagged.

## Demonstrating the edge cases (for the recording)

Log in as **bob** (Acme only). Globex ids: workspace `a0000000-0000-4000-8000-000000000002`, project `c0000000-0000-4000-8000-000000000003`, note `d0000000-0000-4000-8000-000000000005`.

1. **Changing ids – all three fail identically, revealing nothing**
   - *URL:* open `http://localhost:3000/?w=a0000000-0000-4000-8000-000000000002&p=c0000000-0000-4000-8000-000000000003` → "Not found" panels. Compare with a made-up id: same message.
   - *Request body / URL of API:* 
     ```bash
     curl -s -c jar -H 'content-type: application/json' -d '{"email":"bob@example.com","password":"password123"}' localhost:3000/api/auth/login
     curl -s -b jar localhost:3000/api/projects/c0000000-0000-4000-8000-000000000003          # 404 {"error":"Not found"}
     curl -s -b jar localhost:3000/api/projects/c0000000-0000-4000-8000-0000000000ff          # identical 404
     curl -s -b jar -H 'content-type: application/json' -d '{"projectId":"c0000000-0000-4000-8000-000000000003","title":"x"}' localhost:3000/api/notes   # 404
     curl -s -b jar -H 'content-type: application/json' -d '{"workspaceId":"a0000000-0000-4000-8000-000000000002","name":"x"}' localhost:3000/api/projects # 404
     ```
   - *Direct database call:* `npm run demo:db-attack` (runs SQL as Bob against Globex: 0 rows, 0 affected, `42501` on inserts/moves/sensitive tables).
2. **Malformed model output + prompt injection** – log in as bob → *Acme Corp → Launch Checklist* contains the note *"Vendor email"* with
   "ignore previous instructions…". Click **Summarize project**: the first mock attempt is malformed, the second validates (UI shows `attempts: 2`), the note is
   flagged "instruction-like text", nothing is deleted or leaked, and the summary is rendered as plain text.

## Architecture & design decisions

**Tenancy / isolation (defence in depth)**
1. **Database (the real guarantee).** The app connects as `app_user`: not a superuser, no `BYPASSRLS`, not the table owner. Each request runs in one
   transaction that executes `set_config('app.user_id', <server-verified id>, true)` (transaction-local, so pooled connections cannot carry identity between requests).
   Policies derive membership/role from that setting.
2. **Fail closed.** RLS is enabled on every table (no policy ⇒ no access). `app.current_user_id()` returns `NULL` for unset/garbage values and `NULL` comparisons deny.
   **Restrictive** policies (`tenant_boundary`, `require_user`) are AND-ed with every permissive policy, so a future over-broad permissive policy still can't cross a workspace boundary (there's a test for it).
3. **Least privilege.** Column-level grants: `password_hash` unreadable, `workspace_id`/`project_id`/`created_by` not updatable; `memberships` writable only via the `invite_member()` function; `sessions` reachable only through `SECURITY DEFINER` functions.
4. **Schema integrity.** `notes`/`summaries` reference `(project_id, workspace_id)` with a composite FK, so a child can never sit in a different workspace than its parent.
5. **Application layer.** Services re-check the role (`404` for non-members, `403` for members with too little power) – clearer errors, and a second independent control. `workspace_id` on writes is **derived from the parent row** the caller can see, never trusted from the client.

**No information leaks.** "Doesn't exist", "malformed id" and "exists in a workspace you can't see" all return the same `404 {"error":"Not found"}`; RLS errors (`42501`) are mapped to that too.

**Authentication.** Email + password (bcrypt), random 256-bit session token in an `HttpOnly; SameSite=Lax` cookie; only its SHA-256 is stored server-side (revocable, expiring). The server derives the user from the cookie on every request; request schemas are `.strict()`, so a client-sent `userId`/`workspaceId` that isn't part of the contract is rejected, and ids that *are* part of the contract are only ever used as lookup keys under RLS. Mutating routes also reject cross-origin `Origin` headers.

**Roles.** viewer = read; editor = create/edit/delete projects and notes and summarize; owner = + invite members. Enforced in services *and* RLS.

**LLM summarize.** `LlmProvider` interface with a deterministic `MockProvider`. Note text is untrusted: sanitized (control/bidi chars, length caps), passed only as JSON **data** (never concatenated into the system prompt), model has no tools, output must be *exactly* one JSON object matching a strict Zod schema (no fences/prose/extra keys), up to 2 attempts, only validated output is stored, never logged note text, rendered as plain text. An advisory regex flags instruction-like notes in the UI – safety does not depend on detecting them. The model call runs outside any DB transaction.

### Trade-offs
- **Own auth instead of Supabase Auth** to keep `docker compose up` self-contained and make RLS identity explicit. With Supabase you would replace `app.current_user_id()` with `auth.uid()`.
- **`set_config` per transaction** costs a round trip and needs a transaction per request; in exchange identity cannot leak across pooled connections.
- **Policy functions are `SECURITY DEFINER`** (avoids recursion on `memberships`); they only ever answer about the current user and pin `search_path`.
- **Inviting requires an existing user** (no email flow); the "no such user" answer is only visible to owners, but it does allow account enumeration by owners.
- **Dev defaults** (`postgres/postgres`, `app_user_pw`) live in `docker-compose.yml`/`config.ts` for local use only; production must supply env vars.
- Tests run against a real Postgres (RLS can't be meaningfully mocked) and share one DB, so files run serially.
- Plain UI, single page with URL state (`?w=&p=`); no optimistic updates, pagination or realtime.

## What I'd do next
- Rate limiting + lockout on login, CSRF tokens for non-browser clients, password reset / sign-up / email invites with pending-invite state.
- Role changes, member removal, "last owner" protection; audit log table.
- Pagination and search on projects/notes; optimistic UI; component and Playwright e2e tests.
- Real provider adapter (with request budgets, timeouts, cost tracking, and an eval set for injection attempts); async job queue for summaries; summary history UI.
- Run the isolation suite in CI against Postgres, add a policy-lint test that fails if any table lacks RLS or a restrictive policy, and a property-based cross-tenant fuzz test.
- Observability: structured logs with request ids, metrics on 4xx/5xx and summary validation failures.

## AI usage
See [`ai-log/`](./ai-log) for the available Claude and Copilot conversation captures. They are not complete, unedited native exports; add the full session transcripts before submission.

## Layout
```
db/migrations/   001 schema · 002 RLS, policies, grants, SQL functions
scripts/         migrate / seed / reset CLI, direct-DB attack demo
src/lib/         db (withUser), auth, services (authz + queries), summary (pure), llm (provider), summarize (orchestration)
src/app/api/     route handlers (thin)    src/components/  UI
tests/           isolation · auth · summary · summarize
```


### Recorded video link

https://drive.google.com/file/d/1YLiVoQmpFLmp6HU_4SNhfEZAWJstBY7e/view?usp=drive_link