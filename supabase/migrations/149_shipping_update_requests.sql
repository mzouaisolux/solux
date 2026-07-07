-- =====================================================================
-- m149 — Shipping Rate Refresh: doc-centric shipping update requests
-- =====================================================================
--
-- Owner feature (2026-07-07): a sales rep can ask Operations to refresh
-- the transport cost of ANY quotation / proforma / invoice in one click,
-- without recreating a Service Request. This TABLE is the workflow spine:
--   Sales "Request Shipping Update" (modal, prefilled editable shipping
--   summary + optional reason) → row status 'waiting' → Operations queue
--   "Shipping Updates" → 'in_progress' → Operations enters the new
--   freight / insurance / additional charges → 'completed' → the system
--   pushes the new costs onto the document (same mechanism as the m098
--   enterFreight→document sync) and the completed rows ARE the shipping
--   history shown on the document.
--
-- Distinct from freight_cost_requests (m091/m098) ON PURPOSE: that table
-- is a child of project_requests (SR costing loop, containers derived
-- from packing lists). This one hangs off `documents` so it works for
-- every quotation/invoice — including the majority created WITHOUT a
-- Service Request. The m098 near-expiry banner keeps working unchanged.
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------
create table if not exists shipping_update_requests (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  -- denormalized for cheap queue rendering (client/affair joins stay possible)
  affair_id uuid references affairs(id) on delete set null,
  client_id uuid references clients(id) on delete set null,

  status text not null default 'waiting'
    check (status in ('waiting','in_progress','completed','cancelled')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high')),

  -- Why sales asked (optional, free text — the modal offers suggestions).
  reason text,

  -- The editable "Shipping Summary" snapshot the sales rep confirmed in
  -- the modal (destination_country, destination_port, port_of_loading,
  -- incoterm, shipping_method, container_type, containers_count,
  -- estimated_volume, product_family — all strings, all optional).
  snapshot jsonb not null default '{}'::jsonb,

  -- Old vs new cost — the delta IS the value of this feature.
  previous_freight_cost numeric,
  previous_insurance_cost numeric,
  previous_quote_date date,
  new_freight_cost numeric,
  new_insurance_cost numeric,
  new_additional_charges jsonb not null default '[]'::jsonb,
  ops_notes text,

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

create index if not exists idx_shipping_update_requests_document
  on shipping_update_requests(document_id);
create index if not exists idx_shipping_update_requests_status
  on shipping_update_requests(status);
create index if not exists idx_shipping_update_requests_requested_by
  on shipping_update_requests(requested_by);

-- ---------------------------------------------------------------------
-- 2. RLS — same shape as the project_requests family: requester sees own,
--    technical roles / sales_director / admin see all. Mutations by the
--    requester (create + cancel own) and the processing roles.
-- ---------------------------------------------------------------------
alter table shipping_update_requests enable row level security;

drop policy if exists "shipping_update_requests read" on shipping_update_requests;
create policy "shipping_update_requests read" on shipping_update_requests
for select using (
  requested_by = auth.uid()
  or exists (
    select 1 from user_roles ur
    where ur.user_id = auth.uid()
      and (ur.role in ('admin','task_list_manager','operations','sales_director')
           or ur.super_admin)
  )
);

drop policy if exists "shipping_update_requests insert" on shipping_update_requests;
create policy "shipping_update_requests insert" on shipping_update_requests
for insert with check (requested_by = auth.uid());

drop policy if exists "shipping_update_requests update" on shipping_update_requests;
create policy "shipping_update_requests update" on shipping_update_requests
for update using (
  requested_by = auth.uid()
  or exists (
    select 1 from user_roles ur
    where ur.user_id = auth.uid()
      and (ur.role in ('admin','task_list_manager','operations','sales_director')
           or ur.super_admin)
  )
);

-- ---------------------------------------------------------------------
-- 3. Capabilities (catalogued in lib/capabilities.ts — module "shipping")
-- ---------------------------------------------------------------------
insert into permissions (key, category, label, description, sort_order) values
  ('shipping.request_update', 'Shipping', 'Request a shipping cost update',
   'Ask Operations to refresh the transport cost of a quotation / invoice (modal with editable shipping summary + reason).', 110),
  ('shipping.process_update', 'Shipping', 'Process shipping update requests',
   'Work the Shipping Updates queue: enter the new freight / insurance / charges and complete the request (updates the document).', 111)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

insert into role_permissions (role, permission_key, enabled) values
  ('super_admin',       'shipping.request_update', true),
  ('admin',             'shipping.request_update', true),
  ('sales',             'shipping.request_update', true),
  ('sales_director',    'shipping.request_update', true),
  ('task_list_manager', 'shipping.request_update', false),
  ('operations',        'shipping.request_update', false),
  ('finance',           'shipping.request_update', false),

  ('super_admin',       'shipping.process_update', true),
  ('admin',             'shipping.process_update', true),
  ('sales',             'shipping.process_update', false),
  ('sales_director',    'shipping.process_update', false),
  ('task_list_manager', 'shipping.process_update', false),
  ('operations',        'shipping.process_update', true),
  ('finance',           'shipping.process_update', false)
on conflict (role, permission_key) do nothing;

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('149_shipping_update_requests.sql',
        'Shipping Rate Refresh: shipping_update_requests table + RLS + shipping.request_update / shipping.process_update capabilities')
on conflict (filename) do nothing;

commit;
