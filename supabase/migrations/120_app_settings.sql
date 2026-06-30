-- =====================================================================
-- m120 — app_settings: tunable product thresholds (Phase 2 dashboard)
-- =====================================================================
--
-- Locked dashboard spec (PLAN_CRM_SOLUX §11 étape 2): the PREVENTIVE
-- window ("ETA proche", "deadline prod proche", "devis sans réponse",
-- "affaire endormie") is an ADMIN SETTING, default 7 days, never
-- hardcoded. One tiny key/value store — no per-feature tables.
--
--   key 'dashboard.preventive_days' → {"value": 7}
--
-- Read: any authenticated user (the dashboard computes with it).
-- Write: admin / super_admin only.
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table app_settings enable row level security;

drop policy if exists "app_settings read" on app_settings;
create policy "app_settings read" on app_settings for select
  using (auth.role() = 'authenticated');

drop policy if exists "app_settings write" on app_settings;
create policy "app_settings write" on app_settings for all
  using (
    exists (
      select 1 from user_roles r
       where r.user_id = auth.uid() and r.role in ('admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1 from user_roles r
       where r.user_id = auth.uid() and r.role in ('admin', 'super_admin')
    )
  );

-- Default seed — the locked spec default. Update via the admin UI.
insert into app_settings (key, value)
values ('dashboard.preventive_days', '{"value": 7}'::jsonb)
on conflict (key) do nothing;

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('120_app_settings.sql', 'app_settings — tunable product thresholds (dashboard preventive window)')
on conflict (filename) do nothing;

commit;
