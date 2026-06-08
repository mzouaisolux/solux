-- =====================================================================
-- m043 — Quotation reminders (personal sales follow-up tickler)
-- =====================================================================
--
-- Lets a sales user attach "remind me on date X" notes to a quotation
-- so deals don't slip through the cracks during the sent → won/lost
-- window.
--
-- Design choices (per user spec, Dashboard Phase 3):
--   - Personal: only the creator (+ admins / super-admins) can read,
--     update or delete a reminder. Each sales has their own tickler;
--     they don't see each other's reminders.
--   - Manual creation only (no auto-reminder cron at this stage).
--   - Snooze / Reschedule / Done / Cancel — all logged via a status
--     transition + audit timestamps on the same row.
--   - `remind_at` is a DATE (no time-of-day). Sales follow-ups are
--     daily granularity at most; this keeps the "is due" query
--     timezone-trivial (remind_at <= current_date).
--
-- Surfaces fed by this table:
--   - Document detail page (picker + list of active reminders).
--   - Dashboard "My reminders" panel (Business + Operations slots).
--   - Operations Feed (due reminders block above the events table).
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------- 1. Table ----------
create table if not exists quotation_reminders (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Day the reminder should surface (00:00 local — granularity is
  -- intentionally coarse). DATE rather than timestamptz so the "is
  -- due" check stays timezone-free.
  remind_at date not null,
  -- Free-text note ("Follow up on container revision", etc.).
  note text,
  -- Lifecycle. Snooze updates remind_at + bumps snooze_count, but
  -- leaves status='open' — it's not a terminal transition.
  status text not null default 'open'
    check (status in ('open', 'done', 'cancelled')),
  done_at timestamptz,
  done_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  -- Snooze tracking — useful to surface chronically-snoozed deals
  -- ("snoozed 5+ times" = strong signal the deal is rotting).
  snooze_count integer not null default 0,
  last_snoozed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- 2. Indexes ----------
-- Hot path 1: the dashboard "My reminders" panel asks for "this user's
-- open reminders sorted by date". Partial index keeps it tight as
-- closed reminders accumulate.
create index if not exists idx_qr_user_open
  on quotation_reminders (user_id, remind_at)
  where status = 'open';

-- Hot path 2: the document detail page asks "any reminders on this
-- doc?" (for the badge + list). Cheap composite covers most filters.
create index if not exists idx_qr_doc
  on quotation_reminders (document_id, status, remind_at);

-- ---------- 3. updated_at trigger ----------
create or replace function quotation_reminders_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_qr_updated_at on quotation_reminders;
create trigger trg_qr_updated_at
  before update on quotation_reminders
  for each row execute function quotation_reminders_set_updated_at();

-- ---------- 4. RLS — personal + admin override ----------
-- Per Phase 3 spec ("Personnel · créateur uniquement"):
--   - SELECT  : owner OR admin/super-admin
--   - INSERT  : self only (user_id = auth.uid())
--   - UPDATE  : owner OR admin/super-admin
--   - DELETE  : owner OR admin/super-admin
--
-- Admin override exists so super-admin can clean up orphaned/stale
-- reminders without needing a service-role connection. Sales users
-- never see each other's data.
alter table quotation_reminders enable row level security;

drop policy if exists "qr_read_own_or_admin" on quotation_reminders;
create policy "qr_read_own_or_admin" on quotation_reminders
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from user_roles ur
       where ur.user_id = auth.uid()
         and (ur.role = 'admin' or coalesce(ur.super_admin, false))
    )
  );

drop policy if exists "qr_insert_self" on quotation_reminders;
create policy "qr_insert_self" on quotation_reminders
  for insert with check (user_id = auth.uid());

drop policy if exists "qr_update_own_or_admin" on quotation_reminders;
create policy "qr_update_own_or_admin" on quotation_reminders
  for update using (
    user_id = auth.uid()
    or exists (
      select 1 from user_roles ur
       where ur.user_id = auth.uid()
         and (ur.role = 'admin' or coalesce(ur.super_admin, false))
    )
  );

drop policy if exists "qr_delete_own_or_admin" on quotation_reminders;
create policy "qr_delete_own_or_admin" on quotation_reminders
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from user_roles ur
       where ur.user_id = auth.uid()
         and (ur.role = 'admin' or coalesce(ur.super_admin, false))
    )
  );

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   -- 1. Table exists
--   select count(*) from quotation_reminders;
--   -- Expected: 0
--
--   -- 2. Check constraint accepts the 3 statuses
--   insert into quotation_reminders (document_id, user_id, remind_at, status)
--   values (gen_random_uuid(), auth.uid(), current_date, 'bogus');
--   -- Expected: error "violates check constraint"
--
--   -- 3. Indexes present
--   select indexname from pg_indexes where tablename = 'quotation_reminders';
--   -- Expected: idx_qr_user_open, idx_qr_doc, plus pkey.
-- ---------------------------------------------------------------------
