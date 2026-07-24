-- =====================================================================
-- m165 — Integrations Phase 1: user_channels (per-rep click-to-chat handles).
-- =====================================================================
-- PLAN_INTEGRATIONS.md §3.2. Each rep registers their own Zalo / WhatsApp /
-- Telegram handle; client contact cards then render "chat via <rep>" deep
-- links from these + the contact's phone.
--
-- RLS:
--   • read  — any authenticated user (supervisors render "contact via rep X").
--   • write — only your own rows (`user_id = auth.uid()`). Nobody edits another
--             user's handles through the UI, including super_admin (support
--             fixes happen in the DB, audited).
--
-- Additive + idempotent. Safe to re-run.
-- =====================================================================

begin;

create table if not exists user_channels (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  channel    text not null check (channel in ('zalo','whatsapp','telegram')),
  handle     text not null,
  is_active  boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, channel)
);

alter table user_channels enable row level security;

-- read — any authenticated user.
drop policy if exists "user_channels read" on user_channels;
create policy "user_channels read" on user_channels for select to authenticated using (true);

-- write — your own rows only.
drop policy if exists "user_channels write" on user_channels;
create policy "user_channels write" on user_channels for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

insert into schema_migrations (filename, note)
values ('188_user_channels.sql',
        'Integrations Phase 1: user_channels (per-rep click-to-chat handles) + RLS — read for any authenticated user, write restricted to own rows.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;
