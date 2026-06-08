-- =====================================================================
-- Client delete RPCs (SECURITY DEFINER) — RLS-safe dependency counts.
-- =====================================================================
--
-- The bug
-- -------
-- The previous delete flow ran COUNT queries with the caller's JWT, so
-- RLS on documents / production_task_lists / production_orders filtered
-- out rows the caller couldn't see (e.g. a Sales user counting other
-- reps' quotations for the same client). The pre-flight reported 0
-- dependencies → the action tried to DELETE → Postgres rejected with
-- the FK violation we were trying to surface a clean message for, and
-- the user saw the generic "1 error" again.
--
-- Two SECURITY DEFINER RPCs fix this:
--
--   count_client_dependencies(client_id) → returns the TRUE counts
--     across documents + task lists + production orders, bypassing
--     RLS. The action uses this for the pre-flight check.
--
--   delete_client_safe(client_id) → re-runs the count inside the
--     function, refuses with a precise error if anything is linked,
--     otherwise performs the DELETE in the same transaction. Atomic;
--     no time-of-check vs time-of-use gap.
--
-- Both functions are owner-executed (bypass RLS) but limited to
-- authenticated callers. We DON'T require super-admin here — any user
-- who currently has UI access to the delete button can call them;
-- the count enforces safety regardless of who's calling.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---- 1. Count dependencies (RLS-bypassing) ----
drop function if exists count_client_dependencies(uuid);

create or replace function count_client_dependencies(target_client_id uuid)
returns table (
  document_count       bigint,
  task_list_count      bigint,
  production_order_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    (select count(*) from documents             where client_id = target_client_id),
    (select count(*) from production_task_lists where client_id = target_client_id),
    (select count(*) from production_orders     where client_id = target_client_id);
end;
$$;

grant execute on function count_client_dependencies(uuid) to authenticated;

-- ---- 2. Atomic delete-or-refuse (RLS-bypassing) ----
drop function if exists delete_client_safe(uuid);

create or replace function delete_client_safe(target_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  doc_n  bigint;
  tl_n   bigint;
  po_n   bigint;
  parts  text := '';
begin
  -- Same true counts as count_client_dependencies, inlined so the
  -- read + delete happen in one transaction (no TOCTOU window).
  select count(*) into doc_n from documents             where client_id = target_client_id;
  select count(*) into tl_n  from production_task_lists where client_id = target_client_id;
  select count(*) into po_n  from production_orders     where client_id = target_client_id;

  if (doc_n + tl_n + po_n) > 0 then
    if doc_n > 0 then parts := parts || doc_n || ' quotation(s)';                            end if;
    if tl_n  > 0 then parts := parts || case when length(parts)>0 then ', ' else '' end || tl_n || ' task list(s)';                end if;
    if po_n  > 0 then parts := parts || case when length(parts)>0 then ', ' else '' end || po_n || ' production order(s)';        end if;
    raise exception
      'Cannot delete this client — they have % linked. Use "Archive client" instead to hide them from the active list while preserving the commercial history.',
      parts
      using errcode = '23503'; -- FK-style; treated as a 23xxx integrity error by the client
  end if;

  delete from clients where id = target_client_id;
end;
$$;

grant execute on function delete_client_safe(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately, replace UUID):
--
--   select * from count_client_dependencies('00000000-0000-0000-0000-000000000000');
--   -- Expected: 1 row with 3 bigint columns
--
--   select delete_client_safe('00000000-0000-0000-0000-000000000000');
--   -- Expected: either an exception with a precise message, or no rows
-- ---------------------------------------------------------------------
