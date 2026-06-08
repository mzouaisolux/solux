-- =====================================================================
-- m097 — Freight cost is generated from the Packing List.
--
-- Freight is now a PER-CONTAINER-TYPE breakdown derived from the packing
-- list (the single source of truth for container types/quantities). The
-- `containers` jsonb holds [{type, quantity, freight_per_unit}]; the overall
-- estimated_total_freight is the sum of quantity × freight_per_unit. Users
-- never re-enter container types in Freight — they only fill the per-unit
-- freight rate per row.
--
-- The legacy scalar `freight_cost_per_container` stays (unused going forward).
-- Additive + idempotent.
-- =====================================================================

begin;

alter table freight_cost_requests
  add column if not exists containers jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';

commit;
