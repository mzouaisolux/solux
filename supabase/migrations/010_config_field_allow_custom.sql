-- Config field UX upgrade: opt-in "Allow custom value" toggle for dropdown fields.
-- When enabled, sales users can pick a predefined option OR type a free value.
-- The custom value is stored in the same config_values JSONB column — the
-- only thing this flag controls is whether the UI exposes the free-text input.
--
-- Run in Supabase SQL Editor. Idempotent.

begin;

alter table public.config_fields
  add column if not exists allow_custom_value boolean not null default false;

notify pgrst, 'reload schema';

commit;
