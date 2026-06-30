-- =====================================================================
-- m128 — admin_delete_client(): SUPER-ADMIN permanent client delete (Option B).
-- =====================================================================
--
-- Owner decision (2026-06-18): allow a SUPER-ADMIN to permanently delete a
-- client, but ONLY when the client has no financial/operational history —
-- otherwise refuse and require Archive (history must never be destroyed,
-- consistent with the m078 won-quotation lockdown).
--
-- This goes beyond delete_client_safe (m032), which only deletes the client
-- row (orphaning affairs/requests via SET NULL) and does NOT require
-- super-admin. Here we:
--   1. REQUIRE super-admin INSIDE the function — the function is granted to
--      `authenticated`, so a UI gate alone is not enough; any signed-in user
--      could call the RPC directly. The role check is the real lock.
--   2. REFUSE if the client has any document / task list / production order.
--   3. Otherwise cascade the SAFE children (affairs, project requests + their
--      CASCADE children, planned_actions) then delete the client — which
--      CASCADEs contacts + technical mappings and SET NULLs prospects/tenders.
--   All in the function's single transaction → atomic, fail-safe (any
--   unexpected RESTRICT raises and rolls the whole thing back).
--
-- Idempotent. Apply MANUALLY in Supabase.
-- =====================================================================

begin;

create or replace function admin_delete_client(p_client uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_super boolean;
  doc_n bigint; tl_n bigint; po_n bigint;
begin
  -- 1) super-admin only (RPC is directly callable by any authenticated user)
  select coalesce(bool_or(super_admin), false) into v_super
    from user_roles where user_id = auth.uid();
  if not coalesce(v_super, false) then
    raise exception
      'Super-admin only — permanent client deletion is reserved for system administrators.';
  end if;

  -- 2) refuse if any financial/operational history (archive instead)
  select count(*) into doc_n from documents             where client_id = p_client;
  select count(*) into tl_n  from production_task_lists  where client_id = p_client;
  select count(*) into po_n  from production_orders      where client_id = p_client;
  if (doc_n + tl_n + po_n) > 0 then
    raise exception
      'Cannot permanently delete: client has % quotation(s), % task list(s), % order(s). Archive it instead — the commercial history is preserved.',
      doc_n, tl_n, po_n using errcode = '23503';
  end if;

  -- 3) cascade the safe children, then the client (atomic)
  delete from planned_actions
        where affair_id in (select id from affairs where client_id = p_client);
  delete from project_requests
        where client_id = p_client
           or affair_id in (select id from affairs where client_id = p_client);
  delete from affairs where client_id = p_client;
  delete from clients where id = p_client;  -- CASCADE contacts + technical_mapping; SET NULL prospects/tenders
end;
$$;

revoke all on function admin_delete_client(uuid) from public;
grant execute on function admin_delete_client(uuid) to authenticated;

insert into schema_migrations (filename, note)
values ('128_admin_delete_client.sql',
        'super-admin guarded permanent client delete (Option B: refuse if financial history, else cascade safe children)')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- SMOKE (run as a super-admin; replace the uuid):
--   select admin_delete_client('00000000-0000-0000-0000-000000000000');
--   -- non-super → raises "Super-admin only…"; client with docs → raises
--   --  "Cannot permanently delete…"; clean client → deletes, returns void.
-- ROLLBACK:  drop function if exists admin_delete_client(uuid);
-- ---------------------------------------------------------------------
   /Users/mehdizouai/Library/Mobile Documents/com~apple~CloudDocs/IA MEHDI CLAUDE/APP FACTURATION/supabase/migrations/127_project_request_status_counts.sql