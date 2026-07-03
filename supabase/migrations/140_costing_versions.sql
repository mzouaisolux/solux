-- =====================================================================
-- m140 — Costing Versions & Validity (Phase 2 of the catalogue/commercial
--        decoupling, building on m139).
--
-- WHY. An approved costing must not stay valid forever: transport, exchange
-- rates and manufacturing costs drift. The ERP must (a) keep the FULL history
-- of costing approvals inside the Service Request — versions V1..Vn, never a
-- new SR, never deleted — and (b) detect stale costings at read time against
-- company-configurable thresholds, driving an EXPLICIT revision loop. A
-- quotation never changes silently.
--
-- MODEL.
--   project_costing_versions — one row per request→approval cycle:
--     'pending'    a revision was requested (requested_by/at + reason) and
--                  awaits the Director's re-pricing;
--     'approved'   the Director priced it (approved_by/at, prices filled,
--                  previous_* snapshot the prior approved prices);
--     'superseded' a newer approval replaced it (history, kept forever);
--     'cancelled'  zombie pending closed when the SR reached a terminal
--                  status (won/lost/cancelled).
--   Invariant: at most ONE 'pending' (partial unique index) and — by the
--   write path — at most one 'approved' per SR.
--
--   Validity (Valid / Aging / Expired) is DERIVED at read time from the age
--   of the latest approved costing vs pricing_settings thresholds — no cron,
--   no stored status (mirrors the freight-validity pattern, m098).
--
-- COST STAYS HIDDEN. Versions carry SELLING prices only (like m095
-- project_products) — never RMB cost, never margins. The owner's audit spec
-- for a revision is selling-price-based (previous/new selling price and
-- transport assumptions). RLS is owner-inclusive + finance read.
--
-- Also:
--   pricing_settings           + 3 costing-validity thresholds (configurable
--                                per company — never hardcoded).
--   documents.costing_version_ack — the version Sales explicitly APPLIED or
--                                chose to KEEP; silences the "newer costing"
--                                prompt until an even newer version exists.
--   document_lines.source_component — 'product' | 'pole', stamped at
--                                generation so the selective apply never has
--                                to guess which approved price a line takes.
--   document_lines(source_project_request_id) index (m139 forgot it; the
--                                newer-costing emission scans by it).
--
-- Additive + idempotent.
-- =====================================================================

begin;

-- 1. Costing versions ---------------------------------------------------
create table if not exists project_costing_versions (
  id                  uuid primary key default gen_random_uuid(),
  project_request_id  uuid not null references project_requests(id) on delete cascade,
  version_no          integer not null,
  status              text not null default 'pending'
    check (status in ('pending','approved','superseded','cancelled')),
  -- selling snapshot (NEVER cost / margins)
  currency            text not null default 'USD',
  quantity            integer,
  pole_quantity       integer,
  product_unit_price  numeric,
  pole_unit_price     numeric,
  freight_total       numeric,
  -- freight breakdown snapshot in the DOCUMENT container shape
  -- ({container_type, quantity, unit_price, wooden_box_cost}) so a selective
  -- "update freight" can replace document_containers directly.
  containers          jsonb not null default '[]'::jsonb,
  -- transport assumptions snapshot
  incoterm            text,
  port_of_destination text,
  transport_mode      text,
  -- audit (one row = one request→approval cycle)
  requested_by        uuid references auth.users(id) on delete set null,
  requested_at        timestamptz,
  approved_by         uuid references auth.users(id) on delete set null,
  approved_at         timestamptz,
  reason              text,
  notes               text,
  previous_product_unit_price numeric,
  previous_pole_unit_price    numeric,
  previous_freight_total      numeric,
  created_at          timestamptz not null default now(),
  unique (project_request_id, version_no)
);

-- At most one open revision request per SR.
create unique index if not exists uq_pcv_one_pending
  on project_costing_versions(project_request_id)
  where status = 'pending';

create index if not exists idx_pcv_request_status
  on project_costing_versions(project_request_id, status);

alter table project_costing_versions enable row level security;

-- Owner-inclusive (selling prices only — mirrors m095 project_products) +
-- finance read (m098 precedent). NO DELETE policy: versions are append-only
-- history, never deleted (m091/m098 precedent).
drop policy if exists "pcv read" on project_costing_versions;
create policy "pcv read" on project_costing_versions for select using (
  exists (
    select 1 from project_requests pr
     where pr.id = project_costing_versions.project_request_id
       and (pr.owner_id = auth.uid() or pr.created_by = auth.uid()
            or exists (
              select 1 from user_roles r
               where r.user_id = auth.uid()
                 and (r.role in ('admin','task_list_manager','operations','sales_director','finance')
                      or coalesce(r.super_admin, false))
            ))
  )
);

drop policy if exists "pcv insert" on project_costing_versions;
create policy "pcv insert" on project_costing_versions for insert with check (
  exists (
    select 1 from project_requests pr
     where pr.id = project_costing_versions.project_request_id
       and (pr.owner_id = auth.uid() or pr.created_by = auth.uid()
            or exists (
              select 1 from user_roles r
               where r.user_id = auth.uid()
                 and (r.role in ('admin','task_list_manager','operations','sales_director','finance')
                      or coalesce(r.super_admin, false))
            ))
  )
);

drop policy if exists "pcv update" on project_costing_versions;
create policy "pcv update" on project_costing_versions for update using (
  exists (
    select 1 from project_requests pr
     where pr.id = project_costing_versions.project_request_id
       and (pr.owner_id = auth.uid() or pr.created_by = auth.uid()
            or exists (
              select 1 from user_roles r
               where r.user_id = auth.uid()
                 and (r.role in ('admin','task_list_manager','operations','sales_director','finance')
                      or coalesce(r.super_admin, false))
            ))
  )
);

-- 2. Backfill V1 from the current approved snapshot ---------------------
-- Every already-priced SR gets its history seeded: V1 'approved' with the
-- snapshot prices. coalesce() covers SRs priced BEFORE m139 (priced_at null).
insert into project_costing_versions (
  project_request_id, version_no, status,
  currency, quantity, pole_quantity,
  product_unit_price, pole_unit_price, freight_total,
  requested_by, requested_at, approved_by, approved_at,
  reason
)
select
  pp.project_request_id, 1, 'approved',
  coalesce(pp.currency, 'USD'), pp.quantity, pp.pole_quantity,
  pp.product_unit_price, pp.pole_unit_price, pp.freight_total,
  pp.priced_by, coalesce(pp.priced_at, pp.updated_at, pp.created_at),
  pp.priced_by, coalesce(pp.priced_at, pp.updated_at, pp.created_at),
  'Initial costing (backfilled at m140)'
from project_products pp
where not exists (
  select 1 from project_costing_versions v
   where v.project_request_id = pp.project_request_id
);

-- 3. Configurable validity thresholds (company policy, never hardcoded) --
alter table pricing_settings
  add column if not exists costing_aging_after_days int not null default 30,
  add column if not exists costing_expired_after_days int not null default 90,
  add column if not exists costing_require_revision_when_expired boolean not null default false;

-- 4. The version Sales explicitly applied/kept on a quotation ------------
alter table documents
  add column if not exists costing_version_ack uuid
    references project_costing_versions(id) on delete set null;

-- 5. Line-level component tag + missing m139 index -----------------------
alter table document_lines
  add column if not exists source_component text
    check (source_component in ('product','pole'));

create index if not exists idx_doc_lines_source_pr
  on document_lines(source_project_request_id);

insert into schema_migrations (filename, note)
values ('140_costing_versions.sql',
        'Costing Versions & Validity: project_costing_versions (V1..Vn inside the SR, pending->approved in-place, superseded history, selling prices only, owner-inclusive RLS, no delete) + backfill V1 from project_products; pricing_settings costing_aging_after_days/costing_expired_after_days/costing_require_revision_when_expired; documents.costing_version_ack (newer-costing prompt ack); document_lines.source_component (product|pole) + index on source_project_request_id. Validity derived at read time (freight-validity pattern m098).')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately, after apply):
--   -- Every priced SR has its V1:
--   select count(*) from project_products pp
--     where not exists (select 1 from project_costing_versions v
--                        where v.project_request_id = pp.project_request_id); -- expect 0
--   -- Thresholds present:
--   select costing_aging_after_days, costing_expired_after_days,
--          costing_require_revision_when_expired from pricing_settings;
--   -- New columns exist:
--   select costing_version_ack from documents limit 0;
--   select source_component from document_lines limit 0;
-- ---------------------------------------------------------------------
