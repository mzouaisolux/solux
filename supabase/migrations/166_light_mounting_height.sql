-- =====================================================================
-- m166 — Light Mounting Height as the PRIMARY height (feature #4)
-- =====================================================================
-- Terminology: the operative height for a solar luminaire is the distance
-- between the light and the ground (the "mounting height"), NOT the overall
-- pole height. This is the value the future AI Light Study consumes. We add it
-- as the primary field; the existing project_requests.pole_height is kept and
-- re-labelled in the UI as the SECONDARY "Overall pole height (if applicable)".
-- Idempotent — safe to run in the Supabase SQL Editor.
-- =====================================================================

alter table public.project_requests
  add column if not exists light_mounting_height text;

comment on column public.project_requests.light_mounting_height is
  'PRIMARY height: distance between the luminaire and the ground (mounting/light height), e.g. "6m". Feeds the Light Study. pole_height is the SECONDARY overall pole height.';

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('166_light_mounting_height.sql',
        'Light mounting height (project_requests.light_mounting_height text) — primary light-to-ground height for the Light Study; pole_height becomes the secondary overall pole height.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';
