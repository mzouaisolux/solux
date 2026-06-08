-- =====================================================================
-- m095 — Project Product: the sellable item generated when a Project
--        Request is priced.
--
-- A Project Product is created/refreshed when pricing is APPROVED. It is a
-- SNAPSHOT scoped to its project — it is NOT a catalog product (never inserted
-- into `products`) and exists only inside the Project Request. It carries the
-- product family (category), the technical configuration, an auto-generated
-- commercial description, and the approved selling prices (product / pole /
-- freight). The quotation is generated directly from this row — no catalog
-- product selection.
--
-- 1:1 with the project (unique project_request_id) — re-pricing upserts it.
-- Pricing here is the SELLING price (cost stays hidden), so the policy is
-- owner-inclusive: Sales can read it to generate the quotation.
--
-- Additive + idempotent.
-- =====================================================================

begin;

create table if not exists project_products (
  id                  uuid primary key default gen_random_uuid(),
  project_request_id  uuid not null references project_requests(id) on delete cascade,
  product_category_id uuid references product_categories(id) on delete set null,
  commercial_description text,
  -- technical snapshot (frozen at pricing approval)
  led_power           text,
  solar_panel_size    text,
  battery_spec        text,
  controller          text,
  pole_height         text,
  iot_required        boolean not null default false,
  -- pricing snapshot (SELLING prices — never cost)
  currency            text not null default 'USD',
  quantity            integer,
  product_unit_price  numeric,
  pole_unit_price     numeric,
  freight_total       numeric,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_request_id)
);

create index if not exists idx_project_products_project on project_products(project_request_id);

alter table project_products enable row level security;

drop policy if exists "project_products rw" on project_products;
create policy "project_products rw" on project_products for all using (
  exists (
    select 1 from project_requests pr
     where pr.id = project_products.project_request_id
       and (pr.owner_id = auth.uid() or pr.created_by = auth.uid()
            or exists (
              select 1 from user_roles r
               where r.user_id = auth.uid()
                 and (r.role in ('admin','task_list_manager','operations','sales_director','finance')
                      or coalesce(r.super_admin, false))
            ))
  )
);

notify pgrst, 'reload schema';

commit;
