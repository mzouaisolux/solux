-- Factory mapping system.
--
-- The mapping layer that translates a sales-facing dropdown selection
-- (e.g. "Battery: 18H") into a detailed factory instruction
-- (e.g. "Use LiFePO4 battery pack 12.8V 30Ah, 384Wh, cell type 32700, BMS
-- reference XXX, minimum tested capacity XXX Wh.").
--
-- One mapping per dropdown option (1:1 via UNIQUE constraint on option_id).
-- `field_id` is denormalized for fast grouping in the admin UI.
--
-- Per-line overrides live on production_task_list_lines.factory_overrides
-- so the task list manager can adjust the auto-resolved text on a single
-- line without changing the global mapping.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.

begin;

-- ---------- 1. factory_mappings ----------
create table if not exists factory_mappings (
  id uuid primary key default gen_random_uuid(),
  -- Denormalized for cheap grouping. on delete cascade matches the option fk.
  field_id uuid not null references config_fields(id) on delete cascade,
  -- One mapping per dropdown option. The UNIQUE constraint guarantees a
  -- given option only ever has one canonical factory instruction.
  option_id uuid not null unique references config_field_options(id) on delete cascade,
  factory_instruction text not null,
  -- Short factory reference, e.g. "LFP-30Ah-A". Optional.
  factory_code text,
  notes text,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_factory_mappings_field
  on factory_mappings (field_id);

alter table factory_mappings enable row level security;

drop policy if exists "read factory mappings" on factory_mappings;
create policy "read factory mappings" on factory_mappings for select
  using (auth.role() = 'authenticated');

drop policy if exists "write factory mappings" on factory_mappings;
create policy "write factory mappings" on factory_mappings for all
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

-- ---------- 2. Per-line overrides ----------
-- Stored as JSONB keyed by sales field_name → custom factory instruction.
-- Empty by default → resolver falls back to the global factory_mappings entry.
alter table production_task_list_lines
  add column if not exists factory_overrides jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';

commit;
