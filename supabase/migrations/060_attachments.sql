-- =====================================================================
-- m060 — Project attachments (affair-level files).
-- =====================================================================
--
-- The quotation code alone is NOT enough in our business: projects carry
-- custom dimensions, panel sizes, tender requirements, inspection
-- drawings, packaging artwork, etc. Missing or confused documents have
-- caused real production mistakes. This adds a file-attachment store
-- linked to the AFFAIR (the quotation's root_document_id), so every
-- version + the task list of the same project share the same files.
--
-- Files live in the existing private `documents` Storage bucket under an
-- `attachments/<affair_id>/…` prefix (reuses the proven upload + signed-
-- URL flow used for PDFs — no new bucket / storage policy needed).
--
-- Visibility flags (visible_sales / ops / factory / client) are stored
-- now for a clean future-proof structure. They are NOT enforced yet —
-- read access is currently scoped by affair ownership (same model as
-- documents/m046). We can layer per-audience filtering on later without
-- a schema change.
--
-- Deliberately lightweight: no OCR, no parsing, no approval workflow.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

create table if not exists attachments (
  id            uuid primary key default gen_random_uuid(),
  -- Affair anchor = the root document id of the quotation family.
  affair_id     uuid not null,
  -- Path inside the `documents` Storage bucket.
  storage_path  text not null,
  file_name     text not null,
  file_size     bigint,
  mime_type     text,
  attachment_type text not null default 'other'
    check (attachment_type in (
      'tender',
      'technical_spec',
      'mechanical_drawing',
      'inspection',
      'dimension_drawing',
      'approved_doc',
      'packaging_artwork',
      'logo',
      'rendering',
      'photo',
      'dialux',
      'special_instructions',
      'other'
    )),
  note          text,
  -- Audience visibility — structure prepared now, enforcement later.
  visible_sales   boolean not null default true,
  visible_ops     boolean not null default true,
  visible_factory boolean not null default true,
  visible_client  boolean not null default false,
  uploaded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists attachments_affair_idx
  on attachments (affair_id, created_at);

-- ---------------------------------------------------------------------
-- RLS — affair-ownership scoped (mirrors documents/m046).
-- ---------------------------------------------------------------------
alter table attachments enable row level security;

drop policy if exists "attachments read scoped" on attachments;
create policy "attachments read scoped" on attachments for select using (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (
         r.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(r.super_admin, false)
       )
  )
  or exists (
    select 1 from documents d
     where (d.id = attachments.affair_id or d.root_document_id = attachments.affair_id)
       and d.created_by = auth.uid()
  )
);

drop policy if exists "attachments insert scoped" on attachments;
create policy "attachments insert scoped" on attachments for insert
  with check (uploaded_by = auth.uid());

drop policy if exists "attachments update scoped" on attachments;
create policy "attachments update scoped" on attachments for update using (
  uploaded_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (
         r.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(r.super_admin, false)
       )
  )
);

drop policy if exists "attachments delete scoped" on attachments;
create policy "attachments delete scoped" on attachments for delete using (
  uploaded_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (
         r.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(r.super_admin, false)
       )
  )
);

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select to_regclass('public.attachments');         -- not null
--   select policyname from pg_policies
--    where schemaname='public' and tablename='attachments';
--   -- Expected: read / insert / update / delete scoped
-- ---------------------------------------------------------------------
