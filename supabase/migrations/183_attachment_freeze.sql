-- =====================================================================
-- m183 — FINAL VALIDATION FREEZE: attachments
--
-- Closes the fourth bypass found by the QA campaign of 2026-07-22, which
-- m182 deliberately left open. Verified before writing this: `attachments`
-- carries 0 triggers and `_actions/attachments.ts` has no freeze check, so
-- a document belonging to a Final-Validated task list could be deleted or
-- have its file swapped at will.
--
-- WHY IT COULD NOT BE DONE THE OBVIOUS WAY
-- `attachments` is anchored to `affair_id` ONLY — there is no task-list
-- anchor. "Freeze the attachments of a frozen task list" is therefore not
-- directly expressible. Freezing by affair instead would lock the entire
-- affair document workspace (other quotations, other task lists, customer
-- correspondence, certifications) the moment ONE task list is validated.
-- Measured on real data: affairs mix `customer`, `technical`,
-- `certifications` and `energy_studies` folders — that would be a
-- functional regression, not a fix. Adding a task_list_id column would be
-- a schema/architecture change.
--
-- WHAT THIS DOES INSTEAD — the narrowest defensible definition, using a
-- link that ALREADY EXISTS: the m179 revision snapshot records exactly
-- which attachments (id, file_name, storage_path) were part of a validated
-- version. An attachment is frozen if, and only if, a FINALISED revision
-- snapshot names it. Consequences:
--   * documents uploaded AFTER the validation           → untouched
--   * documents of affairs with no validated task list  → untouched
--   * folder / note / visibility / doc_status edits     → still allowed,
--     so the m164 drag-and-drop categorisation keeps working
--   * "Replace" already INSERTs a new row (group_id + version, m151),
--     keeping the old one → still works, and the validated file remains
--     retrievable, which is the whole point
--   * deleting a snapshotted document, or swapping its file in place
--                                                       → refused
--
-- WHY A MIGRATION IS REQUIRED: same reason as m182 — the guarantee must
-- survive the UI and the server actions being bypassed (direct PostgREST
-- call with a legitimate user JWT). Only the database can provide that.
--
-- Idempotent. Safe to re-run. Reads and modifies no data.
-- Apply manually in the Supabase SQL editor, AFTER m178 + m179 + m182.
-- =====================================================================

begin;

create or replace function public.attachment_freeze_guard()
returns trigger
language plpgsql
as $function$
declare
  frozen record;
begin
  -- Cheap exit: no finalised revisions at all → nothing can be frozen.
  -- Also covers every database where m179 has not been applied yet.
  if not exists (
    select 1 from public.task_list_revisions
     where status in ('validated','superseded')
  ) then
    return coalesce(new, old);
  end if;

  select r.rev as rev, tl.number as number
    into frozen
    from public.task_list_revisions r
    join public.production_task_lists tl on tl.id = r.task_list_id
   where r.status in ('validated','superseded')
     and r.snapshot -> 'attachments' @> jsonb_build_array(
           jsonb_build_object('id', old.id)
         )
   limit 1;

  if frozen is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    -- Scoped to the PostgREST end-user roles, exactly like m182's delete
    -- guard: the audited super-admin Force Delete (m169) runs SECURITY
    -- DEFINER as the function owner and must keep working.
    if current_user in ('authenticated', 'anon') then
      raise exception
        'Final Validation freeze: this document is part of validated task list % (Rev %) and cannot be deleted — upload a new version instead.',
        frozen.number, frozen.rev;
    end if;
    return old;
  end if;

  -- UPDATE: only the file IDENTITY is frozen. Organisational metadata
  -- (folder, note, attachment_type, visibility flags, doc_status) stays
  -- editable so the document workspace keeps working normally.
  if new.storage_path is distinct from old.storage_path
     or new.file_name is distinct from old.file_name
     or new.affair_id is distinct from old.affair_id
  then
    raise exception
      'Final Validation freeze: this document is part of validated task list % (Rev %) — its file cannot be replaced in place. Upload a new version instead.',
      frozen.number, frozen.rev;
  end if;

  return new;
end $function$;

drop trigger if exists attachment_freeze_guard on public.attachments;
create trigger attachment_freeze_guard
  before update or delete on public.attachments
  for each row execute function public.attachment_freeze_guard();

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('183_attachment_freeze.sql',
        'Final Validation freeze: attachments (QA campaign 2026-07-22, fourth bypass). attachments is anchored to affair_id only, so freezing "the task list documents" uses the link that already exists — an attachment is frozen iff a finalised m179 revision snapshot names its id. Deleting it or swapping its file in place is refused; folder/note/visibility/doc_status stay editable (m164 DnD) and Replace keeps inserting a new version row (m151). Delete branch scoped to the PostgREST roles so the m169 Force Delete keeps working.')
on conflict (filename) do nothing;

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select trigger_name, event_manipulation from information_schema.triggers
--    where event_object_table = 'attachments';
--   -- expect attachment_freeze_guard on UPDATE and on DELETE
-- ---------------------------------------------------------------------
