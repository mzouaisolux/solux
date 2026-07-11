-- =====================================================================
-- m161 — Transport Request module: affair-centric logistics requests
-- =====================================================================
--
-- Owner feature (2026-07-10): a dedicated Transport Request module behind
-- the "⚡ Requests → New Transport Request" menu entry. One place for every
-- logistics request, always linked Client → Affair, in three kinds:
--   'packing_list'  → Operations prepares a packing list (weights/CBM/…)
--   'price'         → Operations quotes freight for a shipment
--   'price_update'  → refresh an existing transport quotation (rates /
--                     destination / incoterm / products / qty changed)
--
-- Workflow spine mirrors m149 (shipping_update_requests):
--   Sales submits (waiting) → Operations queue "Transport Requests"
--   (in_progress) → Operations enters the results → completed.
-- The COMPLETED price/price_update rows ARE the affair's transport price
-- history (V1, V2, V3… — never overwritten; a new request = a new row).
--
-- transport_request_lines captures the EXACT product configuration shipped
-- (product + quantity + config_values — solar panel size above all): the
-- foundation for future automatic packing lists / CBM / container loading.
-- Deliberately mirrors document_lines' shape so quotation lines import 1:1.
--
-- Distinct from freight_cost_requests (m091, child of the SR costing loop)
-- and from shipping_update_requests (m149, hangs off ONE document): this
-- module is affair-level and multi-product by design.
--
-- Capabilities: reuses shipping.request_update (sales side) and
-- shipping.process_update (operations queue) — seeded by m149, nothing new.
-- Freight amounts are USD (implicit, like every freight table in the app).
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Parent table — one row per request; completed rows are the history.
-- ---------------------------------------------------------------------
create table if not exists transport_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null
    check (kind in ('packing_list','price','price_update')),
  affair_id uuid not null references affairs(id) on delete cascade,
  -- denormalized for cheap queue rendering (joins stay possible)
  client_id uuid references clients(id) on delete set null,

  status text not null default 'waiting'
    check (status in ('waiting','in_progress','completed','cancelled')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high')),

  -- Why sales asked (esp. price_update: rates changed, destination changed…).
  reason text,

  -- Transport information (sales side).
  destination_country text,
  destination_port text,
  port_of_loading text,
  delivery_address text,
  incoterm text,
  transport_mode text,
  notes text,

  -- Provenance: the quotation products were imported from, or the document
  -- whose transport price is being updated. Never owns the request.
  source_document_id uuid references documents(id) on delete set null,
  -- price_update chains: the previous transport request being refreshed.
  previous_request_id uuid references transport_requests(id) on delete set null,

  -- Results (operations side). freight for price kinds; weights/CBM for
  -- packing lists — both share the same row so history reads in one place.
  freight_cost numeric,
  insurance_cost numeric,
  additional_charges jsonb not null default '[]'::jsonb,
  transit_time_days int,
  gross_weight_kg numeric,
  net_weight_kg numeric,
  cbm numeric,
  cartons_count int,
  pallets_count int,
  containers jsonb not null default '[]'::jsonb,
  valid_until date,
  ops_comments text,

  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_transport_requests_affair
  on transport_requests(affair_id);
create index if not exists idx_transport_requests_status
  on transport_requests(status);
create index if not exists idx_transport_requests_requested_by
  on transport_requests(requested_by);
create index if not exists idx_transport_requests_history
  on transport_requests(affair_id, kind, completed_at);

-- ---------------------------------------------------------------------
-- 2. Lines — the exact shipped configuration (document_lines' shape, so a
--    quotation imports 1:1). product_name is a SNAPSHOT: a deleted catalog
--    product must never blank the ops queue.
-- ---------------------------------------------------------------------
create table if not exists transport_request_lines (
  id uuid primary key default gen_random_uuid(),
  transport_request_id uuid not null references transport_requests(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  category_id uuid references product_categories(id) on delete set null,
  product_name text,
  client_product_name text,
  quantity numeric not null default 1,
  config_values jsonb not null default '{}'::jsonb,
  position int not null default 0
);

create index if not exists idx_transport_request_lines_request
  on transport_request_lines(transport_request_id);

-- ---------------------------------------------------------------------
-- 3. RLS — m149 shape (requester + processing roles) EXTENDED with the
--    affair owner/creator: the version history (V1..Vn) must read the same
--    for every rep working the affair, not just the one who clicked.
-- ---------------------------------------------------------------------
alter table transport_requests enable row level security;

drop policy if exists "transport_requests read" on transport_requests;
create policy "transport_requests read" on transport_requests
for select using (
  requested_by = auth.uid()
  or exists (
    select 1 from affairs a
    where a.id = transport_requests.affair_id
      and (a.owner_id = auth.uid() or a.created_by = auth.uid())
  )
  or exists (
    select 1 from user_roles ur
    where ur.user_id = auth.uid()
      and (ur.role in ('admin','task_list_manager','operations','sales_director')
           or ur.super_admin)
  )
);

drop policy if exists "transport_requests insert" on transport_requests;
create policy "transport_requests insert" on transport_requests
for insert with check (requested_by = auth.uid());

drop policy if exists "transport_requests update" on transport_requests;
create policy "transport_requests update" on transport_requests
for update using (
  requested_by = auth.uid()
  or exists (
    select 1 from affairs a
    where a.id = transport_requests.affair_id
      and (a.owner_id = auth.uid() or a.created_by = auth.uid())
  )
  or exists (
    select 1 from user_roles ur
    where ur.user_id = auth.uid()
      and (ur.role in ('admin','task_list_manager','operations','sales_director')
           or ur.super_admin)
  )
);

alter table transport_request_lines enable row level security;

drop policy if exists "transport_request_lines all" on transport_request_lines;
create policy "transport_request_lines all" on transport_request_lines
for all using (
  exists (
    select 1 from transport_requests tr
    where tr.id = transport_request_lines.transport_request_id
      and (
        tr.requested_by = auth.uid()
        or exists (
          select 1 from affairs a
          where a.id = tr.affair_id
            and (a.owner_id = auth.uid() or a.created_by = auth.uid())
        )
        or exists (
          select 1 from user_roles ur
          where ur.user_id = auth.uid()
            and (ur.role in ('admin','task_list_manager','operations','sales_director')
                 or ur.super_admin)
        )
      )
  )
) with check (
  exists (
    select 1 from transport_requests tr
    where tr.id = transport_request_lines.transport_request_id
      and (
        tr.requested_by = auth.uid()
        or exists (
          select 1 from user_roles ur
          where ur.user_id = auth.uid()
            and (ur.role in ('admin','task_list_manager','operations','sales_director')
                 or ur.super_admin)
        )
      )
  )
);

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('161_transport_requests.sql',
        'Transport Request module: transport_requests + transport_request_lines (affair-centric logistics requests, versioned price history) + RLS. Reuses shipping.* capabilities (m149).')
on conflict (filename) do nothing;

commit;

notify pgrst, 'reload schema';
