-- =====================================================================
-- 082 — Add checkbox_group to config_fields.field_type check constraint.
--
-- The original constraint (migration 009) only permitted:
--   dropdown | text | number | checkbox | textarea
-- This migration drops and recreates it to include checkbox_group,
-- which stores a JSON array of selected option values (string[]).
-- =====================================================================

alter table config_fields
  drop constraint if exists config_fields_field_type_check;

alter table config_fields
  add constraint config_fields_field_type_check
  check (field_type in ('dropdown','text','number','checkbox','textarea','checkbox_group'));
