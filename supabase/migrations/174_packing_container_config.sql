-- =====================================================================
-- m174 — PACKING: container capacity config (versioned + audited) +
--        calculation-time snapshot for historical immutability.
-- =====================================================================
--
-- Owner request (2026-07-15): usable CBM must be editable, versioned and
-- audited per container type; changing it must NOT alter historical completed
-- packing calculations. Adds:
--   • extra editable fields on packing_container_type
--   • packing_container_type_change (field-level audit: old/new/user/date/reason/effective)
--   • packing_calculation.container_config_used (jsonb snapshot at creation)
--   • seeded door dimensions (enables the engine's door-fit check)
--
-- ISOLATED · SUPER-ADMIN only · LOCAL Supabase only · idempotent.
-- =====================================================================

begin;

-- 1) Extra config fields ------------------------------------------------
alter table public.packing_container_type
  add column if not exists min_unused_reserve_cbm numeric not null default 0
    check (min_unused_reserve_cbm >= 0),
  add column if not exists applicable_families text[] not null default '{}',
  add column if not exists effective_date date not null default current_date,
  add column if not exists validation_status text not null default 'draft'
    check (validation_status in ('draft','needs_validation','validated','deprecated'));

-- 2) Field-level audit of container config changes ---------------------
create table if not exists public.packing_container_type_change (
  id             uuid primary key default gen_random_uuid(),
  container_id   uuid references public.packing_container_type(id) on delete cascade,
  code           text,
  field          text not null,
  old_value      text,
  new_value      text,
  changed_by     uuid,
  changed_at     timestamptz not null default now(),
  reason         text,
  effective_date date
);
create index if not exists packing_container_type_change_idx
  on public.packing_container_type_change (container_id, changed_at desc);

alter table public.packing_container_type_change enable row level security;
drop policy if exists packing_container_type_change_superadmin_all on public.packing_container_type_change;
create policy packing_container_type_change_superadmin_all
  on public.packing_container_type_change for all to authenticated
  using (public.packing_is_admin()) with check (public.packing_is_admin());

-- 3) Snapshot the container config a calculation was built with --------
--    So editing usable CBM later never changes a historical calculation.
alter table public.packing_calculation
  add column if not exists container_config_used jsonb not null default '[]'::jsonb;

-- 4) Seed door dimensions (standard openings) — enables door-fit check --
update public.packing_container_type set door_w_mm = 2340, door_h_mm = 2280
  where code = '20GP' and door_w_mm is null;
update public.packing_container_type set door_w_mm = 2340, door_h_mm = 2280
  where code = '40GP' and door_w_mm is null;
update public.packing_container_type set door_w_mm = 2340, door_h_mm = 2585
  where code = '40HQ' and door_w_mm is null;

-- Mark the validated containers as such (40GP stays draft — rules unknown).
update public.packing_container_type set validation_status = 'validated'
  where code in ('20GP','40HQ','LCL') and validation_status = 'draft';

insert into schema_migrations (filename, note)
values ('174_packing_container_config.sql',
        'Packing container config: min_unused_reserve_cbm, applicable_families, effective_date, validation_status; packing_container_type_change audit; packing_calculation.container_config_used snapshot (historical immutability); seeded door dims (20GP/40GP 2340x2280, 40HQ 2340x2585).')
on conflict (filename) do nothing;

commit;

notify pgrst, 'reload schema';
