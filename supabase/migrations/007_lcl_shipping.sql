-- LCL / Groupage shipping support + optional wooden-box packaging.
-- Run in Supabase SQL Editor. Idempotent.

begin;

-- 1. Allow LCL in the container_type set. (40ft was already allowed.)
alter table document_containers
  drop constraint if exists document_containers_container_type_check;

alter table document_containers
  add constraint document_containers_container_type_check
    check (container_type in ('LCL', '20ft', '40ft', '40ft HC'));

-- 2. Optional wooden box packaging cost — only meaningful for LCL rows but
--    we keep it as a flat column for simplicity. Always defaults to 0.
alter table document_containers
  add column if not exists wooden_box_cost numeric not null default 0
    check (wooden_box_cost >= 0);

notify pgrst, 'reload schema';

commit;
