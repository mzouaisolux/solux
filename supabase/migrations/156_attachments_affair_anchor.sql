-- =====================================================================
-- m156 — attachments anchored on the REAL affair id (backfill + RLS).
-- =====================================================================
--
-- BUG (owner report 2026-07-08, OIM Malanville): uploaded project files
-- disappeared from the affair Documents tab. Root cause: the anchor
-- convention of attachments.affair_id changed over time —
--   m060 era   : version-chain root document id (root_document_id ?? id)
--   post-5307c : the REAL affairs.id (affair_id = single source of truth)
-- The readers were moved to the new anchor while every existing row (and
-- the write path) still carried the old one → every legacy upload became
-- invisible on the affair pages.
--
-- The app-side fix (same commit as this migration) makes every reader
-- match the FULL anchor candidate set, so files are visible again even
-- BEFORE this migration runs. This migration then converges the data:
--
--   1. BACKFILL — point attachments.affair_id at the real affairs.id
--      whenever it is resolvable through the documents table (anchor =
--      a document id or a version-chain root of a document that carries
--      an affair_id).
--   2. RLS — the m060 read policy only follows document anchors
--      (d.id / d.root_document_id = attachments.affair_id); add the
--      d.affair_id arm so document creators (sales) still see the
--      affair-anchored rows. Technical roles were already unrestricted.
--   3. LEDGER — self-insert (m113 rule). The app's write path probes
--      this ledger row: BEFORE it exists, new uploads keep the legacy
--      anchor (so a sales rep's fresh upload never disappears for them);
--      AFTER, new uploads write the real affair id.
--
-- NOT COVERED: 8 orphan anchors (15 files) whose anchor document was
-- deleted before any affair link existed — unresolvable by join; they
-- keep their current anchor and stay visible through the app-side
-- candidate-set matching only if a matching document reappears. See
-- docs/attachments-orphans-2026-07-08.md for the inventory.
--
-- Idempotent. Safe to re-run. Apply manually in the Supabase SQL editor.
-- =====================================================================

begin;

-- 1) Backfill: resolve the real affair id through the documents table.
update attachments a
   set affair_id = sub.affair_id
  from (
    select distinct on (anchor) anchor, affair_id
      from (
        select d.id as anchor, d.affair_id
          from documents d
         where d.affair_id is not null
        union all
        select d.root_document_id as anchor, d.affair_id
          from documents d
         where d.affair_id is not null
           and d.root_document_id is not null
      ) x
     order by anchor, affair_id
  ) sub
 where a.affair_id = sub.anchor
   and a.affair_id is distinct from sub.affair_id;

-- 2) RLS: add the affair-anchor arm for document creators.
drop policy if exists "attachments read scoped" on attachments;
create policy "attachments read scoped" on attachments for select using (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (
         r.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(r.super_admin, false)
       )
  )
  or exists (
    select 1 from documents d
     where (
         d.id = attachments.affair_id
         or d.root_document_id = attachments.affair_id
         or d.affair_id = attachments.affair_id
       )
       and d.created_by = auth.uid()
  )
);

-- 3) Ledger (m113 rule) — the app's write path probes this exact row.
insert into schema_migrations (filename, note)
values ('156_attachments_affair_anchor.sql',
        'Attachments anchored on the real affairs.id: backfill legacy chain-root anchors + RLS arm on d.affair_id. Write path switches to the real affair id once this row exists.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   -- 0 rows should still carry a resolvable legacy anchor:
--   select count(*) from attachments a
--    where not exists (select 1 from affairs f where f.id = a.affair_id)
--      and exists (select 1 from documents d
--                   where (d.id = a.affair_id or d.root_document_id = a.affair_id)
--                     and d.affair_id is not null);
--   -- policy present:
--   select policyname from pg_policies
--    where schemaname='public' and tablename='attachments';
-- ---------------------------------------------------------------------
