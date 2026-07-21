-- =====================================================================
-- RECONCILIATION v2 — 2026-07-15 (corrige l'echec 42703 sur 158)
-- Pre-m113 deja backfilles (run precedent). Packing 173/174 EXCLU.
-- 158 est A SENS UNIQUE (lit puis DROP forecast_category) : deja appliquee
--   => LEDGER ONLY, on ne re-execute JAMAIS son corps.
-- Les 7 autres sont idempotentes (if not exists / where not exists /
--   create or replace) : corps + backfill ledger explicite (130/147 ne
--   s'auto-enregistrent pas). Sur si deja appliquees, corrige sinon.
-- =====================================================================

-- ---- BLOCK A : 158 ledger-only (NE PAS re-executer le corps) ----
insert into schema_migrations (filename) values
  ('158_forecast_standard_probabilities_and_audit.sql')
on conflict (filename) do nothing;

-- ---- BLOCK B : corps idempotents des 7 ----

-- ============================ 130_backfill_null_client_codes.sql ============================
-- =====================================================================
-- m130 — Backfill NULL client_code  (SAFE · idempotent · DRY-RUN first)
-- ---------------------------------------------------------------------
-- Fixes the residual DATA side of bug #8: clients created BEFORE the
-- createClientAction guard could have client_code = NULL, which then
-- blocks saving ANY quotation for them (buildPayload + the doc-number
-- function both raise "Client has no client_code"). The app side is
-- already fixed (server guard + required form field) — this only
-- regularises OLD rows.
--
-- client_code constraint (m006):
--   CHECK (client_code IS NULL OR client_code ~ '^[A-Z]{3}$')
--   + PARTIAL UNIQUE INDEX among non-null codes.
-- ⇒ the ONLY "missing" state possible is NULL (''/lowercase can't be
--   stored), and every assigned code MUST be collision-free.
--
-- This migration is deliberately CONSERVATIVE — it NEVER invents codes
-- for real clients "sans contrôle":
--   • Never overwrites a non-null code.
--   • Assigns only an UNAMBIGUOUS, COLLISION-FREE 3-letter code derived
--     from company_name (first 3 alpha chars, uppercased).
--   • Collisions AND names with < 3 letters are SKIPPED + logged for
--     MANUAL handling (no auto-invention, no fallback guessing).
--   • Runs in DRY-RUN by default (v_apply = false): logs what it WOULD
--     do and writes NOTHING. Review the NOTICEs, then set v_apply := true
--     and re-run to apply.
--   • Idempotent: re-running only ever touches the remaining NULLs.
-- Apply MANUALLY in Supabase. Read the NOTICE output.
-- =====================================================================

-- ---------------------------------------------------------------------
-- STEP 1 — QUICK AUDIT (run this SELECT first, no writes):
--
--   select
--     count(*) filter (where client_code is null)                                              as null_total,
--     count(*) filter (where client_code is null and archived_at is null)                      as null_active,
--     count(*) filter (where client_code is null and archived_at is not null)                  as null_archived,
--     count(*) filter (where client_code is null and company_name ~* 'test|demo|sample|essai|exemple') as null_testlike
--   from clients;
--
-- DETAILED LIST (proposed code + collision/ambiguity flags + risk):
--
--   select
--     c.id, c.company_name,
--     (c.archived_at is not null)                                          as archived,
--     (c.company_name ~* 'test|demo|sample|essai|exemple')                 as testlike,
--     exists(select 1 from documents d where d.client_id = c.id)           as has_docs,
--     upper(substring(regexp_replace(c.company_name,'[^A-Za-z]','','g') from 1 for 3)) as proposed_code,
--     (length(regexp_replace(c.company_name,'[^A-Za-z]','','g')) < 3)      as too_short,
--     exists(select 1 from clients x
--            where x.client_code =
--              upper(substring(regexp_replace(c.company_name,'[^A-Za-z]','','g') from 1 for 3))) as collides
--   from clients c
--   where c.client_code is null
--   order by archived, testlike desc, company_name;
-- ---------------------------------------------------------------------

begin;

do $$
declare
  v_apply   boolean := false;   -- ◄── DRY-RUN by default. Set to true AFTER reviewing the NOTICEs.
  r         record;
  v_code    text;
  v_used    text[];
  v_changed int := 0;
  v_skipped int := 0;
  v_kind    text;
begin
  -- Collision set: existing non-null codes + codes assigned during THIS
  -- run (so two NULL clients deriving the same code don't clash, even in
  -- dry-run where nothing is written yet).
  select coalesce(array_agg(client_code), '{}'::text[])
    into v_used
    from clients
   where client_code is not null;

  for r in
    select c.id,
           c.company_name,
           c.archived_at,
           (c.company_name ~* 'test|demo|sample|essai|exemple')        as testlike,
           exists(select 1 from documents d where d.client_id = c.id)  as has_docs
      from clients c
     where c.client_code is null
     order by (c.archived_at is not null), c.company_name
  loop
    v_kind :=
      case when r.testlike then 'test' else 'real' end
      || case when r.archived_at is not null then '/archived'
              when r.has_docs              then '/active+docs'
              else                              '/active' end;

    v_code := upper(substring(regexp_replace(coalesce(r.company_name,''), '[^A-Za-z]', '', 'g') from 1 for 3));

    -- Ambiguous: company name has fewer than 3 letters → cannot derive a
    -- safe code. Leave for manual assignment.
    if length(v_code) < 3 then
      raise notice 'SKIP ambiguous (<3 letters) [%] % | "%"  → assign a code MANUALLY',
        v_kind, r.id, r.company_name;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Collision: derived code already taken (existing or earlier this run)
    -- → never auto-apply a colliding code. Leave for manual choice.
    if v_code = any(v_used) then
      raise notice 'SKIP collision (% already used) [%] % | "%"  → pick a unique code MANUALLY',
        v_code, v_kind, r.id, r.company_name;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_apply then
      update clients set client_code = v_code
       where id = r.id and client_code is null;   -- never overwrite a valid code
      raise notice 'SET % ← "%" [%]', v_code, r.company_name, v_kind;
    else
      raise notice 'WOULD SET % ← "%" [%]', v_code, r.company_name, v_kind;
    end if;

    v_used    := v_used || v_code;
    v_changed := v_changed + 1;
  end loop;

  raise notice '──────── % · % code(s) %, % skipped (manual) ────────',
    case when v_apply then 'APPLIED' else 'DRY-RUN (no writes)' end,
    v_changed,
    case when v_apply then 'set' else 'to set' end,
    v_skipped;

  -- Only record the migration as applied when it actually wrote.
  if v_apply then
    insert into schema_migrations (filename, note)
    values ('130_backfill_null_client_codes.sql',
            'Backfilled NULL client_code with collision-free 3-letter codes; collisions/ambiguous left for manual.')
    on conflict (filename) do nothing;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- STEP 2 — review the dry-run NOTICEs above.
-- STEP 3 — set  v_apply := true  and re-run to apply the safe ones.
-- STEP 4 — handle the SKIPPED rows manually, e.g.:
--            update clients set client_code = 'XYZ' where id = '<uuid>';  -- a free 3-letter code
--
-- POST-CHECK — no ACTIVE client should still lack a code (archived ones
-- are lower risk; quote-save only happens on active clients):
--   select id, company_name from clients
--    where client_code is null and archived_at is null;   -- expect 0 rows (or only manual leftovers)
--
-- ROLLBACK (only undoes THIS run's auto-set codes is not tracked; codes
-- are business data — to revert a specific one: set client_code = null
-- where id = '<uuid>').
-- ---------------------------------------------------------------------

-- ============================ 147_document_number_global_counter.sql ============================
-- =====================================================================
-- m147 — Fix duplicate document numbers (500 on save)
-- ---------------------------------------------------------------------
-- Symptom: saving a NEW quotation/proforma intermittently 500s with
--   duplicate key value violates unique constraint "documents_number_key"
-- for some clients (deterministic per client), independent of line content
-- (custom-pole-only quotes hit it too — that was a coincidence of testing).
--
-- Root cause: next_client_document_number() (m006) mints the next sequence
-- but runs as SECURITY INVOKER and counts existing documents under the
-- CALLER's RLS scope. A sales rep only sees documents where
-- created_by = auth.uid() (m046 "documents read scoped"), so the counter
-- UNDERCOUNTS whenever the client's number space already holds rows the rep
-- cannot see:
--   • documents created by ANOTHER rep for the same client, or
--   • documents of ANOTHER client that shares the same 3-letter client_code
--     (dup codes persist until m145 dedup is applied).
-- It then returns an already-taken sequence, and documents.number carries a
-- GLOBAL single-column UNIQUE constraint (documents_number_key), so the
-- insert is rejected → 500.
--
-- Fix (two independent parts):
--   • This migration — make the RPC authoritative:
--       - SECURITY DEFINER (+ pinned search_path) so it counts EVERY document
--         in the number space, not just the caller's RLS-visible rows.
--       - Scope the counter by the PREFIX (number space) instead of by
--         client_id, so two clients sharing a code draw from one monotonic
--         sequence and can never collide.
--   • App-side (already shipped in app/(app)/documents/new/actions.ts) — treat
--     the RPC value as a starting guess and probe upward on the unique
--     violation. That keeps saving correct even before this migration is
--     applied; this migration removes the cause so the probe is never needed.
--
-- Safe to run repeatedly (create or replace). No data change.
-- =====================================================================

begin;

create or replace function next_client_document_number(client_id_in uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
  start_seq int;
  yr text := to_char(now(), 'YY');
  prior_count int;
  prefix text;
  highest int;
  next_seq int;
begin
  select client_code, coalesce(starting_sequence_number, 0)
    into code, start_seq
    from clients
   where id = client_id_in;

  if code is null then
    raise exception 'Client has no client_code — please set a 3-letter code on the client first.';
  end if;

  prefix := 'SLX-' || code || '-' || yr || '-';

  -- Highest existing sequence across the WHOLE number space (every client that
  -- shares this prefix), NOT just this client_id. documents.number is globally
  -- unique, so the counter has to be too. Revision suffixes ("-V{n}") don't end
  -- in a bare sequence and are ignored by the regexp, exactly as before.
  select coalesce(max((regexp_match(number, '-([0-9]+)$'))[1]::int), 0)
    into highest
    from documents
   where number like prefix || '%';

  -- Defensive count (legacy/non-standard numbers that the regexp misses).
  select count(*) into prior_count
    from documents
   where number like prefix || '%';

  -- greatest(...) + 1 is always strictly above every existing sequence in the
  -- space, so the returned number can never already exist.
  next_seq := greatest(highest, start_seq + prior_count) + 1;

  return prefix || lpad(next_seq::text, 3, '0');
end; $$;

notify pgrst, 'reload schema';

commit;

-- ============================ 160_industrial_dictionary.sql ============================
-- =====================================================================
-- m160 — Product Dictionary (owner spec 2026-07-08, final improvements).
-- =====================================================================
--
-- The factory doesn't work with translations — it works with OFFICIAL
-- internal references and ERP codes ("Battery" ↦ "LFP25-65AH-V6" ↦
-- "25.6V 65Ah 磷酸铁锂电池"). Rather than minting a rival table, the
-- EXISTING component_mappings (m012 — the commercial→factory-reference
-- dictionary the TLM already maintains in /admin/components) is promoted
-- to the centralized Product Dictionary every module reads:
--
--   commercial_name_fr      — commercial name (FR); existing
--                             commercial_name stays the EN name.
--   factory_name_cn         — official Chinese factory terminology.
--   erp_code                — ERP code (internal_reference remains the
--                             factory reference, e.g. LFP25-65AH-V6).
--   compatible_category_ids — product FAMILIES this item fits (uuid[]
--                             of product_categories). Empty = generic
--                             (offered for every family).
--   compatible_product_ids  — optional per-product narrowing (uuid[] of
--                             products).
--   metadata                — jsonb reserve (drawings/manuals/packaging
--                             pointers, production notes… future rounds
--                             without further DDL).
--
-- First consumer: the task list's product-aware FREE SPARE PARTS — the
-- selector only offers items compatible with the ordered families and
-- auto-fills factory naming from the dictionary (overridable).
--
-- The app is DORMANT before this migration (new columns are fetched and
-- written defensively) — deploy code first, then apply.
--
-- Idempotent. Safe to re-run. Apply manually in the Supabase SQL editor.
-- =====================================================================

begin;

alter table component_mappings
  add column if not exists commercial_name_fr      text,
  add column if not exists factory_name_cn         text,
  add column if not exists erp_code                text,
  add column if not exists compatible_category_ids uuid[] not null default '{}',
  add column if not exists compatible_product_ids  uuid[] not null default '{}',
  add column if not exists metadata                jsonb  not null default '{}'::jsonb;

-- Ledger (m113 rule) — the app gates the new UI on this exact row.
insert into schema_migrations (filename, note)
values ('160_industrial_dictionary.sql',
        'Product Dictionary: component_mappings gains FR/CN names, ERP code, product/category compatibility arrays and a metadata reserve. Consumed by the task-list product-aware spare parts.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select column_name from information_schema.columns
--    where table_name = 'component_mappings'
--      and column_name in ('commercial_name_fr','factory_name_cn','erp_code',
--                          'compatible_category_ids','compatible_product_ids','metadata');
-- ---------------------------------------------------------------------

-- ============================ 162_request_notification_routes.sql ============================
-- ============================================================================
-- m162 — Notification routes for the REQUEST workflows (owner 2026-07-11,
-- QA round 1 finding: events flowed but event_routing was empty, so nobody
-- was ever notified while the submit toast claimed "Operations notified").
--
-- The event registry stays OPT-IN (m136 / owner 2026-07-03): an event
-- notifies only when its MASTER row (consumer='notification', role='*')
-- exists. This migration opts IN the request-workflow events and pins the
-- role that must get the BELL (others fall back to the severity default,
-- i.e. the feed). All INSERTs are idempotent (WHERE NOT EXISTS) and fully
-- reversible from the admin Event Registry UI (/admin/events).
--
--   transport.requested            → Operations bell   (Sales → Ops)
--   transport.completed            → Sales bell        (Ops → Sales)
--   transport.cancelled            → Sales bell
--   transport.reopened             → Sales bell        (m162 event, reopen audit)
--   pr.submitted                   → Sales-director bell (approval request)
--   pr.approved                    → Operations bell   ("Send to Operations")
--   pr.rejected / pr.info_requested→ Sales bell        (director back to sales)
--   pr.ready_for_pricing           → Sales bell        (costing completed)
--   doc.shipping_update_requested  → Operations bell   (m149 queue)
--   doc.shipping_update_completed  → Sales bell
-- ============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('transport.requested',            'operations'),
      ('transport.completed',            'sales'),
      ('transport.cancelled',            'sales'),
      ('transport.reopened',             'sales'),
      ('pr.submitted',                   'sales_director'),
      ('pr.approved',                    'operations'),
      ('pr.rejected',                    'sales'),
      ('pr.info_requested',              'sales'),
      ('pr.ready_for_pricing',           'sales'),
      ('pr.priced',                      'sales'),
      ('doc.shipping_update_requested',  'operations'),
      ('doc.shipping_update_completed',  'sales')
    ) AS v(event_key, bell_role)
  LOOP
    -- Master switch: opt the event IN (role='*').
    INSERT INTO event_routing (event_key, consumer, role, config, enabled)
    SELECT r.event_key, 'notification', '*', '{}'::jsonb, true
    WHERE NOT EXISTS (
      SELECT 1 FROM event_routing
      WHERE event_key = r.event_key AND consumer = 'notification' AND role = '*'
    );

    -- The role that must get the BELL for this event.
    INSERT INTO event_routing (event_key, consumer, role, config, enabled)
    SELECT r.event_key, 'notification', r.bell_role, '{"channel":"bell"}'::jsonb, true
    WHERE NOT EXISTS (
      SELECT 1 FROM event_routing
      WHERE event_key = r.event_key AND consumer = 'notification' AND role = r.bell_role
    );
  END LOOP;
END $$;

-- ============================ 164_attachment_folder.sql ============================
-- =====================================================================
-- m164 — user-assignable document CATEGORY (folder) for uploaded files.
--
-- The affair Documents section groups files into categories. Until now a
-- file's category was DERIVED from its attachment_type + extension. This
-- column lets a user file an upload into ANY category by drag & drop —
-- and is the field a future AI classifier will populate / suggest.
--
-- NULLABLE by design: NULL = "not filed by a human yet" → keep deriving
-- from attachment_type (lib/project-documents.ts folderForAttachment). No
-- default, so existing rows are untouched and keep their derived category.
--
-- Only UPLOADS (attachments) carry this; generated documents (quotations,
-- order docs, studies) get their category from business logic and are not
-- movable.
-- =====================================================================

alter table public.attachments
  add column if not exists folder text;

-- Keep the value inside the known category vocabulary (mirrors
-- PROJECT_FOLDERS in lib/project-documents.ts). NULL always allowed.
alter table public.attachments
  drop constraint if exists attachments_folder_check;

alter table public.attachments
  add constraint attachments_folder_check check (
    folder is null or folder in (
      'commercial',        -- Commercial
      'customer',          -- Customer Files
      'technical',         -- Technical Files & Drawings
      'energy_studies',    -- Energy & Lighting Studies
      'certifications',    -- Certifications
      'photos',            -- Photos & Shipping Documents
      'contracts',         -- Contracts
      'other'              -- Other
    )
  );

comment on column public.attachments.folder is
  'User-assigned document category (drag & drop). NULL = derive from attachment_type. m164.';

-- ============================ 170_price_list_catalogue_flag.sql ============================
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

-- ============================ 172_events_read_sales_director_documents.sql ============================
-- =====================================================================
-- m172 — Sales Director can READ 'document' events (fix "emitted but muted")
-- =====================================================================
--
-- Problem
-- -------
-- doc.approved_price_changed (m168) is ROUTED to the Sales Director's bell
-- (event_routing: role='sales_director', channel='bell'). But the
-- `events read scoped` policy (m103) grants read on 'document' events only to
-- the broad roles (admin / task_list_manager / operations / super_admin) or to
-- the document's OWNER (created_by = self). A Sales Director is neither (the
-- quotation is created by Sales), so under RLS they could not READ the event
-- they were notified about — the bell was emitted yet permanently empty
-- ("emitted but muted"). Proven live on a real sales_director session.
--
-- Fix
-- ---
-- Add ONE read branch: a Sales Director may read 'document' events. This is the
-- minimal grant that closes the only routing↔RLS gap (see the notification
-- routing seed): every other routed recipient already reads its entity
-- (operations = broad; sales = owner-scoped; sales_director already reads
-- 'project_request' via m092/m103). Read-only, no other event type widened.
-- Mirrors the intent of the existing project_request branch that already grants
-- sales_director + finance oversight visibility.
--
-- The Sales Director is the head of sales and oversees ALL quotations /
-- proformas / invoices, so org-wide read of document events is appropriate.
-- (finance is NOT added: nothing routes 'document' events to finance today; add
-- it in a future migration if/when routing does.)
--
-- This migration reproduces the m103 policy body verbatim and appends the new
-- branch (create policy replaces wholesale). Idempotent. Safe to re-run.
-- =====================================================================

begin;

drop policy if exists "events read" on events;
drop policy if exists "events read scoped" on events;
create policy "events read scoped" on events for select using (
  -- Technical / admin / super-admin → full visibility (unchanged).
  exists (
    select 1 from user_roles ur
     where ur.user_id = auth.uid()
       and (
         ur.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(ur.super_admin, false)
       )
  )
  -- Sales scope: must own the underlying entity (unchanged branches).
  or (entity_type = 'document' and exists (
    select 1 from documents d
     where d.id = entity_id and d.created_by = auth.uid()
  ))
  -- NEW (m172): the Sales Director oversees ALL quotations/invoices, so they
  -- must be able to READ 'document' events they are routed (e.g.
  -- doc.approved_price_changed, m168). Without this the bell was emitted yet
  -- unreadable. Read-only; aligns RLS with the notification routing.
  or (entity_type = 'document' and exists (
    select 1 from user_roles ur
     where ur.user_id = auth.uid() and ur.role = 'sales_director'
  ))
  or (entity_type = 'task_list' and exists (
    select 1 from production_task_lists tl
     join documents d on d.id = tl.quotation_id
     where tl.id = entity_id and d.created_by = auth.uid()
  ))
  or (entity_type = 'production_order' and exists (
    select 1 from production_orders po
     join documents d on d.id = po.quotation_id
     where po.id = entity_id and d.created_by = auth.uid()
  ))
  or (entity_type = 'client' and exists (
    select 1 from documents d
     where d.client_id = entity_id and d.created_by = auth.uid()
  ))
  -- project_request branch (m092, unchanged).
  or (entity_type = 'project_request' and (
        exists (
          select 1 from project_requests pr
           where pr.id = entity_id
             and (pr.owner_id = auth.uid() or pr.created_by = auth.uid())
        )
     or exists (
          select 1 from user_roles ur
           where ur.user_id = auth.uid()
             and ur.role in ('sales_director', 'finance')
        )
  ))
  -- affair events (m103, unchanged).
  or (entity_type = 'affair' and exists (
    select 1 from affairs a
     where a.id = entity_id
       and (
         a.owner_id = auth.uid()
         or a.created_by = auth.uid()
         or exists (
           select 1 from clients c
            where c.id = a.client_id
              and (c.created_by = auth.uid() or c.sales_owner_id = auth.uid())
         )
       )
  ))
);

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately, as a real sales_director session):
--   -- The Sales Director can now read a document event they did not create:
--   select count(*) from events where entity_type = 'document';
--   -- Expected: > 0 (previously 0 for a non-owner sales_director)
-- ---------------------------------------------------------------------

-- ---- BLOCK C : filet de securite — garantit l'enregistrement des 7 ----
insert into schema_migrations (filename) values
  ('130_backfill_null_client_codes.sql'),
  ('147_document_number_global_counter.sql'),
  ('160_industrial_dictionary.sql'),
  ('162_request_notification_routes.sql'),
  ('164_attachment_folder.sql'),
  ('170_price_list_catalogue_flag.sql'),
  ('172_events_read_sales_director_documents.sql')
on conflict (filename) do nothing;
