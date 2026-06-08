-- Track who validated a production task list + when.
-- These two columns power the "Reviewed by" line on the factory exports
-- (PDF + Excel) and give an audit trail for who released a task list to
-- production-ready.
--
-- Run in Supabase SQL Editor. Idempotent.

begin;

alter table production_task_lists
  add column if not exists validated_by uuid references auth.users(id);

alter table production_task_lists
  add column if not exists validated_at timestamptz;

notify pgrst, 'reload schema';

commit;
