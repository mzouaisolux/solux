-- 063_fix_container_type_check.sql
--
-- Fix: "new row for relation \"document_containers\" violates check
-- constraint \"document_containers_container_type_check\"" when saving a
-- quotation with an LCL / Groupage freight row.
--
-- Root cause: migration 004 created the constraint as
--   check (container_type in ('20ft','40ft','40ft HC'))
-- Migration 007 was meant to widen it to include 'LCL', but on some
-- environments 007 wasn't applied (or the constraint was recreated by a
-- later restore), so 'LCL' is still rejected. The app's ContainerType is
-- ('LCL','20ft','40ft','40ft HC') and the builder actively offers LCL.
--
-- This migration is idempotent: it drops whatever the current constraint
-- is and recreates it with the full, correct allowed set.

do $$
begin
  if exists (
    select 1
      from information_schema.tables
     where table_schema = 'public'
       and table_name = 'document_containers'
  ) then
    -- Drop the existing check (auto-named) if present.
    alter table public.document_containers
      drop constraint if exists document_containers_container_type_check;

    -- Recreate with the complete allowed set the app uses.
    alter table public.document_containers
      add constraint document_containers_container_type_check
      check (container_type in ('LCL', '20ft', '40ft', '40ft HC'));
  end if;
end $$;

-- Refresh PostgREST's schema cache so the change is picked up immediately.
notify pgrst, 'reload schema';
