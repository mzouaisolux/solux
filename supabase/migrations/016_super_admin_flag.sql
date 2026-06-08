-- Super-admin capability flag.
--
-- A `super_admin` user is functionally an admin at the DB layer (their
-- `role` column stays as 'admin' so existing RLS policies keep working
-- unchanged), plus an extra capability: a frontend "View As" simulator
-- that lets them preview the UI as any other role for dev/testing.
--
-- The simulation is purely cookie-driven and only affects rendering —
-- every server action still checks the real role from this table.
--
-- Run in Supabase SQL Editor. Idempotent.

begin;

alter table user_roles
  add column if not exists super_admin boolean not null default false;

notify pgrst, 'reload schema';

commit;
