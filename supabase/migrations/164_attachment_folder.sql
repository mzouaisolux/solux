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
