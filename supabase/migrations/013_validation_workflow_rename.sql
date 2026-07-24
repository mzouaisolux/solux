-- Validation workflow refactor.
--
-- Renames + simplifies task list statuses so sales never generates PDFs
-- directly. The final factory PDF is now a role-gated action (TLM + admin
-- only) available when status === 'production_ready'.
--
-- Final status set: draft, under_validation, needs_revision, validated,
-- production_ready, cancelled.
--
-- This migration handles ALL legacy status values, regardless of whether
-- the earlier migrations (009 / 012) were applied in this database. That
-- makes it safe to run on any environment without first running the
-- intermediates.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.

begin;

-- 1. Drop the OLD constraint FIRST. Critical ordering: if we update legacy
--    rows to the new values while an older CHECK is still active, the
--    UPDATE itself fails (e.g. setting status='draft' violates the original
--    migration 009 constraint which only allowed open/in_production/...).
alter table production_task_lists
  drop constraint if exists production_task_lists_status_check;

-- 2. Migrate every possible legacy value to the new 6-value enum.
update production_task_lists
set status = case
  -- Migration 009 era values (pre-workflow):
  when status = 'open'             then 'draft'
  when status = 'in_production'    then 'validated'
  when status = 'completed'        then 'production_ready'
  -- Migration 012 era values:
  when status = 'sales_submitted'  then 'under_validation'
  when status = 'technical_review' then 'validated'
  when status = 'sent_to_factory'  then 'production_ready'
  else status
end
where status not in (
  'draft',
  'under_validation',
  'needs_revision',
  'validated',
  'production_ready',
  'cancelled'
);

-- 3. NOW tighten the CHECK constraint to the new 6-value enum.
alter table production_task_lists
  add constraint production_task_lists_status_check
  check (status in (
    'draft',
    'under_validation',
    'needs_revision',
    'validated',
    'production_ready',
    'cancelled'
  ));

notify pgrst, 'reload schema';

commit;

