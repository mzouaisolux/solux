-- =====================================================================
-- m141 — Deposit & Balance Invoicing (invoice families, additive island).
-- =====================================================================
--
-- WHY (owner spec 2026-07-03):
--   Sales must think in ONE commercial invoice per deal while accounting
--   still gets legally compliant invoices with unique sequential numbers.
--   The ERP computes deposit/balance amounts automatically from the
--   quotation's payment terms (payment_mode + payment_terms JSONB, m002)
--   and blocks any invoicing above the quotation total.
--
-- DESIGN — an ISOLATED additive subsystem, NOT the `documents` table
-- (same reasoning as m137 historical import):
--   1. `documents.type` is CHECK-constrained to ('quotation','proforma')
--      and every quotation-centric consumer (CA rollups, dashboards,
--      lifecycle stepper, launchProduction) assumes those two types.
--      Adding 'invoice' there would leak invoices into all of them.
--   2. The commercial pipeline is frozen (freeze/core-metier) — dedicated
--      tables guarantee structurally that no workflow code path changes.
--   3. An invoice here is a FINANCIAL slice of a won deal (one billing
--      line, e.g. "Deposit payment according to Quotation X"), not a
--      product document — it doesn't need document_lines/containers.
--
-- MODEL:
--   invoice_families  = the COMMERCIAL invoice (INV-1025) — one per source
--                       document (won quotation or proforma command).
--                       Snapshots number/client/total so it survives
--                       source deletion (legal invoices must not vanish).
--   invoices          = the LEGAL invoices inside a family, each with its
--                       own unique ACCOUNTING number (YYYY-NNNNN) —
--                       deposit / balance / full / custom / credit_note.
--   invoice_payments  = payment receipts per legal invoice (a ledger, so
--                       partial payments and history are first-class).
--
-- Amount conventions: `invoices.amount` is always POSITIVE; consumers
-- subtract credit_note rows (lib/invoicing.ts is the single computation
-- source). Ceiling rule (never invoice above the family total) is
-- enforced in the server action via lib/invoicing.ts — the DB keeps the
-- raw data auditable rather than encoding business math in triggers.
--
-- Idempotent. Self-registers in schema_migrations (m113 convention).
-- Apply manually in the Supabase SQL editor after backup, per convention.
-- =====================================================================

begin;

-- 1. invoice_families — the commercial invoice wrapper. ---------------------
create table if not exists invoice_families (
  id uuid primary key default gen_random_uuid(),
  commercial_number text not null unique,          -- INV-1025
  source_document_id uuid references documents(id) on delete set null,
  source_number text,                              -- snapshot (Q-2026-001)
  source_type text,                                -- 'quotation' | 'proforma'
  client_id uuid references clients(id) on delete set null,
  client_name text,                                -- snapshot
  affair_id uuid references affairs(id) on delete set null,
  total_amount numeric not null default 0,         -- invoicing CEILING (source total at creation)
  currency text,
  payment_mode text,                               -- snapshot of documents.payment_mode
  payment_terms jsonb,                             -- snapshot of documents.payment_terms
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
-- One family per source document (the "one commercial invoice" promise).
create unique index if not exists uq_invoice_families_source
  on invoice_families (source_document_id) where source_document_id is not null;
create index if not exists idx_invoice_families_client on invoice_families(client_id);
create index if not exists idx_invoice_families_affair on invoice_families(affair_id);

-- 2. invoices — the legal invoices (unique accounting sequence). ------------
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references invoice_families(id) on delete cascade,
  accounting_number text not null unique,          -- 2026-00458
  invoice_type text not null
    check (invoice_type in ('deposit','balance','full','custom','credit_note')),
  label text,                                      -- "30% Deposit", "Balance", …
  percent numeric,                                 -- informational milestone % (null for custom/credit)
  amount numeric not null check (amount > 0),      -- always positive; credit notes subtract in code
  line_description text,                           -- the single billing line shown on the invoice
  status text not null default 'draft'
    check (status in ('draft','sent','partially_paid','paid','overdue','cancelled')),
  issue_date date not null default current_date,
  due_date date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create index if not exists idx_invoices_family on invoices(family_id);
create index if not exists idx_invoices_status on invoices(status);

-- 3. invoice_payments — receipts ledger (partial payments supported). -------
create table if not exists invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount numeric not null check (amount > 0),
  paid_at date not null default current_date,
  method text,                                     -- free text: wire, LC, …
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_invoice_payments_invoice on invoice_payments(invoice_id);

-- 4. Numbering RPCs. ---------------------------------------------------------
-- SECURITY DEFINER: the max() scan must see ALL rows regardless of the
-- caller's RLS visibility, otherwise two sales users could both compute
-- the same next number (the unique constraint would reject the second,
-- but with a confusing error). Same "count over everything" need as the
-- sequences behind next_document_number.

-- Commercial reference: INV-1001, INV-1002, … (global, no year reset —
-- it's a file reference, not an accounting sequence).
create or replace function next_commercial_invoice_number() returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select coalesce(max((regexp_match(commercial_number, '^INV-(\d+)$'))[1]::int), 1000) + 1
  into n from invoice_families;
  return 'INV-' || n::text;
end; $$;

-- Accounting number: YYYY-NNNNN, strictly sequential PER YEAR (legal
-- compliance: unique, gapless-enough, resets each fiscal year).
create or replace function next_accounting_invoice_number() returns text
language plpgsql security definer set search_path = public as $$
declare
  yr text := to_char(now(), 'YYYY');
  n int;
begin
  select coalesce(max((regexp_match(accounting_number, '-(\d+)$'))[1]::int), 0) + 1
  into n from invoices where accounting_number like yr || '-%';
  return yr || '-' || lpad(n::text, 5, '0');
end; $$;

-- 5. RLS — mirror the m137 policy set: creator + technical/management roles
--    read & write; admin deletes. sales_director included (m132 see-all).
alter table invoice_families enable row level security;
alter table invoices         enable row level security;
alter table invoice_payments enable row level security;

-- invoice_families ----------------------------------------------------------
drop policy if exists "invoice_families read scoped" on invoice_families;
create policy "invoice_families read scoped" on invoice_families for select using (
  created_by = auth.uid()
  or exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('admin','task_list_manager','operations','sales_director') or coalesce(r.super_admin,false)))
);
drop policy if exists "invoice_families insert scoped" on invoice_families;
create policy "invoice_families insert scoped" on invoice_families for insert
  with check (created_by = auth.uid());
drop policy if exists "invoice_families update scoped" on invoice_families;
create policy "invoice_families update scoped" on invoice_families for update using (
  created_by = auth.uid()
  or exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('admin','task_list_manager','operations','sales_director') or coalesce(r.super_admin,false)))
);
drop policy if exists "invoice_families delete scoped" on invoice_families;
create policy "invoice_families delete scoped" on invoice_families for delete using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role = 'admin' or coalesce(r.super_admin,false)))
);

-- invoices — visibility follows the parent family. --------------------------
drop policy if exists "invoices read scoped" on invoices;
create policy "invoices read scoped" on invoices for select using (
  exists (select 1 from invoice_families f where f.id = family_id
      and (f.created_by = auth.uid()
           or exists (select 1 from user_roles r where r.user_id = auth.uid()
               and (r.role in ('admin','task_list_manager','operations','sales_director') or coalesce(r.super_admin,false)))))
);
drop policy if exists "invoices write scoped" on invoices;
create policy "invoices write scoped" on invoices for all using (
  exists (select 1 from invoice_families f where f.id = family_id
      and (f.created_by = auth.uid()
           or exists (select 1 from user_roles r where r.user_id = auth.uid()
               and (r.role in ('admin','task_list_manager','operations','sales_director') or coalesce(r.super_admin,false)))))
) with check (
  exists (select 1 from invoice_families f where f.id = family_id
      and (f.created_by = auth.uid()
           or exists (select 1 from user_roles r where r.user_id = auth.uid()
               and (r.role in ('admin','task_list_manager','operations','sales_director') or coalesce(r.super_admin,false)))))
);

-- invoice_payments — visibility follows the invoice's family. ---------------
drop policy if exists "invoice_payments read scoped" on invoice_payments;
create policy "invoice_payments read scoped" on invoice_payments for select using (
  exists (select 1 from invoices i join invoice_families f on f.id = i.family_id
      where i.id = invoice_id
      and (f.created_by = auth.uid()
           or exists (select 1 from user_roles r where r.user_id = auth.uid()
               and (r.role in ('admin','task_list_manager','operations','sales_director') or coalesce(r.super_admin,false)))))
);
drop policy if exists "invoice_payments write scoped" on invoice_payments;
create policy "invoice_payments write scoped" on invoice_payments for all using (
  exists (select 1 from invoices i join invoice_families f on f.id = i.family_id
      where i.id = invoice_id
      and (f.created_by = auth.uid()
           or exists (select 1 from user_roles r where r.user_id = auth.uid()
               and (r.role in ('admin','task_list_manager','operations','sales_director') or coalesce(r.super_admin,false)))))
) with check (
  exists (select 1 from invoices i join invoice_families f on f.id = i.family_id
      where i.id = invoice_id
      and (f.created_by = auth.uid()
           or exists (select 1 from user_roles r where r.user_id = auth.uid()
               and (r.role in ('admin','task_list_manager','operations','sales_director') or coalesce(r.super_admin,false)))))
);

-- 6. Self-register in the migration ledger ---------------------------------
insert into schema_migrations (filename, note)
values ('141_invoice_families.sql',
        'Deposit & Balance invoicing island: invoice_families (commercial INV-XXXX, snapshots + ceiling), invoices (legal, accounting YYYY-NNNNN per-year sequence, deposit/balance/full/custom/credit_note), invoice_payments ledger. Numbering RPCs security definer. RLS mirrors m137 (creator + technical + sales_director; admin deletes). Zero changes to the frozen documents pipeline.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately, after apply):
--   select next_commercial_invoice_number();   -- 'INV-1001'
--   select next_accounting_invoice_number();   -- '2026-00001'
--   select count(*) from invoice_families;     -- 0, table exists
--   select count(*) from invoices;             -- 0, table exists
--   select count(*) from invoice_payments;     -- 0, table exists
-- ---------------------------------------------------------------------
