-- =====================================================================
-- m170 — ACTIVABLE PRICE LISTS ("Use as Catalogue Pricing").
-- =====================================================================
--
-- Owner request (2026-07-14): decide, PER price list, whether it can be
-- used directly as a catalogue price source in the quote builder.
--
--   • use_as_catalogue_pricing = TRUE  → the list feeds catalogue pricing.
--       Sales pick a product in its category, the tier price is auto-filled,
--       and the saved line carries pricing_source = 'catalogue'.
--   • use_as_catalogue_pricing = FALSE → the list NEVER auto-prices. Sales
--       can see the products but no price is fetched; they must go through a
--       Product Cost Request / Pricing Request (approved Service Request) or
--       enter the price manually. pricing_source stays
--       'approved_service_request' / 'manual'.
--
-- This is the GRANULAR, PERMANENT successor to the temporary global m142
-- flag (pricing.hide_catalogue_prices): instead of one master on/off for all
-- catalogue prices, each list opts in individually. The default is FALSE so
-- that turning m142 off does NOT suddenly expose every published list —
-- catalogue pricing only returns for the lists an admin explicitly enables.
--
-- Pure additive column. Does NOT touch the m139 price lock: an approved
-- Service-Request price stays frozen; only pricing_source='catalogue' lines
-- are ever recomputed from a price list.
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor (prod), or via the
-- local Docker DB for development.
-- =====================================================================

begin;

alter table public.price_lists
  add column if not exists use_as_catalogue_pricing boolean not null default false;

comment on column public.price_lists.use_as_catalogue_pricing is
  'm170 — when true, this published list is offered as a catalogue price source in the quote builder (pricing_source=catalogue). When false (default), its prices are never auto-fetched; sales must use an approved Service Request or manual entry.';

-- Partial index: the quote builder only ever queries catalogue-enabled,
-- published lists per category — keep that lookup cheap.
create index if not exists idx_price_lists_catalogue
  on public.price_lists (category_id)
  where use_as_catalogue_pricing = true and status = 'published';

commit;
