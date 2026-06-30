-- =====================================================================
-- m123 — notification_rules (Phase 3C, archi A: read-time bell rules)
-- =====================================================================
--
-- Per-(role, event) channel OVERRIDE for the notification bell, resolved
-- at READ time (conforme Règle #0 — no materialized per-user table).
--
--   channel: 'bell' (ring the bell) | 'feed' (timeline/feed only) | 'off'
--            (suppress entirely)
--
-- This table stores ONLY overrides. An ABSENT (role, event_key) row =>
-- the legacy default (lib/notification-catalog.defaultChannel, identical
-- to eventRaisesBell). So this migration ships EMPTY and changes nothing
-- until a super-admin (or a SQL insert) adds a rule. Example to mute
-- deposit-received bells for sales:
--   insert into notification_rules (role, event_key, channel)
--   values ('sales','po.deposit_received','off');
--
-- Read: any authenticated user (the bell read-path needs it).
-- Write: admin / super_admin (like the permission matrix).
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

create table if not exists notification_rules (
  role        text not null,
  event_key   text not null,
  channel     text not null check (channel in ('bell', 'feed', 'off')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  primary key (role, event_key)
);

alter table notification_rules enable row level security;

drop policy if exists "notification_rules read" on notification_rules;
create policy "notification_rules read" on notification_rules for select
  using (auth.role() = 'authenticated');

drop policy if exists "notification_rules write" on notification_rules;
create policy "notification_rules write" on notification_rules for all
  using (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.super_admin = true or r.role = 'admin'))
  )
  with check (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.super_admin = true or r.role = 'admin'))
  );

-- Ships EMPTY on purpose — defaults reproduce today's behavior exactly.

insert into schema_migrations (filename, note)
values ('123_notification_rules.sql', 'Phase 3C — read-time per-role notification channel overrides (empty seed = no change)')
on conflict (filename) do nothing;

commit;
