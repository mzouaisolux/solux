-- =====================================================================
-- m182 — FINAL VALIDATION FREEZE HARDENING
--
-- The QA campaign of 2026-07-22 proved the m179 freeze was bypassable four
-- ways. This migration closes the three that are DB-level.
--
-- The fourth (attachments) is handled separately by **m183** — apply it too.
-- It could not be done here because `attachments` is anchored to `affair_id`
-- only, with no task-list anchor; m183 solves it via the link that already
-- exists (the m179 revision snapshot names the attachments that were part of
-- a validated version) rather than by adding a column.
--
-- WHY A MIGRATION IS REQUIRED: the freeze must hold when the UI and the
-- server actions are bypassed (a direct PostgREST call with a legitimate
-- user JWT). Application code cannot provide that guarantee — only the
-- database can. App-level asserts are added in the same change as a
-- friendlier first line of defence, never as the guarantee.
--
-- Idempotent. Safe to re-run. Reads and modifies no data.
-- =====================================================================

-- ---------------------------------------------------------------------
-- BYPASS #2 — "change the status in the same UPDATE and the freeze
-- evaporates."
--
-- Root cause: the guard short-circuited on `new.status = old.status`. That
-- clause was both REDUNDANT and HARMFUL — `status` is already in the
-- `allowed` whitelist, so the jsonb diff below already tolerates a pure
-- status transition. Its only effect was that ANY update which also touched
-- `status` skipped the content check entirely.
--
-- Proven 2026-07-22: `set status='under_validation', production_notes='…',
-- solar_panel_tilt_angle=99` on a validated Rev B task list succeeded and
-- really wrote the tilt.
--
-- Backward compatibility verified before removal: every transition out of a
-- frozen state goes through `transition()` in
-- app/(app)/task-lists/[id]/actions.ts, which patches only status /
-- submitted_at / validated_at / validated_by; `openRevisionRecord` patches
-- only current_rev; `setTaskListStatus` patches only status. All of those
-- are in `allowed`, so every legitimate flow still passes.
--
-- BYPASS #1 — a frozen task list could be DELETED outright: the guard was
-- attached to UPDATE only, while task_list_revisions, lines, action items
-- and production orders are all ON DELETE CASCADE. One delete destroyed the
-- very audit trail the freeze exists to protect — and the UI rendered a
-- Delete button for TLM/admin on validated lists.
-- ---------------------------------------------------------------------
create or replace function public.tl_freeze_guard()
returns trigger
language plpgsql
as $function$
declare
  allowed text[] := array[
    'status','submitted_at','validated_at','validated_by',
    'current_rev','archived_at','archived_by','updated_at'
  ];
begin
  if tg_op = 'DELETE' then
    -- Scope: the PostgREST end-user roles. That is exactly the bypass being
    -- closed (the app never uses a service-role client — every write goes
    -- through PostgREST as `authenticated`).
    --
    -- Deliberately NOT enforced for other callers: the audited super-admin
    -- Force Delete (m169) removes task lists EXPLICITLY (not by cascade)
    -- and runs SECURITY DEFINER as the function owner, so blocking it here
    -- would break a documented, double-confirmed, logged admin feature.
    if current_user in ('authenticated', 'anon')
       and old.status in ('validated','production_ready')
    then
      raise exception
        'Final Validation freeze: task list % (Rev %) is validated and cannot be deleted — archive it, or open a controlled revision first.',
        coalesce(old.number, old.id::text), coalesce(old.current_rev, 'A');
    end if;
    return old;
  end if;

  -- UPDATE: enforcement scope is unchanged (every caller, as before m182);
  -- only the bypass clause is gone, so this is strictly stronger than m179.
  if old.status in ('validated','production_ready')
     and (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed)
  then
    raise exception
      'Final Validation freeze: this task list (Rev %) is immutable — open a controlled revision to modify it.',
      coalesce(old.current_rev, 'A');
  end if;
  return new;
end $function$;

drop trigger if exists tl_freeze_delete_guard on public.production_task_lists;
create trigger tl_freeze_delete_guard
  before delete on public.production_task_lists
  for each row execute function public.tl_freeze_guard();

-- ---------------------------------------------------------------------
-- BYPASS #3 — revision snapshots were not immutable.
--
-- `task_list_revisions` has RLS `for all to authenticated`, no freeze
-- trigger, and holds the snapshots the entire m179 design rests on. Any
-- authenticated user could rewrite or delete Rev A through PostgREST.
--
-- RLS is deliberately left untouched — tightening it risks breaking reads
-- and the app's own writes. A column-scoped trigger gives exact
-- immutability while preserving every legitimate write:
--   * recordValidationRevision updates the row while it is `in_progress`
--     (snapshot + status + validated_at/by)      → still allowed
--   * supersede moves `validated` → `superseded` (status only) → allowed
--   * anything else on a finalised row                        → rejected
-- ---------------------------------------------------------------------
create or replace function public.tl_revision_freeze_guard()
returns trigger
language plpgsql
as $function$
declare
  allowed text[] := array['status','validated_at','validated_by'];
begin
  if tg_op = 'DELETE' then
    -- Parent already gone → this is the cascade of a permitted task-list
    -- delete (including the m169 Force Delete). Let it run. Mirrors
    -- tl_lines_freeze_guard.
    if not exists (
      select 1 from public.production_task_lists where id = old.task_list_id
    ) then
      return old;
    end if;
    if old.status in ('validated','superseded') then
      raise exception
        'Revision history is immutable: Rev % is % and cannot be deleted.',
        old.rev, old.status;
    end if;
    return old;
  end if;

  if old.status in ('validated','superseded') then
    -- A finalised revision may only be superseded. Blocking every other
    -- status move also closes the two-step bypass (flip back to
    -- in_progress, then rewrite the snapshot).
    if new.status is distinct from old.status
       and not (old.status = 'validated' and new.status = 'superseded')
    then
      raise exception
        'Revision history is immutable: Rev % is % — its status is final.',
        old.rev, old.status;
    end if;
    if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
      raise exception
        'Revision history is immutable: Rev % (%) cannot be modified.',
        old.rev, old.status;
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists tl_revision_freeze_guard on public.task_list_revisions;
create trigger tl_revision_freeze_guard
  before update or delete on public.task_list_revisions
  for each row execute function public.tl_revision_freeze_guard();
