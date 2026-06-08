-- 099_order_documents.sql
--
-- Order Documents hub (Solux Hub): each production order becomes the single
-- source of truth for all project documents — uploaded straight into the order
-- instead of scattered across email / WeChat / WhatsApp / Drive / local disks.
--
-- Collaborative by design (adoption > governance): ANY authenticated user can
-- upload / replace / archive / restore. Governance lives in the data, not in
-- blocks: full version history (group_id + version), an append-only audit
-- trail, and SOFT delete (archived_at) with restore. Files live in the
-- existing `documents` storage bucket under orders/<orderId>/…
--
-- Idempotent. Run in Supabase SQL Editor.

begin;

-- ---------------------------------------------------------------------------
-- 1. order_documents — one row PER VERSION. A logical document is the set of
--    rows sharing a group_id; the current version is the highest `version`.
--    Replacing a document inserts a new row (same group_id, version+1) so the
--    full history is preserved. Soft delete sets archived_at on the group.
-- ---------------------------------------------------------------------------
create table if not exists order_documents (
  id                  uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references production_orders(id) on delete cascade,
  group_id            uuid not null,            -- logical document (stable across versions)
  version             int  not null default 1,
  name                text not null,            -- original filename (display)
  storage_path        text not null,            -- path in the `documents` bucket
  file_size           bigint,
  mime_type           text,
  category            text not null default 'other', -- production | shipping | financial | other
  uploaded_by         uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  archived_at         timestamptz,              -- soft delete (group-level)
  archived_by         uuid references auth.users(id) on delete set null
);
create index if not exists idx_order_documents_order on order_documents(production_order_id, created_at desc);
create index if not exists idx_order_documents_group on order_documents(group_id, version desc);

-- ---------------------------------------------------------------------------
-- 2. order_document_audit — append-only trail of who did what, when.
-- ---------------------------------------------------------------------------
create table if not exists order_document_audit (
  id                  uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references production_orders(id) on delete cascade,
  document_group_id   uuid,
  action              text not null,  -- 'upload' | 'replace' | 'archive' | 'restore'
  file_name           text,
  actor               uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists idx_order_doc_audit_order on order_document_audit(production_order_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. RLS — collaborative. Any authenticated user can read/write documents;
--    the audit is read-all + insert-all, no update/delete → append-only.
-- ---------------------------------------------------------------------------
alter table order_documents      enable row level security;
alter table order_document_audit enable row level security;

drop policy if exists "order_documents all" on order_documents;
create policy "order_documents all" on order_documents for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "order_document_audit read" on order_document_audit;
create policy "order_document_audit read" on order_document_audit for select
  using (auth.uid() is not null);

drop policy if exists "order_document_audit insert" on order_document_audit;
create policy "order_document_audit insert" on order_document_audit for insert
  with check (auth.uid() is not null);

notify pgrst, 'reload schema';

commit;
