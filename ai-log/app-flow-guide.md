# App Flow and Database Guide

This is a technical walkthrough of the current repository. It is documentation, not an AI-session transcript.

## 1. Start the application locally

Requirements: Node.js 20 or newer and Docker Desktop running. In PowerShell, use `npm.cmd` if the execution policy blocks `npm.ps1`.

```powershell
npm.cmd install
npm.cmd run db:up
npm.cmd run db:reset
npm.cmd test
npm.cmd run dev
```

Open `http://localhost:3000`. Demo accounts use password `password123`; for example, sign in as `bob@example.com` to use Acme as an editor.

For a later restart, start Docker Desktop, run `npm.cmd run db:up`, then `npm.cmd run dev`. Do not run `db:reset` unless you want to rebuild the database and restore the demo data.

## 2. What Docker does

`docker-compose.yml` starts one `postgres:16-alpine` container:

- Inside the container, PostgreSQL listens on port `5432`.
- Docker maps host port `54329` to container port `5432`, so local tools connect to `localhost:54329`.
- The database is named `notes`; its initial administrative role is `postgres` with the local-development password `postgres`.
- The health check waits for PostgreSQL to accept connections. `npm run db:up` uses `docker compose up -d --wait`.
- There is no explicit Docker volume in this Compose file. Removing the container with `npm run db:down` can remove its database files too.

Docker only provides the PostgreSQL server. It does not apply this repository's migrations or seed rows; the scripts below do that.

## 3. Database connection identities

`src/lib/config.ts` reads environment variables and supplies local defaults:

- `ADMIN_DATABASE_URL` connects as `postgres`. Migration and seed scripts use this connection because they need permission to create roles, schemas, tables, and seed rows.
- `DATABASE_URL` connects as `app_user`. The Next.js application uses this restricted role for normal requests.
- `APP_DB_PASSWORD` is the password assigned to `app_user` by the migration script.

The sample values are in `.env.example`. These credentials are for local development only. Do not use them for a deployed database.

The app's `src/lib/db.ts` creates a `pg` connection pool from `DATABASE_URL` with a maximum of 10 connections. The pool is reused during local Next.js development to avoid creating a new pool on every reload.

## 4. What each database script does

The npm scripts in `package.json` call `scripts/cli.ts`, which dispatches to `scripts/db.ts`:

- `npm run db:up` starts Docker Compose and waits for the PostgreSQL health check.
- `npm run db:migrate` ensures `app_user` exists with `NOSUPERUSER` and `NOBYPASSRLS`, creates `schema_migrations`, then applies unapplied `.sql` files from `db/migrations` in filename order. Each migration and its migration record are committed together.
- `npm run db:seed` truncates the app tables and inserts the demo users, workspaces, memberships, projects, and notes. It hashes the shared demo password with bcrypt. **This removes existing app data in this database.**
- `npm run db:reset` drops the `app` and `public` schemas, recreates the schema by running migrations, then seeds demo data. **This is destructive to the contents of the configured database.**
- `npm run db:down` runs `docker compose down`; without a configured volume, do not expect the container's database files to survive removal.
- `npm run demo:db-attack` runs direct SQL attempts as Bob through `withUser`, demonstrating the row-level security and database-grant denials.

Migration `001_schema.sql` creates the core tables and composite foreign keys. Migration `002_security.sql` creates helper functions, enables row-level security (RLS), adds policies, and grants the restricted app role only the required table and column privileges.

The seed includes Acme Corp and Globex Inc. Alice owns Acme and can view Globex; Bob edits Acme; Dave views Acme; Carol owns Globex; Evan edits Globex. The seed also includes a note containing the phrase "ignore previous instructions" for the summarization safety demo.

## 5. Request and authentication flow

### Login

1. The login page posts email and password to `POST /api/auth/login`.
2. The shared route wrapper marks login as unauthenticated (`auth: false`) so no session cookie is required yet.
3. The request body is parsed and validated by the strict Zod `loginSchema`.
4. `authenticate()` calls the database's `app.login_lookup()` security-definer function because the user's identity is not yet known. Passwords are checked with bcrypt; unknown users are compared against a dummy hash to reduce timing differences.
5. On success, the server generates a random token, stores only its SHA-256 hash through `app.create_session()`, and sets the raw token in an HttpOnly, SameSite=Lax cookie. The session expires after 12 hours.

### Authenticated request

1. A browser request reaches an API route. Except for login, the route wrapper calls `requireUser()`.
2. `requireUser()` reads the session cookie and calls `userFromToken()`. The server resolves the user using the hashed token and the database's `app.session_user()` function. User identity is never taken from the request body.
3. For state-changing methods, the route wrapper also rejects a mismatching `Origin` header. It parses request bodies through Zod schemas; the schemas are strict, so unexpected fields are rejected.
4. The API handler calls a service function inside `withUser(user.id, ...)`.
5. `withUser()` checks out a pooled connection, begins a transaction, and executes `set_config('app.user_id', userId, true)`. The `true` makes this setting local to that transaction. The handler's SQL runs in that transaction, followed by commit; failures roll back, and the connection is always released.
6. PostgreSQL evaluates grants and RLS policies as `app_user`. The policies derive workspace membership and role from the transaction's server-verified `app.user_id` value.
7. The shared wrapper converts expected application errors to HTTP responses. RLS/privilege errors and malformed UUID errors are returned as a non-revealing `404 Not found`.

### Row-level security

The app database role is not a superuser, does not have `BYPASSRLS`, and does not own the tables. `app.current_user_id()` returns `NULL` for missing or malformed identity values; policies then deny access. `app.role_in(workspace_id)` looks up the current user's role. Restrictive tenant-boundary policies on projects, notes, and summaries are AND-ed with permissive policies, so a permissive policy alone cannot expose rows across those tenant boundaries.

The database also restricts sensitive columns: `app_user` cannot read `users.password_hash`, cannot directly access `sessions`, and cannot update note/project ownership or workspace-link columns. Notes and summaries use composite foreign keys to ensure their project and workspace IDs match.

## 6. API route map

All routes live under `src/app/api`; they use `route()` from `src/lib/http.ts` unless otherwise noted.

| Method and path | Purpose |
| --- | --- |
| `POST /api/auth/login` | Validate credentials, create a session, and set the cookie. |
| `POST /api/auth/logout` | Revoke the current session and clear the cookie. |
| `GET /api/me` | Return the authenticated user's profile and visible workspaces. |
| `GET /api/projects?workspaceId=...` | List projects for a workspace the caller can view. |
| `POST /api/projects` | Create a project after editor-level authorization. |
| `GET /api/projects/[id]` | Load a visible project and its latest summary. |
| `PATCH /api/projects/[id]` | Update a project after editor-level authorization. |
| `DELETE /api/projects/[id]` | Delete a project; its notes/summaries cascade from the foreign keys. |
| `GET /api/projects/[id]/notes` | List notes in a visible project. |
| `POST /api/notes` | Create a note; workspace ID is derived from its visible project, not accepted from the client. |
| `PATCH /api/notes/[id]` | Edit a note after editor-level authorization. |
| `DELETE /api/notes/[id]` | Delete a note after editor-level authorization. |
| `GET /api/workspaces/[id]/members` | List members when the caller belongs to that workspace. |
| `POST /api/workspaces/[id]/members` | Invite an existing user; both service code and `app.invite_member()` require owner role. |
| `POST /api/projects/[id]/summarize` | Generate, validate, and store a project summary. |

`src/lib/services.ts` implements application-level membership and role checks in addition to RLS. A non-member gets `404`; a workspace member without enough privilege gets `403` for service-layer operations.

## 7. Browser UI flow

The home page in `src/app/page.tsx` checks the server-side session and redirects anonymous visitors to `/login`. After login, `src/components/Dashboard.tsx` loads `/api/me`, displays the user's workspaces, and allows switching workspaces. It then loads projects and members. Selecting a project loads its details and notes. Editors and owners can create, edit, and delete projects/notes; owners can invite members. Loading, busy, and error states are handled in the UI.

The URL stores the selected workspace and project IDs for navigation convenience. These IDs are only lookup inputs: the server still authenticates the user, authorizes the operation, and lets RLS filter rows. A forged URL or request-body ID does not grant access.

## 8. Project summary flow

1. The UI sends `POST /api/projects/[id]/summarize`.
2. `summarizeProject()` loads the project and its notes under `withUser()` and requires editor role.
3. It sanitizes note text and sends titles/content as JSON data to the provider. The model call runs outside a database transaction.
4. `LlmProvider` defines the provider interface. The default `MockProvider` needs no network or API key and can return malformed JSON on its first attempt.
5. `parseModelOutput()` requires one JSON value matching the strict Zod `SummarySchema`. Invalid output is retried once; if still invalid, nothing is stored.
6. Valid output is stored in `project_summaries` in a new user-scoped transaction, after checking editor role again. Note text is not logged, and React renders the summary as plain text.

`MOCK_LLM_MALFORMED_ONCE=1` is the local default, so a successful summary commonly reports two attempts.

## 9. Tests

`npm test` runs Vitest. `tests/global-setup.ts` applies migrations and seeds the database before the suite. DB-backed tests reseed between test cases, so point test runs only at a disposable local database. `tests/isolation.test.ts` exercises cross-workspace service calls, raw SQL/RLS, fail-closed identity, and role behavior. `tests/auth.test.ts` covers authentication and sessions. Summary validation and orchestration are tested in `tests/summary.test.ts` and `tests/summarize.test.ts`.

`npm run test:unit` runs only the pure summary-validation tests and does not need PostgreSQL. `npm run typecheck` checks TypeScript; `npm run build` builds the Next.js app.

## 10. Browse tables in VS Code

The workspace recommends the PostgreSQL extension in `.vscode/extensions.json`. Start PostgreSQL and seed it first. Add a connection with host `localhost`, port `54329`, database `notes`, user `postgres`, and the local password from `.env.example`. Use the PostgreSQL explorer's **Select Top 1000** action on a table. Connect as the local admin to see all demo rows; the restricted `app_user` connection has RLS and will not show every tenant's data.

## Main code locations

- `docker-compose.yml`: local PostgreSQL container and port mapping.
- `scripts/cli.ts`, `scripts/db.ts`: migration, seed, and reset commands.
- `db/migrations/`: schema, foreign keys, RLS policies, functions, and grants.
- `src/lib/config.ts`, `src/lib/db.ts`: database URLs, pool, and user-scoped transactions.
- `src/lib/auth.ts`, `src/lib/session.ts`: login, hashed sessions, and cookie handling.
- `src/lib/http.ts`: shared API authentication, validation boundary, and error mapping.
- `src/lib/services.ts`: application-level authorization and data queries.
- `src/lib/summarize.ts`, `src/lib/summary.ts`, `src/lib/llm.ts`: summary orchestration, input/output safeguards, and mock provider.
- `src/app/api/`: HTTP route handlers; `src/components/Dashboard.tsx`: signed-in UI.
- `tests/`: database-backed authorization/auth/summary tests and pure validation tests.