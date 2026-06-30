-- =====================================================================
-- m121 — Tender lots on participants + market reference anchor
-- =====================================================================
--
-- Owner ruling 2026-06-13: a real tender is ONE project with many lots,
-- many winners, many participants — never one project per winner.
--
--   1. tender_participants gains the LOT dimension (MVP — lots carried
--      on participants, not yet a tender_lots table):
--        lot_number / lot_title / lot_amount / lot_status
--      So a company winning lots 4, 7, 9 becomes 3 rows with their own
--      amounts (no more blind summing — "never discard information").
--      Sources without lots leave lot_number NULL → behave as before.
--
--   2. tenders.market_reference — the STRONG dedup anchor when the
--      source carries a real AO/market reference (NOT url_armp / id,
--      which are per-notice). The fuzzy matcher (country + title + date
--      window) remains the fallback.
--
--   3. Indexes for the find-or-merge candidate lookup (by reference, and
--      by country + publication_date).
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

alter table tender_participants
  add column if not exists lot_number text,
  add column if not exists lot_title  text,
  add column if not exists lot_amount numeric,
  add column if not exists lot_status text;  -- 'winner' | 'participant' | 'unknown'

alter table tenders
  add column if not exists market_reference text;

create index if not exists idx_tenders_market_reference
  on tenders(market_reference) where market_reference is not null;

create index if not exists idx_tenders_country_pubdate
  on tenders(country, publication_date);

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('121_tender_lot_identity.sql', 'tender lots on participants + market_reference anchor — extraction consolidation')
on conflict (filename) do nothing;

commit;
