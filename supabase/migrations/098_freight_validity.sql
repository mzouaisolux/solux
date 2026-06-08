-- 098_freight_validity.sql
--
-- Freight validity + freight-update workflow + audit trail.
--
-- Freight costs are volatile (unlike factory cost / product pricing which are
-- stable). A quotation can sit for months, then the customer returns. This lets
-- Operations stamp a validity on the freight, Sales request a refresh, and
-- Operations update freight WITHOUT going back through the project request /
-- director approval / pricing workflow — only logistics pricing changes.
--
-- Idempotent. Run in Supabase SQL Editor.

begin;

-- ---------------------------------------------------------------------------
-- 1. Validity + update-request tracking on the freight cost request.
-- ---------------------------------------------------------------------------
alter table freight_cost_requests
  add column if not exists valid_until          date,
  add column if not exists update_requested_at  timestamptz,
  add column if not exists update_requested_by  uuid references auth.users(id) on delete set null,
  add column if not exists update_count         int not null default 0;

-- ---------------------------------------------------------------------------
-- 2. Freight cost audit — append-only trail of every freight update
--    (old vs new per-container breakdown + totals + validity).
-- ---------------------------------------------------------------------------
create table if not exists freight_cost_audit (
  id                      uuid primary key default gen_random_uuid(),
  project_request_id      uuid not null references project_requests(id) on delete cascade,
  freight_cost_request_id uuid references freight_cost_requests(id) on delete set null,
  old_containers          jsonb not null default '[]'::jsonb,
  new_containers          jsonb not null default '[]'::jsonb,
  old_total               numeric,
  new_total               numeric,
  old_valid_until         date,
  new_valid_until         date,
  note                    text,
  changed_by              uuid references auth.users(id) on delete set null,
  changed_at              timestamptz not null default now()
);
create index if not exists idx_freight_audit_project
  on freight_cost_audit(project_request_id, changed_at desc);

alter table freight_cost_audit enable row level security;

-- Read: owner-inclusive. Freight is NOT hidden from Sales (unlike factory cost),
-- so the project owner/creator can see their freight history, plus the broad
-- cost/ops roles.
drop policy if exists "freight_cost_audit read" on freight_cost_audit;
create policy "freight_cost_audit read" on freight_cost_audit for select using (
  exists (
    select 1 from project_requests pr
     where pr.id = project_request_id
       and (pr.owner_id = auth.uid() or pr.created_by = auth.uid())
  )
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin','task_list_manager','operations','finance','sales_director')
            or coalesce(r.super_admin, false))
  )
);

-- Insert: the app writes the audit when Operations updates freight — allow the
-- cost/ops roles. No UPDATE/DELETE policy → append-only.
drop policy if exists "freight_cost_audit insert" on freight_cost_audit;
create policy "freight_cost_audit insert" on freight_cost_audit for insert with check (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin','task_list_manager','operations','finance','sales_director')
            or coalesce(r.super_admin, false))
  )
);

notify pgrst, 'reload schema';

commit;
