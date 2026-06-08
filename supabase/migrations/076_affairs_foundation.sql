-- =====================================================================
-- m076 — Affairs foundation (Phase 1: ADDITIVE, non-breaking).
-- =====================================================================
--
-- Owner decision (2026-05-30): make AFFAIRS the primary entity — an
-- EXPLICIT CONTAINER (user-created, owned by a client, able to group
-- multiple distinct quotations/orders), rolled out STAGED & ADDITIVE.
--
-- This is PHASE 1 only — the database FOUNDATION. It:
--   • creates the `affairs` table (+ RLS on the NEW table only),
--   • adds a NULLABLE `affair_id` to documents / production_task_lists /
--     production_orders (ON DELETE SET NULL — deleting an affair must
--     NEVER delete documents/orders),
--   • adds a safe trigger so a revision inherits its family's affair,
--   • BACKFILLS one affair per existing quotation version-family.
--
-- It DOES NOT change any existing RLS, pages, forms, server actions,
-- navigation, workflows, numbering RPCs, or the attachments/events/
-- entity_messages tables. The application behaves identically whether or
-- not this migration has been applied (the new column/table are simply
-- ignored by current code).
--
-- Migrations are applied MANUALLY in Supabase. APPLY ONLY AFTER TAKING A
-- BACKUP / SNAPSHOT. Run the PRE-FLIGHT checks (bottom of file) first.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) affairs — standalone container (NOT tied 1:1 to a document).
-- ---------------------------------------------------------------------
create table if not exists affairs (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references clients(id) on delete set null,
  name         text not null default 'Untitled affair',
  status       text not null default 'open'
                 check (status in ('open', 'won', 'lost', 'abandoned', 'archived')),
  owner_id     uuid references auth.users(id) on delete set null,
  -- cleanup metadata (mandatory archive reason is enforced at the app layer
  -- in a later phase; the columns exist now so nothing changes when we wire it).
  archive_reason text,
  archived_by    uuid references auth.users(id) on delete set null,
  archived_at    timestamptz,
  created_by   uuid references auth.users(id) on delete set null,
  -- Backfill breadcrumb ONLY: maps a legacy version-family root document to
  -- the affair created for it. Lets this migration be re-run idempotently and
  -- lets later phases remap attachments. NOT used by the app.
  origin_root_document_id uuid references documents(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_affairs_client on affairs(client_id);
create index if not exists idx_affairs_owner on affairs(owner_id);
create unique index if not exists uq_affairs_origin_root
  on affairs(origin_root_document_id)
  where origin_root_document_id is not null;

-- ---------------------------------------------------------------------
-- 2) nullable affair_id links (ON DELETE SET NULL — never cascade docs).
-- ---------------------------------------------------------------------
alter table documents
  add column if not exists affair_id uuid references affairs(id) on delete set null;
alter table production_task_lists
  add column if not exists affair_id uuid references affairs(id) on delete set null;
alter table production_orders
  add column if not exists affair_id uuid references affairs(id) on delete set null;

create index if not exists idx_documents_affair on documents(affair_id);
create index if not exists idx_ptl_affair on production_task_lists(affair_id);
create index if not exists idx_po_affair on production_orders(affair_id);

-- ---------------------------------------------------------------------
-- 3) RLS on the NEW affairs table ONLY (mirrors clients m058; additive).
--    No existing table's RLS is touched.
-- ---------------------------------------------------------------------
alter table affairs enable row level security;

drop policy if exists "affairs read scoped" on affairs;
create policy "affairs read scoped" on affairs for select using (
  owner_id = auth.uid()
  or created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations')
            or coalesce(r.super_admin, false))
  )
  or exists (
    select 1 from documents d
     where d.affair_id = affairs.id
       and (d.created_by = auth.uid() or d.sales_owner_id = auth.uid())
  )
  or exists (
    select 1 from clients c
     where c.id = affairs.client_id
       and (c.created_by = auth.uid() or c.sales_owner_id = auth.uid())
  )
);

drop policy if exists "affairs insert scoped" on affairs;
create policy "affairs insert scoped" on affairs for insert with check (
  created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations')
            or coalesce(r.super_admin, false))
  )
);

drop policy if exists "affairs update scoped" on affairs;
create policy "affairs update scoped" on affairs for update using (
  owner_id = auth.uid()
  or created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations')
            or coalesce(r.super_admin, false))
  )
);

drop policy if exists "affairs delete scoped" on affairs;
create policy "affairs delete scoped" on affairs for delete using (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role = 'admin' or coalesce(r.super_admin, false))
  )
);

-- ---------------------------------------------------------------------
-- 4) Safe trigger — a revision inherits its root family's affair.
--    Only fires when affair_id is NULL and the doc is a revision; fresh
--    roots stay NULL (assigned by the Phase 2 UI). No behaviour change.
-- ---------------------------------------------------------------------
create or replace function affairs_inherit_from_root()
returns trigger language plpgsql as $$
begin
  if new.affair_id is null and new.root_document_id is not null then
    select d.affair_id into new.affair_id
      from documents d
     where d.id = new.root_document_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_documents_affair_inherit on documents;
create trigger trg_documents_affair_inherit
  before insert or update on documents
  for each row execute function affairs_inherit_from_root();

-- ---------------------------------------------------------------------
-- 5) BACKFILL — one affair per existing version-family (idempotent).
-- ---------------------------------------------------------------------
-- 5a) Create an affair for every family root. A "root" = a document with
--     root_document_id IS NULL: this captures true V1 roots AND orphaned
--     revisions whose root was deleted (root_document_id set to NULL by
--     m059's ON DELETE SET NULL) — both correctly become their own affair.
insert into affairs (
  client_id, name, status, owner_id, created_by, origin_root_document_id, created_at
)
select
  d.client_id,
  coalesce(nullif(btrim(d.affair_name), ''),
           'Affair ' || coalesce(d.number, left(d.id::text, 8))),
  case
    when exists (
      select 1 from documents f
       where coalesce(f.root_document_id, f.id) = d.id
         and f.status = 'won'
    ) then 'won'
    else 'open'
  end,
  coalesce(d.sales_owner_id, d.created_by),
  d.created_by,
  d.id,
  coalesce(d.date::timestamptz, now())
from documents d
where d.root_document_id is null
  and not exists (select 1 from affairs a where a.origin_root_document_id = d.id);

-- 5b) Link every document to its family's affair.
update documents d
   set affair_id = a.id
  from affairs a
 where a.origin_root_document_id = coalesce(d.root_document_id, d.id)
   and d.affair_id is null;

-- 5c) Propagate to task lists and production orders via the quotation link.
update production_task_lists ptl
   set affair_id = d.affair_id
  from documents d
 where d.id = ptl.quotation_id
   and ptl.affair_id is null;

update production_orders po
   set affair_id = d.affair_id
  from documents d
 where d.id = po.quotation_id
   and po.affair_id is null;

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- PRE-FLIGHT (run BEFORE applying — read-only; all should be benign):
--   -- families that span >1 client (should be 0; backfill uses the root's client):
--   select count(*) from (
--     select coalesce(root_document_id, id) r, count(distinct client_id) c
--       from documents group by 1
--   ) t where c > 1;
--   -- documents with no client (their affair gets client_id NULL — allowed):
--   select count(*) from documents where client_id is null;
--   -- snapshot:
--   select count(*) as documents from documents;
--
-- POST-CHECK (run AFTER applying):
--   select count(*) from affairs;                                  -- = # of distinct family roots
--   select count(*) from documents            where affair_id is null;  -- expect 0 (pre-existing docs)
--   select count(*) from production_task_lists where affair_id is null and quotation_id is not null;
--   select count(*) from production_orders     where affair_id is null and quotation_id is not null;
--   -- spot-check a known multi-version family maps to ONE affair:
--   select affair_id, count(*) from documents
--    where root_document_id = '<a known V1 id>' or id = '<a known V1 id>'
--    group by affair_id;
--
-- ROLLBACK (fully reversible — affair_id is net-new, no existing data mutated):
--   drop trigger if exists trg_documents_affair_inherit on documents;
--   drop function if exists affairs_inherit_from_root();
--   alter table documents            drop column if exists affair_id;
--   alter table production_task_lists drop column if exists affair_id;
--   alter table production_orders     drop column if exists affair_id;
--   drop table if exists affairs;
--   notify pgrst, 'reload schema';
-- =====================================================================
