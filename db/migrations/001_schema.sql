-- Core schema. Every tenant table carries workspace_id so policies stay simple
-- and composite foreign keys can prove a child row belongs to the same workspace as its parent.

create schema if not exists app;

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique check (email = lower(email)),
  name          text not null check (length(trim(name)) between 1 and 100),
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);

create table memberships (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  role         text not null check (role in ('owner', 'editor', 'viewer')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index memberships_user_idx on memberships (user_id);

create table projects (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 120),
  description  text not null default '' check (length(description) <= 2000),
  created_by   uuid not null references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, workspace_id)
);
create index projects_workspace_idx on projects (workspace_id);

-- (project_id, workspace_id) must match a project row: a note can never point at a
-- project in a different workspace, even if application code has a bug.
create table notes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id   uuid not null,
  title        text not null check (length(trim(title)) between 1 and 200),
  content      text not null default '' check (length(content) <= 10000),
  created_by   uuid not null references users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (project_id, workspace_id) references projects (id, workspace_id) on delete cascade
);
create index notes_project_idx on notes (project_id);
create index notes_workspace_idx on notes (workspace_id);

create table project_summaries (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id   uuid not null,
  summary      jsonb not null,           -- already validated against the Zod schema
  meta         jsonb not null default '{}'::jsonb,
  model        text not null,
  created_by   uuid not null references users(id),
  created_at   timestamptz not null default now(),
  foreign key (project_id, workspace_id) references projects (id, workspace_id) on delete cascade
);
create index project_summaries_project_idx on project_summaries (project_id, created_at desc);

-- Server-side sessions. Only the SHA-256 of the cookie token is stored.
create table sessions (
  token_hash text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
