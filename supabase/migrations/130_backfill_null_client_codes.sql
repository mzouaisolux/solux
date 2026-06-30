-- =====================================================================
-- m130 — Backfill NULL client_code  (SAFE · idempotent · DRY-RUN first)
-- ---------------------------------------------------------------------
-- Fixes the residual DATA side of bug #8: clients created BEFORE the
-- createClientAction guard could have client_code = NULL, which then
-- blocks saving ANY quotation for them (buildPayload + the doc-number
-- function both raise "Client has no client_code"). The app side is
-- already fixed (server guard + required form field) — this only
-- regularises OLD rows.
--
-- client_code constraint (m006):
--   CHECK (client_code IS NULL OR client_code ~ '^[A-Z]{3}$')
--   + PARTIAL UNIQUE INDEX among non-null codes.
-- ⇒ the ONLY "missing" state possible is NULL (''/lowercase can't be
--   stored), and every assigned code MUST be collision-free.
--
-- This migration is deliberately CONSERVATIVE — it NEVER invents codes
-- for real clients "sans contrôle":
--   • Never overwrites a non-null code.
--   • Assigns only an UNAMBIGUOUS, COLLISION-FREE 3-letter code derived
--     from company_name (first 3 alpha chars, uppercased).
--   • Collisions AND names with < 3 letters are SKIPPED + logged for
--     MANUAL handling (no auto-invention, no fallback guessing).
--   • Runs in DRY-RUN by default (v_apply = false): logs what it WOULD
--     do and writes NOTHING. Review the NOTICEs, then set v_apply := true
--     and re-run to apply.
--   • Idempotent: re-running only ever touches the remaining NULLs.
-- Apply MANUALLY in Supabase. Read the NOTICE output.
-- =====================================================================

-- ---------------------------------------------------------------------
-- STEP 1 — QUICK AUDIT (run this SELECT first, no writes):
--
--   select
--     count(*) filter (where client_code is null)                                              as null_total,
--     count(*) filter (where client_code is null and archived_at is null)                      as null_active,
--     count(*) filter (where client_code is null and archived_at is not null)                  as null_archived,
--     count(*) filter (where client_code is null and company_name ~* 'test|demo|sample|essai|exemple') as null_testlike
--   from clients;
--
-- DETAILED LIST (proposed code + collision/ambiguity flags + risk):
--
--   select
--     c.id, c.company_name,
--     (c.archived_at is not null)                                          as archived,
--     (c.company_name ~* 'test|demo|sample|essai|exemple')                 as testlike,
--     exists(select 1 from documents d where d.client_id = c.id)           as has_docs,
--     upper(substring(regexp_replace(c.company_name,'[^A-Za-z]','','g') from 1 for 3)) as proposed_code,
--     (length(regexp_replace(c.company_name,'[^A-Za-z]','','g')) < 3)      as too_short,
--     exists(select 1 from clients x
--            where x.client_code =
--              upper(substring(regexp_replace(c.company_name,'[^A-Za-z]','','g') from 1 for 3))) as collides
--   from clients c
--   where c.client_code is null
--   order by archived, testlike desc, company_name;
-- ---------------------------------------------------------------------

begin;

do $$
declare
  v_apply   boolean := false;   -- ◄── DRY-RUN by default. Set to true AFTER reviewing the NOTICEs.
  r         record;
  v_code    text;
  v_used    text[];
  v_changed int := 0;
  v_skipped int := 0;
  v_kind    text;
begin
  -- Collision set: existing non-null codes + codes assigned during THIS
  -- run (so two NULL clients deriving the same code don't clash, even in
  -- dry-run where nothing is written yet).
  select coalesce(array_agg(client_code), '{}'::text[])
    into v_used
    from clients
   where client_code is not null;

  for r in
    select c.id,
           c.company_name,
           c.archived_at,
           (c.company_name ~* 'test|demo|sample|essai|exemple')        as testlike,
           exists(select 1 from documents d where d.client_id = c.id)  as has_docs
      from clients c
     where c.client_code is null
     order by (c.archived_at is not null), c.company_name
  loop
    v_kind :=
      case when r.testlike then 'test' else 'real' end
      || case when r.archived_at is not null then '/archived'
              when r.has_docs              then '/active+docs'
              else                              '/active' end;

    v_code := upper(substring(regexp_replace(coalesce(r.company_name,''), '[^A-Za-z]', '', 'g') from 1 for 3));

    -- Ambiguous: company name has fewer than 3 letters → cannot derive a
    -- safe code. Leave for manual assignment.
    if length(v_code) < 3 then
      raise notice 'SKIP ambiguous (<3 letters) [%] % | "%"  → assign a code MANUALLY',
        v_kind, r.id, r.company_name;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Collision: derived code already taken (existing or earlier this run)
    -- → never auto-apply a colliding code. Leave for manual choice.
    if v_code = any(v_used) then
      raise notice 'SKIP collision (% already used) [%] % | "%"  → pick a unique code MANUALLY',
        v_code, v_kind, r.id, r.company_name;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_apply then
      update clients set client_code = v_code
       where id = r.id and client_code is null;   -- never overwrite a valid code
      raise notice 'SET % ← "%" [%]', v_code, r.company_name, v_kind;
    else
      raise notice 'WOULD SET % ← "%" [%]', v_code, r.company_name, v_kind;
    end if;

    v_used    := v_used || v_code;
    v_changed := v_changed + 1;
  end loop;

  raise notice '──────── % · % code(s) %, % skipped (manual) ────────',
    case when v_apply then 'APPLIED' else 'DRY-RUN (no writes)' end,
    v_changed,
    case when v_apply then 'set' else 'to set' end,
    v_skipped;

  -- Only record the migration as applied when it actually wrote.
  if v_apply then
    insert into schema_migrations (filename, note)
    values ('130_backfill_null_client_codes.sql',
            'Backfilled NULL client_code with collision-free 3-letter codes; collisions/ambiguous left for manual.')
    on conflict (filename) do nothing;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- STEP 2 — review the dry-run NOTICEs above.
-- STEP 3 — set  v_apply := true  and re-run to apply the safe ones.
-- STEP 4 — handle the SKIPPED rows manually, e.g.:
--            update clients set client_code = 'XYZ' where id = '<uuid>';  -- a free 3-letter code
--
-- POST-CHECK — no ACTIVE client should still lack a code (archived ones
-- are lower risk; quote-save only happens on active clients):
--   select id, company_name from clients
--    where client_code is null and archived_at is null;   -- expect 0 rows (or only manual leftovers)
--
-- ROLLBACK (only undoes THIS run's auto-set codes is not tracked; codes
-- are business data — to revert a specific one: set client_code = null
-- where id = '<uuid>').
-- ---------------------------------------------------------------------
