-- =====================================================================
-- m152 — delete_client_safe must count AFFAIRS + PROJECT REQUESTS too.
--
-- The bug (found 2026-07-07 via the quotation-builder 500)
-- --------------------------------------------------------
-- m032's delete_client_safe only counts documents / task lists /
-- production orders. A client whose only children are affairs (and/or
-- project requests) is deletable — the m076/m090 FKs then SET NULL,
-- silently orphaning those affairs ("Affaire Test 5 July" et al.).
-- Orphan affairs violate the core Client→Affair hierarchy: they can
-- never receive a quotation again, and any saved ?client= link keeps
-- rendering a phantom builder whose quickCreateAffair dies on FK 23503.
--
-- Fix: refuse (same "Archive client instead" message pattern) whenever
-- affairs or project requests still point at the client. The super-admin
-- path (admin_delete_client, m128) is untouched — it cascades those
-- children deliberately and remains the only true-delete escape hatch.
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor.
-- =====================================================================

begin;

-- ---- 1. Pre-flight counts (RLS-bypassing), extended shape ----
drop function if exists count_client_dependencies(uuid);

create or replace function count_client_dependencies(target_client_id uuid)
returns table (
  document_count          bigint,
  task_list_count         bigint,
  production_order_count  bigint,
  affair_count            bigint,
  project_request_count   bigint
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
    (select count(*) from production_orders     where client_id = target_client_id),
    (select count(*) from affairs               where client_id = target_client_id),
    (select count(*) from project_requests      where client_id = target_client_id);
end;
$$;

grant execute on function count_client_dependencies(uuid) to authenticated;

-- ---- 2. Atomic delete-or-refuse, now covering affairs + requests ----
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
  aff_n  bigint;
  pr_n   bigint;
  parts  text := '';
begin
  select count(*) into doc_n from documents             where client_id = target_client_id;
  select count(*) into tl_n  from production_task_lists where client_id = target_client_id;
  select count(*) into po_n  from production_orders     where client_id = target_client_id;
  select count(*) into aff_n from affairs               where client_id = target_client_id;
  select count(*) into pr_n  from project_requests      where client_id = target_client_id;

  if (doc_n + tl_n + po_n + aff_n + pr_n) > 0 then
    if doc_n > 0 then parts := parts || doc_n || ' quotation(s)';                                                                  end if;
    if tl_n  > 0 then parts := parts || case when length(parts)>0 then ', ' else '' end || tl_n  || ' task list(s)';               end if;
    if po_n  > 0 then parts := parts || case when length(parts)>0 then ', ' else '' end || po_n  || ' production order(s)';        end if;
    if aff_n > 0 then parts := parts || case when length(parts)>0 then ', ' else '' end || aff_n || ' project(s)';                 end if;
    if pr_n  > 0 then parts := parts || case when length(parts)>0 then ', ' else '' end || pr_n  || ' service request(s)';         end if;
    raise exception
      'Cannot delete this client — they have % linked. Use "Archive client" instead to hide them from the active list while preserving the commercial history.',
      parts
      using errcode = '23503';
  end if;

  delete from clients where id = target_client_id;
end;
$$;

grant execute on function delete_client_safe(uuid) to authenticated;

insert into schema_migrations (filename, note)
values ('152_client_delete_counts_affairs.sql',
        'delete_client_safe refuses when affairs/project requests exist (no more silent orphaning)')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- POST-CHECK: select * from count_client_dependencies('00000000-0000-0000-0000-000000000000');
--             -- Expected: 1 row with FIVE bigint columns
-- ROLLBACK:   re-run supabase/migrations/032_client_delete_rpc.sql
-- ---------------------------------------------------------------------
