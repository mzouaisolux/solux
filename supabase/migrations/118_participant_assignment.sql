-- =====================================================================
-- m118 — Two-level assignment: company-level owners inside a project
-- =====================================================================
--
-- Owner ruling (2026-06-13): "Assign Project" alone is too limiting.
-- Prospecting really works in two levels:
--   PROJECT OWNER     — tenders.owner_id (exists) — owns the project.
--   COMPANY ASSIGNMENT — each company inside the project can go to a
--   different salesperson (AFRIK LONNYA → Antoine, ANAYI → Marielle…).
--
-- tender_participants.owner_id carries that assignment BEFORE any
-- prospect exists. When the company is promoted to a prospect, the
-- prospect inherits: participant owner ?? project owner ?? promoter.
--
-- Idempotent. Safe to re-run. Apply manually in Supabase
-- (m117 must be applied first — the import refuses to run without it).
-- =====================================================================

begin;

alter table tender_participants
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

create index if not exists idx_tender_participants_owner
  on tender_participants (owner_id)
  where owner_id is not null;

insert into schema_migrations (filename, note)
values ('118_participant_assignment.sql', 'company-level assignment inside attribution projects')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ROLLBACK:
--   begin;
--   alter table tender_participants drop column if exists owner_id;
--   delete from schema_migrations where filename = '118_participant_assignment.sql';
--   notify pgrst, 'reload schema';
--   commit;
