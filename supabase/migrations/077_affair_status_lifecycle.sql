-- =====================================================================
-- m077 — Affair status: independent business lifecycle.
-- =====================================================================
--
-- Owner decision (2026-06-01): an affair/project has its OWN lifecycle,
-- INDEPENDENT of document status (it must NOT auto-derive from documents):
--
--   lead → opportunity → quotation → negotiation → won →
--   in_production → shipped → completed   (and lost / abandoned)
--
-- ("archived" is NOT a status — archiving is the separate `archived_at` +
-- `archive_reason` flag from m076, orthogonal to the lifecycle.)
--
-- m076 created `affairs.status` with a placeholder CHECK
-- (open/won/lost/abandoned/archived) and backfilled 'open' / 'won'. This
-- migration:
--   1. drops the placeholder CHECK,
--   2. remaps the ONE-TIME placeholder value 'open' to a sensible initial
--      lifecycle status (derived from the affair's documents — a one-time
--      seed only; status is NOT kept in sync afterwards),
--   3. sets the default for future (app-created) affairs to 'lead'
--      ("create the project first, before any quotation"),
--   4. installs the new lifecycle CHECK.
--
-- Idempotent & safe to re-run: the remap only touches rows still at the
-- old 'open' placeholder, so it never clobbers a manually-set status.
--
-- Additive: no app code, no other table, no RLS change. Apply manually
-- in Supabase after a backup.
-- =====================================================================

begin;

-- 1) Drop ANY existing CHECK constraint on affairs.status (name-agnostic).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'affairs'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table affairs drop constraint %I', c.conname);
  end loop;
end $$;

-- 2) One-time seed: remap the placeholder 'open' to a real lifecycle value.
--    'won' rows from m076 stay 'won' (a valid lifecycle status); users
--    advance won → in_production → shipped → completed manually thereafter.
update affairs a
   set status = case
     when not exists (select 1 from documents d where d.affair_id = a.id)
       then 'opportunity'
     when not exists (
       select 1 from documents d
        where d.affair_id = a.id and d.status not in ('lost', 'cancelled')
     ) then 'lost'
     when exists (
       select 1 from documents d
        where d.affair_id = a.id and d.status in ('sent', 'negotiating')
     ) then 'negotiation'
     else 'quotation'
   end
 where a.status = 'open';

-- Defensive: anything still outside the new vocabulary (e.g. a stray
-- 'archived' placeholder) becomes 'abandoned' so the new CHECK can apply.
update affairs
   set status = 'abandoned'
 where status not in (
   'lead','opportunity','quotation','negotiation','won',
   'in_production','shipped','completed','lost','abandoned'
 );

-- 3) New default for future affairs (created before any quotation).
alter table affairs alter column status set default 'lead';

-- 4) Install the independent lifecycle CHECK.
alter table affairs
  add constraint affairs_status_check check (status in (
    'lead','opportunity','quotation','negotiation','won',
    'in_production','shipped','completed','lost','abandoned'
  ));

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- POST-CHECK (run AFTER applying):
--   select status, count(*) from affairs group by status order by 2 desc;
--   -- expect only lifecycle values; no 'open' remaining.
--
-- ROLLBACK (revert to the m076 placeholder vocabulary):
--   alter table affairs drop constraint if exists affairs_status_check;
--   update affairs set status = 'open'
--    where status not in ('won','lost','abandoned');
--   alter table affairs alter column status set default 'open';
--   alter table affairs add constraint affairs_status_check
--     check (status in ('open','won','lost','abandoned','archived'));
--   notify pgrst, 'reload schema';
-- =====================================================================
