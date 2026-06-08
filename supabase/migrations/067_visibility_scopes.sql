-- =====================================================================
-- m067 — Visibility / access-scope foundation (Phase 2a).
-- =====================================================================
--
-- The data model for "who can SEE what" (distinct from action perms).
-- Everything is ADDITIVE: new tables + a region column. NO existing
-- table's RLS is changed here, so this migration cannot lock anyone out.
-- The engine (lib/visibility.ts) falls back to today's behavior (sales =
-- own, technical = all) until grants are assigned, so it's safe to apply
-- before any page is wired to it.
--
--   teams         — grouping primitive (sales team / region / department),
--                   self-referencing for hierarchy (region → teams).
--   team_members  — user ∈ team, as 'member' or 'manager'.
--   access_grants — WHAT a user may see (union of grants):
--                   self | team | region | lens('production'|'finance'|
--                   'logistics') | all. Optional expires_at = delegation.
--   clients.region_id — region is account-centric (per decision), FK to a
--                   team of kind 'region'.
--
-- New tables: read = authenticated (so the app can resolve scopes; grants
-- restricted to self + management); write = management only.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'team'
    check (kind in ('team', 'region', 'department')),
  parent_team_id uuid references teams(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists teams_parent_idx on teams(parent_team_id);
create index if not exists teams_kind_idx on teams(kind);

create table if not exists team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'member'
    check (member_role in ('member', 'manager')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists team_members_user_idx on team_members(user_id);

create table if not exists access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope_type text not null
    check (scope_type in ('self', 'team', 'region', 'lens', 'all')),
  team_id uuid references teams(id) on delete cascade,   -- team / region
  lens_key text,                                          -- production|finance|logistics
  granted_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz,                                 -- delegation
  created_at timestamptz not null default now()
);
create index if not exists access_grants_user_idx on access_grants(user_id);

-- Region is account-centric (a team of kind 'region').
alter table clients
  add column if not exists region_id uuid references teams(id) on delete set null;
create index if not exists clients_region_idx on clients(region_id);

-- ---------------------------------------------------------------------
-- RLS on the new tables. Reusable management predicate.
-- ---------------------------------------------------------------------
alter table teams         enable row level security;
alter table team_members  enable row level security;
alter table access_grants enable row level security;

-- teams / team_members are not sensitive → readable by any authenticated
-- user (the engine needs them to resolve team-based visibility).
drop policy if exists "teams read" on teams;
create policy "teams read" on teams for select to authenticated using (true);

drop policy if exists "team_members read" on team_members;
create policy "team_members read" on team_members
  for select to authenticated using (true);

-- access_grants: a user may read THEIR OWN grants (the engine needs this);
-- management reads all (for the admin UI).
drop policy if exists "access_grants read" on access_grants;
create policy "access_grants read" on access_grants for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from user_roles r
       where r.user_id = auth.uid()
         and (r.role in ('admin', 'task_list_manager', 'operations')
              or coalesce(r.super_admin, false))
    )
  );

-- Writes (insert/update/delete) on all three: management only.
do $$
declare t text;
begin
  foreach t in array array['teams', 'team_members', 'access_grants'] loop
    execute format('drop policy if exists %I on %I', t || ' write', t);
    execute format($f$
      create policy %I on %I for all to authenticated
        using (exists (select 1 from user_roles r where r.user_id = auth.uid()
                 and (r.role in ('admin','task_list_manager','operations')
                      or coalesce(r.super_admin,false))))
        with check (exists (select 1 from user_roles r where r.user_id = auth.uid()
                 and (r.role in ('admin','task_list_manager','operations')
                      or coalesce(r.super_admin,false))))
    $f$, t || ' write', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select to_regclass('public.teams'), to_regclass('public.team_members'),
--          to_regclass('public.access_grants');
--   select count(*) from information_schema.columns
--    where table_name='clients' and column_name='region_id';   -- 1
-- ---------------------------------------------------------------------
