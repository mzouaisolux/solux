-- =====================================================================
-- m139 — Line-level pricing source & approval provenance.
--
-- WHY. The catalogue defines what we MANUFACTURE; the Service Request
-- defines what we SELL. Today, attaching the mandatory catalogue model to a
-- quotation line (ProductConfigurator.pickModel) flips the line to
-- pricing_mode='auto', which makes the builder re-resolve the price from the
-- catalogue tier map on every edit — DESTROYING the selling price the Sales
-- Director already approved in the Service Request (or zeroing it when the
-- catalogue has no tier price). Selecting a model must attach a manufacturing
-- reference ONLY; it must never touch commercial values.
--
-- The fix hangs off a durable per-line `pricing_source`:
--   catalogue                 -> catalogue selection MAY drive the price
--   manual                    -> LOCKED (sales typed/edited the selling price)
--   approved_service_request  -> LOCKED (generated from an approved SR)
--   imported                  -> LOCKED (historical import origin; forward-looking)
-- The lock predicate is simply `pricing_source <> 'catalogue'`. For a locked
-- line, `original_unit_price` is the commercial truth and is never recomputed
-- from the catalogue.
--
-- COST STAYS HIDDEN. document_lines is Sales-readable. We deliberately add NO
-- cost / margin / RMB column here — factory cost remains confidential to the
-- Service Request (RLS on factory_cost_requests, m091). The quotation line only
-- ever carries the SELLING price (`original_unit_price` / `unit_price`) plus
-- audit/routing metadata. `source_project_request_id` lets authorised roles
-- reconstruct the margin from the SR without duplicating the cost onto the line.
--
-- We also stamp WHO priced the SR and WHEN on the project_products snapshot
-- (m095) so the generated quotation line can carry approved_by / approved_at.
--
-- NOTE. `approved_unit_price` and `approved_currency` are intentionally NOT
-- added: `original_unit_price` already is the approved price of record (no
-- second copy to drift), and the document already carries a single `currency`.
--
-- Additive + idempotent.
-- =====================================================================

begin;

-- 1. Line pricing source + approval provenance ------------------------
alter table document_lines
  add column if not exists pricing_source text
    check (pricing_source in ('catalogue','manual','approved_service_request','imported')),
  add column if not exists source_project_request_id uuid
    references project_requests(id) on delete set null,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz;

-- 2. Backfill existing lines from their mechanical mode ----------------
-- Historical data has no pricing_source. A manual line was already
-- price-protected (the user's number is authoritative) -> 'manual'; an auto
-- line was catalogue-driven -> 'catalogue'. This makes the lock correct for
-- every pre-existing quotation without touching a single price.
update document_lines
   set pricing_source = case
         when pricing_mode = 'manual' then 'manual'
         else 'catalogue'
       end
 where pricing_source is null;

-- 3. Approval provenance on the Project Product snapshot (m095) --------
-- project_products is the approved SELLING-price snapshot the quotation is
-- generated from. Record who approved the pricing and when, so the quotation
-- line inherits approved_by / approved_at. (Cost is never stored here — m095.)
alter table project_products
  add column if not exists priced_by uuid references auth.users(id) on delete set null,
  add column if not exists priced_at timestamptz;

insert into schema_migrations (filename, note)
values ('139_line_pricing_source_lock.sql',
        'Line-level pricing_source (catalogue/manual/approved_service_request/imported) + source_project_request_id + approved_by/at on document_lines; backfill from pricing_mode; priced_by/at on project_products. Decouples catalogue model (manufacturing reference) from approved commercial pricing: a locked line (pricing_source<>catalogue) keeps original_unit_price and is never recomputed from the catalogue. No cost/margin column — factory cost stays confidential to the Service Request.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately, after apply):
--   -- Every historical line now has a source, none null:
--   select count(*) from document_lines where pricing_source is null;         -- expect 0
--   -- Manual lines became locked, auto lines stayed catalogue:
--   select pricing_source, count(*) from document_lines group by pricing_source;
--   -- Snapshot provenance columns exist:
--   select priced_by, priced_at from project_products limit 0;                -- no error
-- ---------------------------------------------------------------------
