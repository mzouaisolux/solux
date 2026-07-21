-- =====================================================================
-- m179 — Final Validation: immutable revisions + HARD FREEZE
--        (owner spec + hard-freeze decision, 2026-07-21).
-- =====================================================================
--
-- Final Validation (status `validated`) now FREEZES the task list:
--
--   1. task_list_revisions — the immutable record. On every validation a
--      complete snapshot (task row + lines + lighting setup + attachment
--      metadata, incl. every AI extraction result and manual correction)
--      is stored as Rev A, Rev B, …; the previous validated revision is
--      marked `superseded` but NEVER deleted. A controlled revision is
--      opened with a mandatory reason and lives as `in_progress` until
--      its own Final Validation completes the cycle.
--
--   2. production_task_lists.current_rev — the permanent version
--      identifier shown everywhere ("Rev B").
--
--   3. TRIGGERS enforce the freeze AT THE DATABASE: while a task list is
--      validated / production_ready, content columns cannot change (only
--      workflow columns may), its lines cannot be inserted / updated /
--      deleted, and the command's lighting setup is locked. "Validated
--      information must never be silently overwritten" is guaranteed even
--      against future code paths, not just today's server actions (which
--      also check first and give friendlier errors).
--
-- The app is DORMANT before this migration (snapshot/read paths are
-- defensive) — deploy code first, then apply. Pre-m179 validated lists
-- get a BASELINE Rev A snapshot the first time a controlled revision is
-- opened on them, so "previous validated stays accessible" holds for
-- legacy rows too.
--
-- Idempotent. Safe to re-run. Apply manually in the Supabase SQL editor.
-- =====================================================================

begin;

-- 1) The immutable revision record --------------------------------------
create table if not exists public.task_list_revisions (
  id           uuid primary key default gen_random_uuid(),
  task_list_id uuid not null references production_task_lists(id) on delete cascade,
  rev          text not null,
  status       text not null default 'in_progress'
                 check (status in ('in_progress','validated','superseded')),
  reason       text,
  snapshot     jsonb,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  validated_by uuid references auth.users(id) on delete set null,
  validated_at timestamptz,
  unique (task_list_id, rev)
);

create index if not exists idx_tl_revisions_list
  on public.task_list_revisions(task_list_id, created_at);

alter table public.task_list_revisions enable row level security;

drop policy if exists "tl revisions read" on public.task_list_revisions;
create policy "tl revisions read" on public.task_list_revisions
  for select to authenticated using (true);
-- Writes go through the server actions (capability task_list.validate);
-- RLS backstop: authenticated. Revisions rows are never UPDATEd except to
-- finalize/supersede — enforced by the server layer.
drop policy if exists "tl revisions write" on public.task_list_revisions;
create policy "tl revisions write" on public.task_list_revisions
  for all to authenticated using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- 2) Permanent version identifier on the task list ----------------------
alter table production_task_lists
  add column if not exists current_rev text;

-- 3) HARD FREEZE triggers ------------------------------------------------
-- 3a. The task list row: while frozen, only WORKFLOW columns may change.
create or replace function public.tl_freeze_guard() returns trigger
language plpgsql as $$
declare
  allowed text[] := array[
    'status','submitted_at','validated_at','validated_by',
    'current_rev','archived_at','archived_by','updated_at'
  ];
begin
  if old.status in ('validated','production_ready')
     and new.status = old.status
     and (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed)
  then
    raise exception
      'Final Validation freeze: this task list (Rev %) is immutable — open a controlled revision to modify it.',
      coalesce(old.current_rev, 'A');
  end if;
  return new;
end $$;

drop trigger if exists tl_freeze_guard on production_task_lists;
create trigger tl_freeze_guard
  before update on production_task_lists
  for each row execute function public.tl_freeze_guard();

-- 3b. Lines: no insert/update/delete while the parent is frozen.
create or replace function public.tl_lines_freeze_guard() returns trigger
language plpgsql as $$
declare
  parent_status text;
  parent_rev text;
  tl uuid;
begin
  tl := coalesce(new.task_list_id, old.task_list_id);
  select status, current_rev into parent_status, parent_rev
    from production_task_lists where id = tl;
  -- parent already gone (cascade of a hard delete) → let the cascade run.
  if parent_status is null then
    return coalesce(new, old);
  end if;
  if parent_status in ('validated','production_ready') then
    raise exception
      'Final Validation freeze: the task list (Rev %) is immutable — open a controlled revision to modify its lines.',
      coalesce(parent_rev, 'A');
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists tl_lines_freeze_guard on production_task_list_lines;
create trigger tl_lines_freeze_guard
  before insert or update or delete on production_task_list_lines
  for each row execute function public.tl_lines_freeze_guard();

-- 3c. Lighting setup: locked while ANY task list of the command is frozen
--     (the setup is part of the validated content — the dossier prints it).
create or replace function public.lighting_freeze_guard() returns trigger
language plpgsql as $$
declare
  doc uuid;
  frozen_number text;
begin
  doc := coalesce(new.document_id, old.document_id);
  select number into frozen_number
    from production_task_lists
   where quotation_id = doc
     and status in ('validated','production_ready')
   limit 1;
  if frozen_number is not null then
    raise exception
      'Final Validation freeze: task list % is validated — open a controlled revision before changing the lighting setup.',
      frozen_number;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists lighting_freeze_guard on product_lighting_setups;
create trigger lighting_freeze_guard
  before insert or update or delete on product_lighting_setups
  for each row execute function public.lighting_freeze_guard();

-- 4) Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('179_task_list_revisions_freeze.sql',
        'Final Validation hard freeze: task_list_revisions (immutable Rev A/B snapshots with reason/author/timestamps), production_task_lists.current_rev, and DB triggers making frozen task lists (validated/production_ready) immutable — content columns, lines and the lighting setup are locked; only workflow columns may change. Controlled revisions re-run the full Pre-Validation → Final Validation cycle.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select rev, status, reason, validated_at from task_list_revisions
--    order by created_at desc limit 5;
--   -- the freeze in action (expect an exception on a validated list):
--   -- update production_task_lists set production_notes='x' where id='…';
-- ---------------------------------------------------------------------
