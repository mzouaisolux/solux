-- =====================================================================
-- m045 — Per-user read state for operational events.
-- =====================================================================
--
-- Adds the bookkeeping required to turn the comment threads into a
-- proper conversation-aware system: each user has a `last_read_at`
-- timestamp per event. Unread = there exists a comment on the event
-- with `created_at > last_read_at`.
--
-- Why a side-table (not events.read_by jsonb)
-- -------------------------------------------
-- Keeping per-user read state on the events row would force every
-- read to UPDATE the event itself, generating noise in the audit log
-- and risking lock contention as the team scales. A dedicated table
-- with (user_id, event_id) primary key is the canonical pattern —
-- O(1) lookups, granular RLS, no event row touched.
--
-- RLS
-- ---
-- A user can only see / write their OWN read rows. Sales can't peek
-- at whether the ops manager has read a particular event; admins
-- could go through SECURITY DEFINER if we ever want a "read receipt
-- audit" feature, but at this stage the read state is purely
-- personal.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

create table if not exists event_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

-- Index for the hot "show me my unread events" query.
create index if not exists idx_event_reads_user_recent
  on event_reads (user_id, last_read_at desc);

-- RLS — personal only.
alter table event_reads enable row level security;

drop policy if exists "er_select_own" on event_reads;
create policy "er_select_own" on event_reads
  for select using (user_id = auth.uid());

drop policy if exists "er_insert_own" on event_reads;
create policy "er_insert_own" on event_reads
  for insert with check (user_id = auth.uid());

drop policy if exists "er_update_own" on event_reads;
create policy "er_update_own" on event_reads
  for update using (user_id = auth.uid());

drop policy if exists "er_delete_own" on event_reads;
create policy "er_delete_own" on event_reads
  for delete using (user_id = auth.uid());

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   -- 1. Table exists
--   select count(*) from event_reads;
--   -- Expected: 0
--
--   -- 2. Indexes present
--   select indexname from pg_indexes where tablename = 'event_reads';
--   -- Expected: event_reads_pkey, idx_event_reads_user_recent
--
--   -- 3. RLS enabled
--   select relrowsecurity from pg_class where relname = 'event_reads';
--   -- Expected: t
-- ---------------------------------------------------------------------
