-- =====================================================================
-- m052 — User display names (user_profiles).
-- =====================================================================
--
-- Until now users were identified by email prefix ("john.smith") or
-- "role · uuid8". That's unreadable in conversations, forecasts, audit
-- timelines, and operational tracking.
--
-- This adds a lightweight `user_profiles` table holding a human display
-- name per user, settable by admin / super-admin. Everything that
-- renders a person (conversations, forecast-by-rep, business KPIs,
-- audit actor labels) resolves through it.
--
--   user_profiles.user_id      → auth.users(id), PK
--   user_profiles.display_name → "John Smith", "Mehdi", "Benin Logistics"
--
-- RLS:
--   read  → any authenticated user (names aren't sensitive and must
--           render everywhere)
--   write → admin or super-admin only
--
-- Also extends list_users_with_roles() to return the display name so
-- the /admin/users screen can show + edit it.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------
create table if not exists user_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id)
);

-- ---------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------
alter table user_profiles enable row level security;

drop policy if exists "user_profiles_read" on user_profiles;
create policy "user_profiles_read" on user_profiles for select
  using (auth.role() = 'authenticated');

drop policy if exists "user_profiles_write" on user_profiles;
create policy "user_profiles_write" on user_profiles for all
  using (
    exists (
      select 1 from user_roles r
       where r.user_id = auth.uid()
         and (r.role = 'admin' or coalesce(r.super_admin, false))
    )
  )
  with check (
    exists (
      select 1 from user_roles r
       where r.user_id = auth.uid()
         and (r.role = 'admin' or coalesce(r.super_admin, false))
    )
  );

-- ---------------------------------------------------------------------
-- 3. Extend the user-listing RPC with the display name.
--    DROP + CREATE because the return type changes (can't CREATE OR
--    REPLACE across a different RETURNS TABLE shape).
-- ---------------------------------------------------------------------
drop function if exists list_users_with_roles();

create or replace function list_users_with_roles()
returns table (
  out_user_id         uuid,
  out_email           text,
  out_display_name    text,
  out_role            text,
  out_super_admin     boolean,
  out_user_created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (
    select 1 from public.user_roles ur_check
     where ur_check.user_id = auth.uid()
       and ur_check.super_admin = true
  ) then
    raise exception 'list_users_with_roles: super-admin only';
  end if;

  return query
  select
    u.id                              as out_user_id,
    u.email::text                     as out_email,
    up.display_name                   as out_display_name,
    ur.role::text                     as out_role,
    coalesce(ur.super_admin, false)   as out_super_admin,
    u.created_at                      as out_user_created_at
  from auth.users u
  left join public.user_roles ur on ur.user_id = u.id
  left join public.user_profiles up on up.user_id = u.id
  order by u.created_at desc;
end;
$$;

revoke all on function list_users_with_roles() from public, anon;
grant execute on function list_users_with_roles() to authenticated;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately as a super-admin):
--
--   -- 1. Table exists
--   select to_regclass('public.user_profiles');  -- not null
--
--   -- 2. RPC returns the new column
--   select out_email, out_display_name, out_role
--     from list_users_with_roles() limit 5;
--
--   -- 3. Set a display name (as admin/super)
--   insert into user_profiles (user_id, display_name)
--   values ('<some-user-uuid>', 'John Smith')
--   on conflict (user_id) do update set display_name = excluded.display_name;
-- ---------------------------------------------------------------------
