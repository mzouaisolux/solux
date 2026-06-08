-- =====================================================================
-- m069 — Action Center acknowledgements (follow-up items).
-- =====================================================================
--
-- The Action Center derives items LIVE from state (no stored feed). Most
-- items are "action required" — they vanish the moment the underlying work
-- is done. But "follow-up / awareness" items (production delayed, awaiting
-- balance, shipment issue…) aren't a system workflow — a human just needs to
-- be AWARE and follow up. Those shouldn't vanish on click; instead they can
-- be ACKNOWLEDGED.
--
-- An acknowledgement says "someone has seen this and is on it". The item then
-- stays visible but dims ("Acknowledged by Mehdi · 2h ago"), and only truly
-- disappears when the real condition resolves (delay cleared, balance paid,
-- shipment completed) — at which point the engine simply stops deriving it.
--
-- Keyed by the action's STABLE identity (its derived id, e.g. "pastdue:{poId}"),
-- so the ack reconnects to the same action across reloads. One ack per action
-- (team-wide): whoever acknowledges it owns the follow-up. Orphaned acks (for
-- actions that have since resolved) are harmless and can be pruned later.
--
-- Idempotent.
-- =====================================================================

create table if not exists action_acks (
  action_key text primary key,
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz not null default now(),
  -- 'acknowledged' = seen / on it (dims, stays). 'done' = manually cleared
  -- from the list (hidden until the condition recurs as a new action).
  state text not null default 'acknowledged',
  note text
);

-- If action_acks pre-existed (m069 applied before `state` was added), add it.
alter table action_acks
  add column if not exists state text not null default 'acknowledged';

alter table action_acks enable row level security;

-- Acknowledgements are a shared operational signal: any authenticated user
-- may read them and acknowledge / clear an item. (Visibility of the
-- underlying ACTION is already enforced by the engine + RLS on the source
-- rows; this table only stores the "seen / on it" marker.)
drop policy if exists action_acks_read on action_acks;
create policy action_acks_read on action_acks
  for select to authenticated using (true);

drop policy if exists action_acks_insert on action_acks;
create policy action_acks_insert on action_acks
  for insert to authenticated with check (true);

drop policy if exists action_acks_update on action_acks;
create policy action_acks_update on action_acks
  for update to authenticated using (true) with check (true);

drop policy if exists action_acks_delete on action_acks;
create policy action_acks_delete on action_acks
  for delete to authenticated using (true);

notify pgrst, 'reload schema';
