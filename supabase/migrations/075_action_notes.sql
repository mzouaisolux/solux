-- =====================================================================
-- m075 — Micro-operational notes attached to Action Center items.
-- =====================================================================
--
-- Lightweight contextual coordination — sales nudges ops, ops answers,
-- everyone sees the latest status on the card itself. NOT a chat system,
-- NOT a discussion thread; just short notes pinned to an action item so
-- the operational nervous system stops being deaf to WhatsApp updates.
--
-- The action_key follows the same shape used everywhere else
-- (`${kind}:${entity_id}`). Notes are scoped by RLS to authenticated
-- users (same pattern as action_acks); row-level visibility filtering
-- is done in the app layer where we already enforce role/scope on the
-- action items themselves.
--
-- Idempotent.
-- =====================================================================

create table if not exists action_notes (
  id uuid primary key default gen_random_uuid(),
  action_key text not null,
  -- Cross-link to the underlying entity for safety + future cleanup.
  entity_type text,
  entity_id uuid,
  body text not null check (char_length(body) > 0 and char_length(body) <= 2000),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_action_notes_key
  on action_notes (action_key, created_at desc);
create index if not exists idx_action_notes_entity
  on action_notes (entity_type, entity_id);

alter table action_notes enable row level security;

drop policy if exists action_notes_read on action_notes;
create policy action_notes_read on action_notes
  for select to authenticated using (true);

drop policy if exists action_notes_insert on action_notes;
create policy action_notes_insert on action_notes
  for insert to authenticated with check (true);

-- Only the author can delete their own note. (Edit is intentionally not
-- supported — a correction is a new note. Keeps the audit honest.)
drop policy if exists action_notes_delete on action_notes;
create policy action_notes_delete on action_notes
  for delete to authenticated using (
    created_by = auth.uid()
  );

notify pgrst, 'reload schema';
