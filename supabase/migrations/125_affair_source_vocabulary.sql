-- =====================================================================
-- m125 — Affair source vocabulary v2 (commercial ORIGIN of a deal).
-- =====================================================================
--
-- Owner decision (2026-06-17, CRM UX refactor): the affair "source" must
-- describe the ORIGIN of the opportunity, not the relationship. The old
-- list (m102: tender / field / existing_client / other) mixed the two —
-- "existing_client" is a relationship, not an origin, and is meaningless
-- inside a Client Workspace. New vocabulary (9 values):
--
--   tender, prospecting, referral, existing_customer_opportunity,
--   partner, website_inquiry, exhibition_event, direct_request, other
--
-- Steps (one transaction):
--   1. Drop the m102 CHECK so existing rows can be remapped freely.
--   2. Remap existing values:
--        existing_client → existing_customer_opportunity
--        field           → prospecting      ← judgment call; see note.
--        tender / other  → unchanged.    null → null (still allowed).
--   3. Install the new CHECK (null still allowed — untagged affairs stay).
--
--   NOTE on `field`: m102 defined it as "a lead caught by a salesperson's
--   relationship". The closest new value is `prospecting` (field / outbound
--   sales). To map it to `referral` instead, change the marked line below
--   BEFORE running. Run the PRE-FLIGHT (bottom) first to see how many
--   `field` / `existing_client` rows you actually have.
--
-- Pairs with the app change (same step): AFFAIR_SOURCE_OPTIONS in
-- components/affairs/affair-sources.ts and AFFAIR_SOURCES in
-- app/(app)/affairs/actions.ts. APPLY THIS MIGRATION BEFORE serving the
-- new code, or affair creation could post a value the old CHECK rejects.
-- (The app retries without source as a safety net, but applying first is
-- the clean path.)
--
-- Idempotent & safe to re-run. Apply MANUALLY in Supabase after a backup.
-- =====================================================================

begin;

alter table affairs drop constraint if exists affairs_source_check;

update affairs set source = 'existing_customer_opportunity'
 where source = 'existing_client';

update affairs set source = 'prospecting'        -- change to 'referral' if preferred
 where source = 'field';

alter table affairs add constraint affairs_source_check
  check (source is null or source in (
    'tender',
    'prospecting',
    'referral',
    'existing_customer_opportunity',
    'partner',
    'website_inquiry',
    'exhibition_event',
    'direct_request',
    'other'
  ));

insert into schema_migrations (filename, note)
values ('125_affair_source_vocabulary.sql',
        'affair source vocabulary v2 (9 values; existing_client->existing_customer_opportunity, field->prospecting)')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- PRE-FLIGHT (run SEPARATELY, BEFORE the transaction — shows what will be
-- remapped; decide the `field` mapping from this):
--   select coalesce(source, '(null)') as source, count(*)
--     from affairs group by 1 order by 2 desc;
--
-- POST-CHECK (run AFTER — expect zero rows on the old vocabulary):
--   select source, count(*) from affairs
--    where source in ('field', 'existing_client') group by 1;       -- expect none
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'affairs'::regclass and conname = 'affairs_source_check';
--   select * from schema_migrations where filename like '125!_%' escape '!';
--
-- ROLLBACK (restores the m102 vocabulary + check; the value remaps are NOT
-- undone automatically — restore from backup if they must be reversed):
--   begin;
--   alter table affairs drop constraint if exists affairs_source_check;
--   alter table affairs add constraint affairs_source_check
--     check (source is null or source in ('tender','field','existing_client','other'));
--   commit;
-- ---------------------------------------------------------------------
