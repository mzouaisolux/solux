-- =====================================================================
-- m178 — Pre-Validation action items (owner spec 2026-07-21).
-- =====================================================================
--
-- The task-list workflow keeps its existing states, but `under_validation`
-- is now the collaborative PRE-VALIDATION phase: the Task List Manager
-- iterates with the factory, engineering, the study lab, purchasing and
-- sales until every department agrees the file is complete. This table
-- structures that phase's PENDING ISSUES — who owes what, for which
-- department, by when:
--
--   task_list_action_items
--     task_list_id  → production_task_lists (cascade)
--     title/details — the item ("Waiting for pole calculation", …)
--     department    — METADATA, not a role (factory/study lab have no
--                     logins; the TLM is their proxy — owner decision)
--     assignee      — optional owner among EXISTING users
--     status        — open / in_progress / done / dismissed
--     blocking      — an OPEN blocking item prevents Final Validation
--                     (joins evaluateRelease beside missing mappings and
--                     the pole-drawing checkpoint)
--     due_date      — optional (unlike m103 planned_actions)
--     + full audit (created_by/at, resolved_by/at)
--
-- Distinct from m103 planned_actions on purpose: those are AFFAIR-level
-- sales actions with a mandatory date and sales vocabulary; these are
-- task-list-scoped production collaboration items with departments and a
-- release-gate role. Merging them would force both models to lie.
--
-- The app is DORMANT before this migration (reads fall back to an empty
-- board, writes surface "apply m178") — deploy code first, then apply.
--
-- Idempotent. Safe to re-run. Apply manually in the Supabase SQL editor.
-- =====================================================================

begin;

create table if not exists public.task_list_action_items (
  id           uuid primary key default gen_random_uuid(),
  task_list_id uuid not null references production_task_lists(id) on delete cascade,
  title        text not null,
  details      text,
  department   text not null default 'other'
                 check (department in ('task_list_manager','factory','engineering',
                                       'study_lab','purchasing','sales','logistics',
                                       'quality','other')),
  assignee     uuid references auth.users(id) on delete set null,
  status       text not null default 'open'
                 check (status in ('open','in_progress','done','dismissed')),
  blocking     boolean not null default false,
  due_date     date,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references auth.users(id) on delete set null
);

create index if not exists idx_tl_action_items_list
  on public.task_list_action_items(task_list_id, status);

alter table public.task_list_action_items enable row level security;

-- Same collaboration surface as the entity_messages conversations (m049):
-- everyone who can see the task list participates in Pre-Validation, so
-- read/write is authenticated — the server actions enforce the role/status
-- window (who may edit in which workflow state), RLS is the backstop.
drop policy if exists "tl action items read" on public.task_list_action_items;
create policy "tl action items read" on public.task_list_action_items
  for select to authenticated using (true);
drop policy if exists "tl action items write" on public.task_list_action_items;
create policy "tl action items write" on public.task_list_action_items
  for all to authenticated using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('178_task_list_action_items.sql',
        'Pre-Validation action items: task_list_action_items (title/details/department/assignee/status/blocking/due_date + audit). Open blocking items gate Final Validation via evaluateRelease. Departments are metadata, not roles (owner decision 2026-07-21). Status labels: under_validation renders as Pre-Validation, validated as Final Validation.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select column_name from information_schema.columns
--    where table_name = 'task_list_action_items' order by ordinal_position;
--   -- open blocking items per task list (what gates Final Validation)
--   select task_list_id, count(*) from task_list_action_items
--    where blocking and status in ('open','in_progress') group by 1;
-- ---------------------------------------------------------------------
