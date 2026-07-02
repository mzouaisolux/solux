-- =====================================================================
-- m137 — Historical Invoice Import (customer-based, read-only "island").
-- =====================================================================
--
-- WHY (owner request 2026-07-01):
--   Rebuild a customer's commercial history from old PDF invoices with
--   near-zero manual work. Import is launched FROM a customer page and is
--   scoped to that single customer (a few hundred customers total → one
--   customer at a time is perfectly acceptable and removes all customer
--   matching from the hot path).
--
-- DESIGN — a deliberately ISOLATED subsystem, NOT the `documents` table:
--   1. `documents.type` is CHECK-constrained to ('quotation','proforma')
--      and `saveDocument` HARD-REQUIRES an affair_id (m076/m124). Historical
--      invoices have neither an affair nor a place in that constraint.
--   2. The owner rule "Affaire mandatory is core — never weaken/auto-create"
--      must hold. Reusing `documents` would force us to break it.
--   3. Spec: imported invoices are READ-ONLY and must NEVER enter the sales,
--      approval, production or accounting workflows. A separate table makes
--      that guarantee STRUCTURAL (no workflow code path can touch them).
--   → So we add dedicated tables. The commercial pipeline (quotation → won →
--     production → finance), which is frozen, is not touched by a single line.
--
-- FUTURE-PROOF: `imported_documents.doc_type` already allows quotation /
--   proforma / credit_note / purchase_order / delivery_note so the SAME engine
--   can ingest those later with NO schema redesign (owner's "future
--   architecture" requirement).
--
-- Idempotent. Self-registers in schema_migrations (m113 convention).
-- Apply manually in Supabase (DDL) after backup, per project convention.
-- =====================================================================

begin;

-- 1. import_batches — one drag-&-drop session (the unit of "an import"). ----
--    Live counters drive the wizard's progress UI; the row is durable so a
--    half-finished triage survives a refresh (resumable).
create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  status text not null default 'uploading'
    check (status in ('uploading','extracting','review','importing','completed','failed','cancelled')),
  file_count      integer not null default 0,
  extracted_count integer not null default 0,
  ready_count     integer not null default 0,
  attention_count integer not null default 0,
  imported_count  integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_import_batches_client on import_batches(client_id);

-- 2. imported_documents — the historical document itself. ------------------
--    `number` is the ORIGINAL invoice number from the PDF (NOT SLX numbering);
--    it can legitimately collide across customers → uniqueness is per customer.
--    `doc_date` (never created_at — same lesson as documents.date).
--    `currency` is FREE text (history can be any currency, unlike documents).
create table if not exists imported_documents (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references import_batches(id) on delete set null,
  client_id uuid not null references clients(id) on delete cascade,
  doc_type text not null default 'invoice'
    check (doc_type in ('invoice','quotation','proforma','credit_note','purchase_order','delivery_note')),
  source text not null default 'imported_history',
  number text,
  doc_date date,
  currency text,
  subtotal       numeric,
  discount_total numeric,
  tax_total      numeric,
  total_amount   numeric,
  notes text,
  detected_client_name text,
  name_match_score numeric,
  -- how the customer-name check was resolved: auto (matched), confirmed
  -- (user confirmed a borderline match), forced ("import anyway" on mismatch).
  name_match_decision text check (name_match_decision in ('auto','confirmed','forced')),
  extraction_confidence numeric,
  extraction_meta jsonb not null default '{}'::jsonb,
  source_file_path text,
  source_file_name text,
  status text not null default 'staged'
    check (status in ('staged','needs_attention','imported','skipped')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  imported_at timestamptz
);
-- Re-importing the same original invoice for the same customer must not
-- duplicate history (idempotent commit).
create unique index if not exists uq_imported_documents_client_type_number
  on imported_documents (client_id, doc_type, number) where number is not null;
create index if not exists idx_imported_documents_client on imported_documents(client_id);
create index if not exists idx_imported_documents_batch  on imported_documents(batch_id);
create index if not exists idx_imported_documents_status on imported_documents(status);

-- 3. imported_document_lines — line items (product-linked when matched). ----
--    product_id is nullable FK ON DELETE SET NULL (a matched catalog product
--    can later be deleted without breaking history); matched_product_name is
--    the snapshot label (same safety idea as m089).
create table if not exists imported_document_lines (
  id uuid primary key default gen_random_uuid(),
  imported_document_id uuid not null references imported_documents(id) on delete cascade,
  line_no integer not null default 0,
  description text,
  product_id uuid references products(id) on delete set null,
  matched_product_name text,
  quantity   numeric,
  unit_price numeric,
  discount   numeric,
  tax_rate   numeric,
  tax_amount numeric,
  line_total numeric,
  match_method text
    check (match_method in ('exact_sku','exact_name','fuzzy','manual','legacy','ignored','unmatched')),
  raw jsonb not null default '{}'::jsonb
);
create index if not exists idx_imported_doc_lines_doc     on imported_document_lines(imported_document_id);
create index if not exists idx_imported_doc_lines_product on imported_document_lines(product_id);

-- 4. historical_product_map — remembered product mappings. -----------------
--    Modeled on the existing `component_mappings` table (commercial_name →
--    internal_reference). Lets the NEXT import auto-resolve a line the user
--    already mapped. client_id null = a GLOBAL mapping (applies to every
--    customer); a client-scoped row wins over the global one.
create table if not exists historical_product_map (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  source_name text not null,
  source_name_key text not null,
  action text not null default 'map' check (action in ('map','legacy','ignore')),
  product_id uuid references products(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
-- One mapping per normalized name, per scope (client vs global).
create unique index if not exists uq_hpm_client
  on historical_product_map (client_id, source_name_key) where client_id is not null;
create unique index if not exists uq_hpm_global
  on historical_product_map (source_name_key) where client_id is null;
create index if not exists idx_hpm_key on historical_product_map(source_name_key);

-- 5. products.is_legacy — a "Legacy Product" is a real catalog row created ---
--    from history, flagged so it never appears in the quotation / pricing
--    pickers, yet still resolves the imported line's FK + product rollups.
alter table products add column if not exists is_legacy boolean not null default false;

-- 6. RLS — mirror the `documents` policy set (m046): owner + technical roles
--    read/update, creator inserts, admin deletes. Historical data is scoped to
--    the person who imported it + the technical roles who see all commercial
--    data. (sales_director see-all, m132-style, can be added later if needed.)
alter table import_batches            enable row level security;
alter table imported_documents        enable row level security;
alter table imported_document_lines   enable row level security;
alter table historical_product_map    enable row level security;

-- helper predicate inlined per policy (no functions, to match m046 style):
--   owner_or_tech(uid) := created_by = uid
--                         OR user has a technical role / super_admin.

-- import_batches -----------------------------------------------------------
drop policy if exists "import_batches read scoped"   on import_batches;
create policy "import_batches read scoped" on import_batches for select using (
  created_by = auth.uid()
  or exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('admin','task_list_manager','operations') or coalesce(r.super_admin,false)))
);
drop policy if exists "import_batches insert scoped" on import_batches;
create policy "import_batches insert scoped" on import_batches for insert
  with check (created_by = auth.uid());
drop policy if exists "import_batches update scoped" on import_batches;
create policy "import_batches update scoped" on import_batches for update using (
  created_by = auth.uid()
  or exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('admin','task_list_manager','operations') or coalesce(r.super_admin,false)))
);
drop policy if exists "import_batches delete scoped" on import_batches;
create policy "import_batches delete scoped" on import_batches for delete using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role = 'admin' or coalesce(r.super_admin,false)))
);

-- imported_documents -------------------------------------------------------
drop policy if exists "imported_documents read scoped"   on imported_documents;
create policy "imported_documents read scoped" on imported_documents for select using (
  created_by = auth.uid()
  or exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('admin','task_list_manager','operations') or coalesce(r.super_admin,false)))
);
drop policy if exists "imported_documents insert scoped" on imported_documents;
create policy "imported_documents insert scoped" on imported_documents for insert
  with check (created_by = auth.uid());
drop policy if exists "imported_documents update scoped" on imported_documents;
create policy "imported_documents update scoped" on imported_documents for update using (
  created_by = auth.uid()
  or exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('admin','task_list_manager','operations') or coalesce(r.super_admin,false)))
);
drop policy if exists "imported_documents delete scoped" on imported_documents;
create policy "imported_documents delete scoped" on imported_documents for delete using (
  created_by = auth.uid()
  or exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role = 'admin' or coalesce(r.super_admin,false)))
);

-- imported_document_lines — visibility follows the parent document. --------
drop policy if exists "imported_document_lines read scoped" on imported_document_lines;
create policy "imported_document_lines read scoped" on imported_document_lines for select using (
  exists (select 1 from imported_documents d where d.id = imported_document_id
      and (d.created_by = auth.uid()
           or exists (select 1 from user_roles r where r.user_id = auth.uid()
               and (r.role in ('admin','task_list_manager','operations') or coalesce(r.super_admin,false)))))
);
drop policy if exists "imported_document_lines write scoped" on imported_document_lines;
create policy "imported_document_lines write scoped" on imported_document_lines for all using (
  exists (select 1 from imported_documents d where d.id = imported_document_id
      and (d.created_by = auth.uid()
           or exists (select 1 from user_roles r where r.user_id = auth.uid()
               and (r.role in ('admin','task_list_manager','operations') or coalesce(r.super_admin,false)))))
) with check (
  exists (select 1 from imported_documents d where d.id = imported_document_id
      and (d.created_by = auth.uid()
           or exists (select 1 from user_roles r where r.user_id = auth.uid()
               and (r.role in ('admin','task_list_manager','operations') or coalesce(r.super_admin,false)))))
);

-- historical_product_map — mappings are shared team knowledge: any signed-in
-- user may read + add; only the creator or an admin may change/remove.
drop policy if exists "historical_product_map read"   on historical_product_map;
create policy "historical_product_map read" on historical_product_map for select
  using (auth.uid() is not null);
drop policy if exists "historical_product_map insert" on historical_product_map;
create policy "historical_product_map insert" on historical_product_map for insert
  with check (created_by = auth.uid());
drop policy if exists "historical_product_map update" on historical_product_map;
create policy "historical_product_map update" on historical_product_map for update using (
  created_by = auth.uid()
  or exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role = 'admin' or coalesce(r.super_admin,false)))
);
drop policy if exists "historical_product_map delete" on historical_product_map;
create policy "historical_product_map delete" on historical_product_map for delete using (
  created_by = auth.uid()
  or exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role = 'admin' or coalesce(r.super_admin,false)))
);

-- 7. Self-register in the migration ledger ---------------------------------
insert into schema_migrations (filename, note)
values ('137_historical_import.sql',
        'Historical Invoice Import (customer-based, read-only island): import_batches, imported_documents (+unique client/type/number), imported_document_lines, historical_product_map (remembered mappings), products.is_legacy. RLS mirrors documents (owner+technical+admin). Isolated from the frozen commercial pipeline; doc_type future-proofed for quotation/proforma/credit_note/purchase_order/delivery_note.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately, after apply):
--   select count(*) from import_batches;          -- expect 0, table exists
--   select count(*) from imported_documents;      -- expect 0, table exists
--   select column_name from information_schema.columns
--     where table_name = 'products' and column_name = 'is_legacy';  -- 1 row
-- STORAGE: the wizard uploads source PDFs to the existing `documents`
--   bucket under `imports/<clientId>/<batchId>/<file>`. That bucket already
--   allows authenticated writes (attachments use it) — no new bucket needed.
-- ---------------------------------------------------------------------
