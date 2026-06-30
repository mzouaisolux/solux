-- =====================================================================
-- m127 — RPC: grouped project_request status counts (scalability pattern).
-- =====================================================================
--
-- The reusable aggregate behind the My Requests dashboard (projects/page.tsx)
-- and the Projects nav badge (lib/project-queue.getProjectActions). Replaces
-- "fetch ALL project_requests then count in JS" with ONE grouped SQL
-- aggregate — correct and cheap at any volume.
--
-- SECURITY INVOKER (the default): runs under the CALLER's RLS, so the counts
-- are automatically role-scoped (sales see only their own rows; director /
-- admin / ops / TLM see all) with NO data leak and NO scoping to replicate.
-- Active (non-archived) rows only, matching summarizeProjects().
--
-- The app calls this defensively (falls back to the legacy fetch-all + JS
-- summarize if this migration isn't applied yet), so deploy order is safe.
--
-- Idempotent. Apply MANUALLY in Supabase.
-- =====================================================================

begin;

create or replace function project_request_status_counts()
returns table (status text, total bigint, mine bigint)
language sql
security invoker
stable
as $$
  select status,
         count(*)::bigint                                   as total,
         count(*) filter (where owner_id = auth.uid())::bigint as mine
    from project_requests
   where archived_at is null
   group by status;
$$;

revoke all on function project_request_status_counts() from public;
grant execute on function project_request_status_counts() to authenticated;

insert into schema_migrations (filename, note)
values ('127_project_request_status_counts.sql',
        'RPC grouped status counts for My Requests + nav badge (replaces fetch-all + JS count)')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- POST-CHECK:
--   select * from project_request_status_counts();   -- as a signed-in user
--   select * from schema_migrations where filename = '127_project_request_status_counts.sql';
-- ROLLBACK:  drop function if exists project_request_status_counts();
-- ---------------------------------------------------------------------
