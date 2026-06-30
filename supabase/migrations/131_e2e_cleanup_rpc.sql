-- =====================================================================
-- m131 — e2e_cleanup_run(): surgical teardown of ONE tagged E2E run.
-- =====================================================================
--
-- Purpose: the multi-session E2E harness (docs/PLAN_E2E_HARNESS.md) creates
-- REAL data through the REAL UI on the SHARED dev database — no full reset.
-- Every run stamps a unique tag `ZZZ_E2E_RUN_YYYYMMDD_HHMM` into the free-text
-- fields of its ROOT rows (clients.company_name, affairs.name,
-- project_requests.name). This function deletes exactly that run's subtree and
-- nothing else, so a campaign leaves the existing realistic data untouched.
--
-- WHY A SECURITY DEFINER RPC (and not a service_role script):
--   • There is NO service_role key in this environment. This function runs as
--     its owner (postgres) → bypasses RLS cleanly, WITHOUT distributing a
--     powerful key, and is auditable/testable.
--
-- SAFETY (this runs destructive DELETEs against a database that holds real
-- data — every guard below is load-bearing):
--   1. ADMIN-ONLY      — caller must hold user_roles.role = 'admin' (42501).
--   2. TAG SHAPE GUARD — refuses any tag not matching ^ZZZ_E2E_RUN_\d{8}_\d{4}
--                        (22023). Makes a broad/empty cleanup impossible.
--   3. EXACT PREFIX    — matches with starts_with(col, tag), NOT LIKE. The tag
--                        contains '_' which is a LIKE single-char wildcard; LIKE
--                        would match unrelated rows. starts_with is literal.
--   4. DRY-RUN DEFAULT — p_dry_run = true returns the scope counts and deletes
--                        NOTHING. The harness logs the plan, then re-calls with
--                        p_dry_run = false.
--   5. ATOMIC          — the whole function is one transaction of the caller:
--                        all-or-nothing.
--
-- DELETE ORDER (verified against the live schema + migration DDL, 2026-06-23 —
-- see docs/PLAN_E2E_HARNESS.md §5.2 / §10). We delete 6 PARENT levels explicitly
-- and rely on the verified ON DELETE CASCADE FKs to remove their children. The
-- order is forced by the only two NON-cascade constraints:
--   • project_requests.affair_id is ON DELETE RESTRICT (m124)  → requests BEFORE affairs
--   • documents/task_lists/orders .client_id is NO ACTION       → those 3 BEFORE clients
--
--   1. production_orders     → cascade: order_documents, order_document_audits, production_deadline_changes
--   2. production_task_lists → cascade: production_task_list_lines
--   3. documents             → cascade: document_lines
--   4. project_requests      → cascade: factory/freight cost requests, files, products  (BEFORE affairs)
--   5. affairs               → cascade: planned_actions
--   6. clients               → cascade: contacts
--
-- KNOWN RESIDUE (v1): entity_messages / notifications are polymorphic
-- (entity_type + entity_id, no FK) → not covered by cascades; they become
-- harmless orphans. Purge-by-entity_id is a documented follow-up.
--
-- Idempotent (create or replace). Apply MANUALLY in the Supabase SQL editor
-- AFTER A BACKUP / SNAPSHOT (project convention). Self-registers in
-- schema_migrations (m113 convention).
-- =====================================================================

begin;

create or replace function e2e_cleanup_run(
  p_run_tag text,
  p_dry_run boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_ids   uuid[];
  v_affair_ids   uuid[];
  v_request_ids  uuid[];
  v_document_ids uuid[];
  v_tasklist_ids uuid[];
  v_order_ids    uuid[];
  v_report       jsonb;
begin
  -- 1) ADMIN-ONLY. SECURITY DEFINER bypasses RLS, so we gate access ourselves.
  if not exists (
    select 1 from user_roles
     where user_id = auth.uid()
       and role = 'admin'
  ) then
    raise exception 'e2e_cleanup_run: admin only (caller % is not an admin)', auth.uid()
      using errcode = '42501';
  end if;

  -- 2) TAG SHAPE GUARD. The single most important safety check.
  if p_run_tag is null or p_run_tag !~ '^ZZZ_E2E_RUN_[0-9]{8}_[0-9]{4}' then
    raise exception
      'e2e_cleanup_run: refusing tag "%" — must match ZZZ_E2E_RUN_YYYYMMDD_HHMM', p_run_tag
      using errcode = '22023';
  end if;

  -- 3) Collect the tagged subtree top-down (EXACT prefix match, never LIKE).
  --    Each level also unions in rows reachable by FK from a higher level, so an
  --    orphaned-but-tagged row (e.g. affair whose client_id was SET NULL) is
  --    still caught by its own tag.
  select coalesce(array_agg(id), array[]::uuid[]) into v_client_ids
    from clients
   where starts_with(company_name, p_run_tag);

  select coalesce(array_agg(id), array[]::uuid[]) into v_affair_ids
    from affairs
   where client_id = any(v_client_ids)
      or starts_with(name, p_run_tag);

  select coalesce(array_agg(id), array[]::uuid[]) into v_request_ids
    from project_requests
   where client_id = any(v_client_ids)
      or affair_id = any(v_affair_ids)
      or starts_with(name, p_run_tag);

  select coalesce(array_agg(id), array[]::uuid[]) into v_document_ids
    from documents
   where client_id = any(v_client_ids)
      or affair_id = any(v_affair_ids);

  select coalesce(array_agg(id), array[]::uuid[]) into v_tasklist_ids
    from production_task_lists
   where quotation_id = any(v_document_ids)
      or affair_id    = any(v_affair_ids)
      or client_id    = any(v_client_ids);

  select coalesce(array_agg(id), array[]::uuid[]) into v_order_ids
    from production_orders
   where task_list_id = any(v_tasklist_ids)
      or quotation_id = any(v_document_ids)
      or affair_id    = any(v_affair_ids)
      or client_id    = any(v_client_ids);

  -- 4) Build the scope report (counts of the 6 parent levels).
  v_report := jsonb_build_object(
    'run_tag', p_run_tag,
    'dry_run', p_dry_run,
    'scope', jsonb_build_object(
      'clients',          coalesce(array_length(v_client_ids,   1), 0),
      'affairs',          coalesce(array_length(v_affair_ids,   1), 0),
      'project_requests', coalesce(array_length(v_request_ids,  1), 0),
      'documents',        coalesce(array_length(v_document_ids, 1), 0),
      'task_lists',       coalesce(array_length(v_tasklist_ids, 1), 0),
      'production_orders',coalesce(array_length(v_order_ids,    1), 0)
    )
  );

  -- 5) DRY-RUN stops here — nothing is deleted.
  if p_dry_run then
    return v_report || jsonb_build_object('deleted', false);
  end if;

  -- 6) Delete bottom-up. Children removed by verified ON DELETE CASCADE FKs.
  delete from production_orders     where id = any(v_order_ids);     -- + order_documents / order_document_audits / production_deadline_changes
  delete from production_task_lists where id = any(v_tasklist_ids);  -- + production_task_list_lines
  delete from documents             where id = any(v_document_ids);  -- + document_lines
  delete from project_requests      where id = any(v_request_ids);   -- + factory/freight cost reqs / files / products  (BEFORE affairs: RESTRICT m124)
  delete from affairs               where id = any(v_affair_ids);    -- + planned_actions
  delete from clients               where id = any(v_client_ids);    -- + contacts

  return v_report || jsonb_build_object('deleted', true);
end;
$$;

-- Lock it down: not callable by anon/public; only authenticated (the admin
-- session). The internal admin guard above is the real gate.
revoke all on function e2e_cleanup_run(text, boolean) from public;
grant execute on function e2e_cleanup_run(text, boolean) to authenticated;

-- Ledger (m113 convention).
insert into schema_migrations (filename, note)
values ('131_e2e_cleanup_rpc.sql',
        'e2e_cleanup_run(p_run_tag,p_dry_run) SECURITY DEFINER — surgical teardown of one tagged ZZZ_E2E_RUN_ subtree; admin-only; dry-run default')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- USAGE (from the harness, as the testadmin@ session):
--
--   -- 1) Dry-run: see what WOULD be deleted (no writes).
--   select e2e_cleanup_run('ZZZ_E2E_RUN_20260623_1430', true);
--     → {"run_tag":"...","dry_run":true,"deleted":false,
--        "scope":{"clients":1,"affairs":1,"project_requests":0,
--                 "documents":2,"task_lists":1,"production_orders":1}}
--
--   -- 2) For real.
--   select e2e_cleanup_run('ZZZ_E2E_RUN_20260623_1430', false);
--     → {... ,"deleted":true}
--
-- PostgREST RPC: POST /rest/v1/rpc/e2e_cleanup_run  {"p_run_tag":"...","p_dry_run":false}
--
-- SAFETY SELF-TEST (should RAISE, deleting nothing):
--   select e2e_cleanup_run('not-a-tag');                 -- 22023 (bad shape)
--   select e2e_cleanup_run('ZZZ_E2E_RUN_20260623_1430'); -- as non-admin → 42501
-- =====================================================================
