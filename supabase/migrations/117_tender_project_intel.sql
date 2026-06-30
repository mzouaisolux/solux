-- =====================================================================
-- m117 — Tender → Prospect workflow v3: PROJECTS first, contacts kept
-- =====================================================================
--
-- Owner decision (2026-06-13): the attribution UI was company-centric —
-- wrong business object. A salesperson thinks PROJECT first (country,
-- amount, buyer, winner, participants), then decides which companies to
-- pursue. Two consequences for the data model:
--
--   1. The attribution JSON carries CONTACT intel per company (email,
--      phone, address, manager, participation history) that was being
--      thrown away. tender_participants now stores it — it is the raw
--      material of the deal-discovery engine, captured at import time
--      and copied onto the prospect when (and only when) a salesperson
--      decides to create one.
--
--   2. Import NO LONGER auto-creates Prospect Companies (supersedes the
--      V2 rule). Creation is explicit: winner / participant / all —
--      the salesperson decides. Project-level assignment uses the
--      existing tenders.owner_id.
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

alter table tender_participants
  add column if not exists email          text,
  add column if not exists phone          text,
  add column if not exists address        text,
  add column if not exists manager_name   text,
  -- Raw participation-history block from the intelligence tool (J360),
  -- kept verbatim for the company sidepanel. Our own cross-tender
  -- history stays computed from tender_participants rows.
  add column if not exists source_history jsonb;

alter table tenders
  -- Second source link: the J360 project page (source_url keeps the
  -- official tender notice).
  add column if not exists j360_url text;

insert into schema_migrations (filename, note)
values ('117_tender_project_intel.sql', 'projects-first attribution workflow + participant contacts')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- POST-CHECK (run separately):
--   select column_name from information_schema.columns
--    where table_name = 'tender_participants'
--      and column_name in ('email','phone','address','manager_name','source_history');
--
-- ROLLBACK:
--   begin;
--   alter table tender_participants
--     drop column if exists email, drop column if exists phone,
--     drop column if exists address, drop column if exists manager_name,
--     drop column if exists source_history;
--   alter table tenders drop column if exists j360_url;
--   delete from schema_migrations where filename = '117_tender_project_intel.sql';
--   notify pgrst, 'reload schema';
--   commit;
-- ---------------------------------------------------------------------
