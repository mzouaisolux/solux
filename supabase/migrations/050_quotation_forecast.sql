-- =====================================================================
-- m050 — Lightweight sales forecasting layer on quotations.
-- =====================================================================
--
-- WHAT
-- ----
-- A forecast is NOT a separate opportunity object. It is a thin
-- commercial projection layer attached directly to the existing
-- quotation/proforma (the `documents` row stays the single source of
-- truth). We add five nullable columns:
--
--   forecast_probability          : 10 / 25 / 50 / 75 / 90 (stages,
--                                   not free numeric — avoids fake
--                                   precision)
--   forecast_expected_close_date  : when sales expects to close. The
--                                   forecast page aggregates this by
--                                   month / quarter / year — preferred
--                                   over picking a quarter manually.
--   forecast_category             : pipeline / best_case / commit /
--                                   upside / at_risk (operational
--                                   bucket — probability alone isn't
--                                   enough for management).
--   forecast_updated_at           : drives the "forecast outdated"
--                                   warning (orange after 30 days).
--   forecast_updated_by           : who last touched the forecast.
--
-- A NULL forecast_probability means "no forecast yet" — the quotation
-- simply doesn't show up in weighted projections.
--
-- Follows the m048 convention of adding projection columns directly to
-- the owning entity rather than spinning up a side table.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table documents
  add column if not exists forecast_probability integer;

alter table documents
  drop constraint if exists forecast_probability_check;
alter table documents
  add constraint forecast_probability_check check (
    forecast_probability is null
    or forecast_probability in (10, 25, 50, 75, 90)
  );

alter table documents
  add column if not exists forecast_expected_close_date date;

alter table documents
  add column if not exists forecast_category text;

alter table documents
  drop constraint if exists forecast_category_check;
alter table documents
  add constraint forecast_category_check check (
    forecast_category is null
    or forecast_category in (
      'pipeline',
      'best_case',
      'commit',
      'upside',
      'at_risk'
    )
  );

alter table documents
  add column if not exists forecast_updated_at timestamptz;

alter table documents
  add column if not exists forecast_updated_by uuid references auth.users(id);

-- The forecast page queries "all active quotations with a forecast,
-- ordered by expected close date". A partial index on rows that carry
-- a probability keeps that scan tight even as the documents table
-- grows with won/lost/cancelled history.
create index if not exists documents_forecast_idx
  on documents (forecast_expected_close_date)
  where forecast_probability is not null;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   -- 1. Columns exist
--   select column_name from information_schema.columns
--    where table_name = 'documents'
--      and column_name like 'forecast_%';
--   -- Expected: 5 rows
--
--   -- 2. Probability CHECK rejects off-stage values
--   update documents set forecast_probability = 33
--    where id = (select id from documents limit 1);
--   -- Expected: error violates check constraint
--
--   -- 3. Category CHECK rejects unknown buckets
--   update documents set forecast_category = 'maybe'
--    where id = (select id from documents limit 1);
--   -- Expected: error violates check constraint
-- ---------------------------------------------------------------------
