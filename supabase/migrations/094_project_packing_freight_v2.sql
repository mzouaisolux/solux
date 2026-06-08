-- =====================================================================
-- m094 — Project Requests: richer packing list + freight + packing files.
--
--   P3  packing list now supports MULTIPLE container rows → `containers`
--       jsonb array of {type, quantity}. Legacy single num_containers/
--       container_type kept (unused) for back-compat.
--   P5  freight gains Incoterm + Port of Destination.
--   P4  project_request_files gains a 'packing' category so Operations can
--       attach a Packing List PDF/Excel on the packing card.
--
-- Additive + idempotent.
-- =====================================================================

begin;

-- P3 — multi-container packing list.
alter table packing_list_requests
  add column if not exists containers jsonb not null default '[]'::jsonb;

-- P5 — freight incoterm + destination port.
alter table freight_cost_requests
  add column if not exists incoterm text,
  add column if not exists port_of_destination text;

-- P4 — 'packing' file category (drop & re-add the check to extend the enum).
alter table project_request_files drop constraint if exists project_request_files_category_check;
alter table project_request_files
  add constraint project_request_files_category_check
  check (category in ('tender','spec','drawing','image','requirement','packing','other'));

notify pgrst, 'reload schema';

commit;
