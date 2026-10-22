-- =====================================================================================
-- Row-level security.
--
-- Model: the app connects as `app_user` (NOT a superuser, no BYPASSRLS, not the table
-- owner). Each request runs in a transaction that sets `app.user_id` with
-- set_config(..., is_local => true). Policies derive everything from that value.
--
-- Fail-closed design:
--   * RLS is enabled on every table; no policy = no access.
--   * app.current_user_id() returns NULL for unset / empty / malformed values, and
--     every comparison with NULL is NULL, which RLS treats as "deny".
--   * RESTRICTIVE policies are AND-ed with all permissive ones. Even if someone later
--     adds a sloppy permissive policy such as USING (true), the restrictive
--     "tenant_boundary" policy still requires workspace membership.
--   * app_user has column-level privileges, so it can never rewrite workspace_id,
--     created_by or read password_hash.
-- =====================================================================================

create or replace function app.current_user_id() returns uuid
language plpgsql stable as $$
declare
  v text := nullif(current_setting('app.user_id', true), '');
begin
  return v::uuid;
exception when others then
  return null;  -- malformed value: behave as "not logged in"
end $$;

-- SECURITY DEFINER so membership lookups inside policies do not recurse into the
-- memberships policy. They only ever answer about the *current* user.
create or replace function app.role_in(p_workspace uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select m.role from public.memberships m
  where m.workspace_id = p_workspace and m.user_id = app.current_user_id();
$$;

create or replace function app.shares_workspace(p_other uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.memberships a
    join public.memberships b on a.workspace_id = b.workspace_id
    where a.user_id = p_other and b.user_id = app.current_user_id()
  );
$$;

-- ---- authentication helpers (callable before a user is known) -----------------------
create or replace function app.login_lookup(p_email text)
returns table (id uuid, password_hash text)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.password_hash from public.users u where u.email = lower(p_email);
$$;

create or replace function app.create_session(p_user uuid, p_token_hash text, p_ttl_hours int)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.sessions (token_hash, user_id, expires_at)
  values (p_token_hash, p_user, now() + make_interval(hours => p_ttl_hours));
$$;

create or replace function app.session_user(p_token_hash text)
returns table (id uuid, email text, name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.email, u.name
  from public.sessions s join public.users u on u.id = s.user_id
  where s.token_hash = p_token_hash and s.expires_at > now();
$$;

create or replace function app.destroy_session(p_token_hash text)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.sessions where token_hash = p_token_hash;
$$;

-- Owners invite an existing user. Needs definer rights because owners cannot read
-- users who are not yet members. Authorization is re-checked inside the function.
create or replace function app.invite_member(p_workspace uuid, p_email text, p_role text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
begin
  if app.role_in(p_workspace) is distinct from 'owner' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'editor', 'viewer') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  select id into v_uid from public.users where email = lower(p_email);
  if v_uid is null then
    return 'no_user';
  end if;
  insert into public.memberships (workspace_id, user_id, role)
  values (p_workspace, v_uid, p_role)
  on conflict do nothing;
  if found then return 'invited'; else return 'exists'; end if;
end $$;

-- ---- enable RLS everywhere ----------------------------------------------------------
alter table users             enable row level security;
alter table workspaces        enable row level security;
alter table memberships       enable row level security;
alter table projects          enable row level security;
alter table notes             enable row level security;
alter table project_summaries enable row level security;
alter table sessions          enable row level security;   -- no policies: app_user can never touch it directly

-- ---- restrictive backstops ----------------------------------------------------------
create policy require_user on users       as restrictive for all to app_user
  using (app.current_user_id() is not null) with check (app.current_user_id() is not null);
create policy require_user on workspaces  as restrictive for all to app_user
  using (app.current_user_id() is not null) with check (app.current_user_id() is not null);
create policy require_user on memberships as restrictive for all to app_user
  using (app.current_user_id() is not null) with check (app.current_user_id() is not null);

create policy tenant_boundary on projects          as restrictive for all to app_user
  using (app.role_in(workspace_id) is not null) with check (app.role_in(workspace_id) is not null);
create policy tenant_boundary on notes             as restrictive for all to app_user
  using (app.role_in(workspace_id) is not null) with check (app.role_in(workspace_id) is not null);
create policy tenant_boundary on project_summaries as restrictive for all to app_user
  using (app.role_in(workspace_id) is not null) with check (app.role_in(workspace_id) is not null);

-- ---- permissive policies ------------------------------------------------------------
create policy users_select on users for select to app_user
  using (id = app.current_user_id() or app.shares_workspace(id));

create policy workspaces_select on workspaces for select to app_user
  using (app.role_in(id) is not null);

create policy memberships_select on memberships for select to app_user
  using (user_id = app.current_user_id() or app.role_in(workspace_id) is not null);
-- no insert/update/delete policy on memberships: changes only via app.invite_member()

-- projects: viewers read; editors + owners write
create policy projects_select on projects for select to app_user
  using (app.role_in(workspace_id) is not null);
create policy projects_insert on projects for insert to app_user
  with check (app.role_in(workspace_id) in ('editor', 'owner') and created_by = app.current_user_id());
create policy projects_update on projects for update to app_user
  using (app.role_in(workspace_id) in ('editor', 'owner'))
  with check (app.role_in(workspace_id) in ('editor', 'owner'));
create policy projects_delete on projects for delete to app_user
  using (app.role_in(workspace_id) in ('editor', 'owner'));

create policy notes_select on notes for select to app_user
  using (app.role_in(workspace_id) is not null);
create policy notes_insert on notes for insert to app_user
  with check (app.role_in(workspace_id) in ('editor', 'owner') and created_by = app.current_user_id());
create policy notes_update on notes for update to app_user
  using (app.role_in(workspace_id) in ('editor', 'owner'))
  with check (app.role_in(workspace_id) in ('editor', 'owner'));
create policy notes_delete on notes for delete to app_user
  using (app.role_in(workspace_id) in ('editor', 'owner'));

create policy summaries_select on project_summaries for select to app_user
  using (app.role_in(workspace_id) is not null);
create policy summaries_insert on project_summaries for insert to app_user
  with check (app.role_in(workspace_id) in ('editor', 'owner') and created_by = app.current_user_id());

-- ---- privileges (least privilege, column level where it matters) --------------------
grant usage on schema public, app to app_user;

grant select (id, email, name, created_at) on users to app_user;   -- never password_hash
grant select on workspaces, memberships to app_user;
grant select, insert, delete on projects, notes to app_user;
grant update (name, description, updated_at) on projects to app_user;
grant update (title, content, updated_at) on notes to app_user;     -- workspace_id/project_id immutable
grant select, insert on project_summaries to app_user;

revoke execute on all functions in schema app from public;
grant  execute on all functions in schema app to app_user;
