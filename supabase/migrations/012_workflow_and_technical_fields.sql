-- Multi-step production task list workflow + task_list_manager role + a
-- proper sales/technical split for configuration fields, plus a global
-- commercial→internal component mapping table.
--
-- The workflow goes:
--   draft → sales_submitted → technical_review → production_ready → sent_to_factory
-- (or → cancelled at any point).
--
-- Existing task lists migrate cleanly:
--   open           → draft
--   in_production  → technical_review
--   completed      → sent_to_factory
--   cancelled      → cancelled (unchanged)
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.

begin;

-- ---------- 1. Drop old CHECK before updating ----------
-- Critical ordering: writing the new values while the old CHECK is still
-- active causes the UPDATE itself to fail (e.g. status='draft' violates
-- the original constraint that only allowed open/in_production/...).
alter table production_task_lists
  drop constraint if exists production_task_lists_status_check;

-- ---------- 2. Migrate existing task list status values ----------
update production_task_lists
set status = case
  when status = 'open' then 'draft'
  when status = 'in_production' then 'technical_review'
  when status = 'completed' then 'sent_to_factory'
  else status
end
where status in ('open', 'in_production', 'completed');

-- ---------- 3. Add the new CHECK constraint ----------
alter table production_task_lists
  add constraint production_task_lists_status_check
  check (status in (
    'draft',
    'sales_submitted',
    'technical_review',
    'production_ready',
    'sent_to_factory',
    'cancelled'
  ));

-- ---------- 3. Workflow tracking columns ----------
alter table production_task_lists
  add column if not exists technical_notes text;
alter table production_task_lists
  add column if not exists submitted_at timestamptz;
alter table production_task_lists
  add column if not exists factory_sent_at timestamptz;

-- ---------- 4. Sales / technical scope on config fields ----------
-- Existing fields default to 'sales' (preserves prior behavior). New
-- technical fields are flagged 'technical' and are only editable by
-- task_list_manager + admin.
alter table config_fields
  add column if not exists field_scope text not null default 'sales';
alter table config_fields
  drop constraint if exists config_fields_field_scope_check;
alter table config_fields
  add constraint config_fields_field_scope_check
  check (field_scope in ('sales', 'technical'));

-- ---------- 5. Technical values JSONB on each task list line ----------
-- Stored separately from `config_values` so sales config and technical
-- enrichment stay independently versionable + auditable.
alter table production_task_list_lines
  add column if not exists technical_values jsonb not null default '{}'::jsonb;

-- ---------- 6. Component mappings (commercial → internal references) ----------
create table if not exists component_mappings (
  id uuid primary key default gen_random_uuid(),
  commercial_name text not null,
  internal_reference text not null,
  -- Optional grouping ("battery", "solar panel", "controller", ...)
  category text,
  notes text,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- Case-insensitive uniqueness on commercial_name so sales references map
-- 1:1 to an internal reference.
create unique index if not exists idx_component_mappings_commercial_unique
  on component_mappings (lower(commercial_name));

create index if not exists idx_component_mappings_category
  on component_mappings (category, lower(commercial_name));

alter table component_mappings enable row level security;
drop policy if exists "read component mappings" on component_mappings;
create policy "read component mappings" on component_mappings for select
  using (auth.role() = 'authenticated');
drop policy if exists "write component mappings" on component_mappings;
create policy "write component mappings" on component_mappings for all
  using (
    exists(
      select 1 from user_roles r
      where r.user_id = auth.uid()
        and r.role in ('admin', 'task_list_manager')
    )
  )
  with check (
    exists(
      select 1 from user_roles r
      where r.user_id = auth.uid()
        and r.role in ('admin', 'task_list_manager')
    )
  );

-- ---------- 7. Loosen task-list write policy to include TLM ----------
-- Previously task list lines were rw by the doc creator OR admin. Now
-- task_list_manager also needs to edit them to add technical references.
drop policy if exists "task lines rw" on production_task_list_lines;
create policy "task lines rw" on production_task_list_lines for all
  using (
    exists(
      select 1
      from production_task_lists t
      join documents d on d.id = t.quotation_id
      where t.id = task_list_id and (
        d.created_by = auth.uid()
        or exists(
          select 1 from user_roles r
          where r.user_id = auth.uid()
            and r.role in ('admin', 'task_list_manager')
        )
      )
    )
  )
  with check (
    exists(
      select 1
      from production_task_lists t
      join documents d on d.id = t.quotation_id
      where t.id = task_list_id and (
        d.created_by = auth.uid()
        or exists(
          select 1 from user_roles r
          where r.user_id = auth.uid()
            and r.role in ('admin', 'task_list_manager')
        )
      )
    )
  );

-- Same for the parent task list rows (status transitions, technical_notes).
drop policy if exists "tasks select" on production_task_lists;
create policy "tasks select" on production_task_lists for select using (
  exists(
    select 1 from documents d
    where d.id = quotation_id and (
      d.created_by = auth.uid()
      or exists(
        select 1 from user_roles r
        where r.user_id = auth.uid()
          and r.role in ('admin', 'task_list_manager')
      )
    )
  )
);
drop policy if exists "tasks update" on production_task_lists;
create policy "tasks update" on production_task_lists for update using (
  exists(
    select 1 from documents d
    where d.id = quotation_id and (
      d.created_by = auth.uid()
      or exists(
        select 1 from user_roles r
        where r.user_id = auth.uid()
          and r.role in ('admin', 'task_list_manager')
      )
    )
  )
);
drop policy if exists "tasks delete" on production_task_lists;
create policy "tasks delete" on production_task_lists for delete using (
  exists(
    select 1 from documents d
    where d.id = quotation_id and (
      d.created_by = auth.uid()
      or exists(
        select 1 from user_roles r
        where r.user_id = auth.uid()
          and r.role = 'admin'
      )
    )
  )
);

notify pgrst, 'reload schema';

commit;
