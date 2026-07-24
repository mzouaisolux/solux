-- =====================================================================
-- m170 — Integrations: reusable message templates.
-- =====================================================================
-- Shared, workspace-level snippets (greeting, quote follow-up, spec cover
-- note…) the send composers pull from. Body is plain text with {{tokens}}
-- (e.g. {{company}}, {{product}}, {{version}}) substituted from context when a
-- rep applies one; unknown tokens are left as-is for manual editing.
--
-- RLS:
--   • read   — any authenticated user (every rep can use templates).
--   • write  — admin-like only (mirrors api_keys / webhook_endpoints); the
--              actions additionally requireCapability('integration.manage').
-- Additive + idempotent.
-- =====================================================================

begin;

create table if not exists message_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null default 'general'
               check (kind in ('general','greeting','quote_follow_up','spec_cover')),
  body       text not null default '',
  is_active  boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_message_templates_active on message_templates(is_active, kind);

alter table message_templates enable row level security;

drop policy if exists "message_templates read" on message_templates;
create policy "message_templates read" on message_templates for select to authenticated using (true);

drop policy if exists "message_templates write" on message_templates;
create policy "message_templates write" on message_templates for all to authenticated
  using (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.role = 'admin' or coalesce(r.super_admin, false)))
  )
  with check (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.role = 'admin' or coalesce(r.super_admin, false)))
  );

insert into schema_migrations (filename, note)
values ('193_message_templates.sql',
        'Integrations: message_templates (reusable snippets with {{tokens}}) — read by any authenticated, write admin-like.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;
