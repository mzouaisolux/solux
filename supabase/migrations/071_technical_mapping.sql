-- =====================================================================
-- m071 — Client technical preset (factory-side operational memory).
-- =====================================================================
--
-- Adds the CLIENT layer to the EXISTING factory-mapping flow (m014). It does
-- NOT introduce a parallel mapping system and never touches the sales config:
--
--     Sales config (document_lines)              ← owned by sales
--       → global factory_mappings (automatic)    ← admin/TLM, m014
--         → CLIENT preset (this table)           ← reusable per client+product
--           → order override (line.factory_overrides) ← one task-list line
--
-- A preset is a plain `{ "<sales field_name>": "<factory instruction>" }`
-- jsonb map, keyed by the SAME field_name the global mapping uses.
-- resolveFactoryInstruction() (lib/types.ts) reads it as the "client_preset"
-- layer, between the global mapping and the per-line order override.
--
-- "Save as client preset" (TaskLineEditor) folds the current line's resolved
-- factory instructions into this row, so the next order for the same client +
-- product auto-loads them. No per-client columns, no hardcoded exceptions — a
-- non-standard customer is a ROW, not code.
--
-- ADDITIONAL FACTORY ATTRIBUTES (extras)
-- --------------------------------------
-- Many factory concepts are NOT part of the sales config (controller,
-- connector type, cable / wiring / driver references, mounting hardware,
-- packaging refs, internal production refs, inspection requirements, factory
-- notes, …). Those live as a free-standing, self-describing attribute LIST
-- (`[{ key, label, value }]`) so new factory concepts need no migration:
--
--   - client_technical_presets.extras (jsonb array)         — reusable per client+product
--   - production_task_list_lines.factory_extras (jsonb array) — this order's overrides/additions
--
-- resolveFactoryExtras() (lib/factory-extras.ts) merges them per key
-- (client preset > order override; empty order value = tombstone/remove).
--
-- Visibility: the factory section is gated to technical roles in the app +
-- writes go through role-checked server actions (saveClientFactoryPreset,
-- updateTaskListLineFactoryExtras). RLS here is authenticated read/write
-- (same pattern as action_acks); these are operational specs, not secrets.
--
-- Idempotent.
-- =====================================================================

create table if not exists client_technical_presets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  -- { "<sales field_name>": "<factory instruction text>" }
  mapping jsonb not null default '{}'::jsonb,
  -- [ { "key": "...", "label": "...", "value": "..." } ] — factory-only fields
  extras jsonb not null default '[]'::jsonb,
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, product_id)
);

-- Older deployments may have the table without the `extras` column.
alter table client_technical_presets
  add column if not exists extras jsonb not null default '[]'::jsonb;

-- Order layer for the additional factory attributes (one per task-list line).
alter table production_task_list_lines
  add column if not exists factory_extras jsonb not null default '[]'::jsonb;

create index if not exists client_technical_presets_lookup_idx
  on client_technical_presets (client_id, product_id);

alter table client_technical_presets enable row level security;

drop policy if exists ctp_read on client_technical_presets;
create policy ctp_read on client_technical_presets
  for select to authenticated using (true);

drop policy if exists ctp_insert on client_technical_presets;
create policy ctp_insert on client_technical_presets
  for insert to authenticated with check (true);

drop policy if exists ctp_update on client_technical_presets;
create policy ctp_update on client_technical_presets
  for update to authenticated using (true) with check (true);

drop policy if exists ctp_delete on client_technical_presets;
create policy ctp_delete on client_technical_presets
  for delete to authenticated using (true);

notify pgrst, 'reload schema';
