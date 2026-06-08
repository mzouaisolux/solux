-- =====================================================================
-- 083 — Config field UX clarity: new columns for explicit workflows.
--
-- Adds the minimal columns needed to support the redesigned
-- "Behavior & Visibility" admin UI:
--
--   1. field_scope: add 'both' — field is editable by both sales AND
--      technical (shown in both the quotation builder and TL review).
--
--   2. required_for_production (boolean, default false) — marks the
--      field as mandatory before a production order can be released.
--      Runtime enforcement is a future step; this is the stored flag.
--
--   3. visible_in_factory (boolean, default true) — controls whether
--      the field appears on the factory-facing document. Defaults to
--      true (same as the pre-migration behavior where factory always
--      sees what the task list sees).
--
--   4. access_level ('everyone'|'internal'|'admin', default 'everyone')
--      — replaces the boolean `internal_only` with a 3-value enum.
--      Backfilled from internal_only so nothing changes for existing
--      data. `internal_only` is kept in sync for backward compat.
--
-- Idempotent — safe to re-run.
-- =====================================================================

-- 1. field_scope: allow 'both'
alter table config_fields
  drop constraint if exists config_fields_field_scope_check;
alter table config_fields
  add constraint config_fields_field_scope_check
  check (field_scope in ('sales', 'technical', 'both'));

-- 2. required_for_production
alter table config_fields
  add column if not exists required_for_production boolean not null default false;

-- 3. visible_in_factory (defaults to true — same as current behavior)
alter table config_fields
  add column if not exists visible_in_factory boolean not null default true;

-- 4. access_level enum
alter table config_fields
  add column if not exists access_level text not null default 'everyone';
alter table config_fields
  drop constraint if exists config_fields_access_level_check;
alter table config_fields
  add constraint config_fields_access_level_check
  check (access_level in ('everyone', 'internal', 'admin'));

-- Backfill from internal_only → access_level
update config_fields
  set access_level = 'internal'
  where internal_only = true and access_level = 'everyone';

notify pgrst, 'reload schema';
