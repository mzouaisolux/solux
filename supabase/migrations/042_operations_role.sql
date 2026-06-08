-- =====================================================================
-- Add the `operations` role to the user_roles taxonomy.
-- =====================================================================
--
-- Solux operational workflow needs a 5th storable role that owns
-- production duration / timeline / shipment coordination. Until the
-- permissions are refined later, Operations inherits the EXACT same
-- capability matrix as Task List Manager.
--
-- Concrete changes:
--   1. Widen user_roles.role CHECK constraint to accept 'operations'.
--   2. Update admin_set_user_role RPC (m029) so super-admin can assign
--      the new role from the /admin/users UI.
--   3. Seed role_permissions rows by mirroring task_list_manager —
--      ON CONFLICT DO NOTHING so re-running this migration (or future
--      capability additions) don't trample manual edits the super-admin
--      may have made via /admin/permissions.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------- 1. CHECK constraint on user_roles.role ----------
alter table user_roles
  drop constraint if exists user_roles_role_check;
alter table user_roles
  add constraint user_roles_role_check
  check (role in ('admin', 'sales', 'task_list_manager', 'operations'));

-- ---------- 2. admin_set_user_role RPC (m029 update) ----------
-- Same shape + behavior as before, just adds 'operations' to the
-- accept-list. Other validation (super-admin gate, etc.) unchanged.
drop function if exists admin_set_user_role(uuid, text);
create or replace function admin_set_user_role(
  target_user_id uuid,
  new_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_super boolean;
begin
  select super_admin into caller_is_super
    from user_roles where user_id = auth.uid() limit 1;
  if coalesce(caller_is_super, false) is not true then
    raise exception 'admin_set_user_role: super-admin only' using errcode = '42501';
  end if;

  if new_role not in ('admin', 'sales', 'task_list_manager', 'operations') then
    raise exception
      'admin_set_user_role: invalid role %', new_role
      using errcode = '22023';
  end if;

  if target_user_id = auth.uid() then
    raise exception
      'admin_set_user_role: cannot edit your own role'
      using errcode = '42501';
  end if;

  insert into user_roles (user_id, role)
  values (target_user_id, new_role)
  on conflict (user_id) do update set role = excluded.role;
end;
$$;
grant execute on function admin_set_user_role(uuid, text) to authenticated;

-- ---------- 3. Seed role_permissions for operations (mirror TLM) ----
-- Operations starts with the exact same capability set as task_list_manager.
-- The super-admin can refine via /admin/permissions later. ON CONFLICT
-- DO NOTHING means manual tweaks aren't overwritten if the migration
-- is re-run.
insert into role_permissions (role, permission_key, enabled)
select 'operations', permission_key, enabled
  from role_permissions
 where role = 'task_list_manager'
on conflict (role, permission_key) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   -- 1. CHECK constraint accepts the new value
--   select pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.user_roles'::regclass
--      and contype  = 'c';
--   -- Expected: CHECK (role = ANY (ARRAY['admin','sales',
--   --                'task_list_manager','operations']))
--
--   -- 2. Operations got the same capabilities as TLM
--   select count(*) filter (where enabled) as enabled_count
--     from role_permissions where role = 'operations';
--   -- Expected: same count as
--   --   select count(*) filter (where enabled) from role_permissions
--   --     where role = 'task_list_manager';
--
--   -- 3. RPC accepts operations
--   select admin_set_user_role('00000000-0000-0000-0000-000000000000', 'operations');
--   -- Expected: error 'production user does not exist' or similar — but
--   --   NOT 'invalid role'. Confirms the validation accepts the value.
-- ---------------------------------------------------------------------
