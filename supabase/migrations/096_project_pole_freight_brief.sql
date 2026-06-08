-- =====================================================================
-- m096 — Project Request: pole requirement + freight brief.
--
--   • Poles are first-class: a project may or may not include poles. Capture
--     pole_required + pole configuration (quantity, arm length, notes) — pole
--     height already existed.
--   • Freight brief captured at creation when Sales requests a freight
--     estimate: transport mode, destination port/airport, notes.
--   • The Project Product snapshot (m095) gains pole_quantity + arm_length so
--     the generated quotation prices the pole line by its own quantity.
--
-- Additive + idempotent.
-- =====================================================================

begin;

-- Project request — pole requirement + config + freight brief.
alter table project_requests
  add column if not exists pole_required          boolean not null default true,
  add column if not exists pole_quantity          integer,
  add column if not exists arm_length             text,
  add column if not exists pole_notes             text,
  add column if not exists freight_transport_mode text,
  add column if not exists freight_destination    text,
  add column if not exists freight_notes          text;

-- Freight cost request — transport mode (pre-seeded from the brief at approval).
alter table freight_cost_requests
  add column if not exists transport_mode text;

-- Project product snapshot — pole quantity + arm length.
alter table project_products
  add column if not exists pole_quantity integer,
  add column if not exists arm_length    text;

notify pgrst, 'reload schema';

commit;
