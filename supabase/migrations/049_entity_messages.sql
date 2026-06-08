-- =====================================================================
-- m049 — Entity messages (contextual chatbox + operational requests).
-- =====================================================================
--
-- WHAT
-- ----
-- Adds a generic threaded message store attached to any operational
-- entity (document / task_list / production_order / client). Three use
-- cases live on the same table, distinguished by `message_kind`:
--
--   - 'comment'           : free-form chatbox message
--   - 'request'           : sales asks ops a structured question
--                           (packing_list / lead_time / shipping /
--                            ops_review), captured in `request_type`
--   - 'reply'             : free-text reply to a request
--   - 'structured_reply'  : machine-parseable answer (e.g. packing
--                           list breakdown), payload in `structured_payload`
--
-- Replies link back to the original request via `parent_message_id`,
-- and a request is "resolved" when `resolved_at` is set (any reply,
-- or explicit close).
--
-- A sibling `entity_message_reads` table tracks per-user last-seen
-- timestamps so we can compute unread counts cheaply.
--
-- RLS
-- ---
-- Same entity-ownership scoping pattern as m046 (events):
--   - admin / task_list_manager / operations / super → full visibility
--   - sales → only messages on entities they own (their docs, their
--     TLs/POs via documents.created_by, their clients via documents)
--
-- Writes are open to any signed-in user that can read the entity,
-- which mirrors event_comments (capabilities are enforced server-side
-- by the action layer).
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- =====================================================================
-- 1. TABLES
-- =====================================================================

create table if not exists entity_messages (
  id uuid primary key default gen_random_uuid(),

  entity_type text not null
    check (entity_type in ('document', 'task_list', 'production_order', 'client')),
  entity_id uuid not null,

  user_id uuid references auth.users(id) on delete set null,

  -- Free-text message. Optional when message_kind = 'structured_reply'
  -- (the payload carries the data) but typically populated as a human
  -- summary line shown in the thread.
  message text,

  message_kind text not null default 'comment'
    check (message_kind in ('comment', 'request', 'reply', 'structured_reply')),

  -- For 'request': one of a known set of operational requests so the
  -- UI can render the right reply form. Free-form 'comment' / 'reply'
  -- leave it null.
  request_type text
    check (
      request_type is null
      or request_type in (
        'packing_list',       -- "Can you estimate the packing list?"
        'lead_time',          -- "What's the realistic lead time?"
        'shipping_estimation',-- "Estimate freight + ETA"
        'ops_review'          -- "Please review this quote before I send it"
      )
    ),

  -- Structured payload for 'structured_reply'. Shape depends on the
  -- request_type of the parent message. Examples:
  --   packing_list: { total_cbm, recommended_containers, remaining_cbm,
  --                   mixed_loading_possible, notes, issues }
  --   lead_time:    { production_days, total_days, notes }
  -- Validated server-side by the action layer.
  structured_payload jsonb,

  parent_message_id uuid references entity_messages(id) on delete set null,

  -- Resolution metadata. A request is open until resolved_at is set.
  -- Once resolved, the chatbox shows it collapsed by default.
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now()
);

-- Per-user last-read timestamp, keyed on (user, entity). Updated each
-- time the user opens the chatbox for that entity; unread = count of
-- messages with created_at > last_read_at, authored by someone else.
create table if not exists entity_message_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null
    check (entity_type in ('document', 'task_list', 'production_order', 'client')),
  entity_id uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, entity_type, entity_id)
);

-- =====================================================================
-- 2. INDEXES
-- =====================================================================
-- Primary access pattern: "give me the thread for (entity_type, entity_id)
-- in chronological order". Secondary: unread counts by user across all
-- entities they can see (covered by per-entity scans + the reads table).

create index if not exists entity_messages_entity_idx
  on entity_messages (entity_type, entity_id, created_at);

create index if not exists entity_messages_parent_idx
  on entity_messages (parent_message_id)
  where parent_message_id is not null;

create index if not exists entity_messages_open_requests_idx
  on entity_messages (entity_type, entity_id)
  where message_kind = 'request' and resolved_at is null;

-- =====================================================================
-- 3. RLS — entity-ownership scoped (same shape as m046 events)
-- =====================================================================

alter table entity_messages enable row level security;
alter table entity_message_reads enable row level security;

-- Drop any prior versions so a re-run installs the canonical set.
drop policy if exists "em read scoped" on entity_messages;
drop policy if exists "em write scoped" on entity_messages;
drop policy if exists "em update scoped" on entity_messages;
drop policy if exists "em delete scoped" on entity_messages;

create policy "em read scoped" on entity_messages for select using (
  -- Technical / admin / super → full visibility.
  exists (
    select 1 from user_roles ur
     where ur.user_id = auth.uid()
       and (
         ur.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(ur.super_admin, false)
       )
  )
  -- Sales: scope by entity ownership (via documents.created_by).
  or (entity_type = 'document' and exists (
    select 1 from documents d
     where d.id = entity_id and d.created_by = auth.uid()
  ))
  or (entity_type = 'task_list' and exists (
    select 1 from production_task_lists tl
     join documents d on d.id = tl.quotation_id
     where tl.id = entity_id and d.created_by = auth.uid()
  ))
  or (entity_type = 'production_order' and exists (
    select 1 from production_orders po
     join documents d on d.id = po.quotation_id
     where po.id = entity_id and d.created_by = auth.uid()
  ))
  or (entity_type = 'client' and exists (
    select 1 from documents d
     where d.client_id = entity_id and d.created_by = auth.uid()
  ))
);

-- Insert: must be the author, AND must be able to read the entity
-- (re-uses the read predicate by referencing the same select-visibility
-- via an EXISTS over the recently-inserted row pattern is messy in
-- with-check; we instead require authored-by-self + delegate the
-- entity-visibility check to the server action). This mirrors how
-- event_comments handles it post-m046.
create policy "em write scoped" on entity_messages for insert
  with check (
    user_id = auth.uid()
    and auth.role() = 'authenticated'
  );

-- Update: only the author can edit their own message, OR technical
-- roles can resolve any request (resolved_at / resolved_by fields).
create policy "em update scoped" on entity_messages for update using (
  user_id = auth.uid()
  or exists (
    select 1 from user_roles ur
     where ur.user_id = auth.uid()
       and (
         ur.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(ur.super_admin, false)
       )
  )
);

-- Delete: admin / super-admin only (destructive — audit trail).
create policy "em delete scoped" on entity_messages for delete using (
  exists (
    select 1 from user_roles ur
     where ur.user_id = auth.uid()
       and (ur.role = 'admin' or coalesce(ur.super_admin, false))
  )
);

-- Reads table: each user manages their own row, no cross-user reads.
drop policy if exists "emr read self" on entity_message_reads;
drop policy if exists "emr write self" on entity_message_reads;
drop policy if exists "emr update self" on entity_message_reads;
drop policy if exists "emr delete self" on entity_message_reads;

create policy "emr read self" on entity_message_reads for select
  using (user_id = auth.uid());

create policy "emr write self" on entity_message_reads for insert
  with check (user_id = auth.uid());

create policy "emr update self" on entity_message_reads for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "emr delete self" on entity_message_reads for delete
  using (user_id = auth.uid());

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   -- 1. Tables exist
--   select table_name from information_schema.tables
--    where table_name in ('entity_messages', 'entity_message_reads');
--   -- Expected: 2 rows
--
--   -- 2. CHECK constraints
--   insert into entity_messages (entity_type, entity_id, message_kind, message)
--    values ('badtype', gen_random_uuid(), 'comment', 'x');
--   -- Expected: error (check constraint on entity_type)
--
--   insert into entity_messages (entity_type, entity_id, message_kind, message)
--    values ('document', gen_random_uuid(), 'badkind', 'x');
--   -- Expected: error (check constraint on message_kind)
--
--   -- 3. As a sales user, fetch messages on a doc you own (should work)
--   --    and a doc you don't own (should return 0).
-- ---------------------------------------------------------------------
