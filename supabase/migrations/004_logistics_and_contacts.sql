-- Logistics + client contact upgrade.
-- Run in Supabase SQL Editor. Idempotent.

begin;

-- ---------- 1. CLIENT CONTACT FIELDS ----------
-- We already have contact_name; keep it and add phone_number.
-- Some specs call this "contact_person" — we treat the two as synonyms
-- and use contact_name as the canonical column (backward-compatible).
alter table clients
  add column if not exists phone_number text;

-- ---------- 2. DOCUMENT SHIPPING PORTS ----------
alter table documents
  add column if not exists port_of_loading text;

alter table documents
  add column if not exists port_of_destination text;

-- ---------- 3. CONTAINERS (multi-row per document) ----------
create table if not exists document_containers (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  container_type text not null check (container_type in ('20ft','40ft','40ft HC')),
  quantity integer not null default 1 check (quantity >= 0),
  unit_price numeric not null default 0 check (unit_price >= 0),
  position integer not null default 0
);

create index if not exists idx_containers_document
  on document_containers(document_id);

alter table document_containers enable row level security;

drop policy if exists "containers rw" on document_containers;
create policy "containers rw" on document_containers for all
  using (
    exists(select 1 from documents d where d.id = document_id and (
      d.created_by = auth.uid()
      or exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin')
    ))
  )
  with check (
    exists(select 1 from documents d where d.id = document_id and d.created_by = auth.uid())
  );

-- Legacy freight_type / freight_cost columns on documents remain for
-- backward compat. New documents populate containers; old documents still
-- render via their freight_* fields.

-- ---------- 4. PRODUCTION TIME ----------
-- A single column with one of three modes:
--   'working_days'  -> production_days (int), e.g. "25 working days"
--   'calendar_days' -> production_days (int), e.g. "30 calendar days"
--   'fixed_date'    -> production_date (date), e.g. "2026-06-15"
alter table documents
  add column if not exists production_mode text
    check (production_mode in ('working_days','calendar_days','fixed_date'));

alter table documents
  add column if not exists production_days integer;

alter table documents
  add column if not exists production_date date;

notify pgrst, 'reload schema';

commit;
