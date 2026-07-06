-- =====================================================================
-- m145 — codes_taken(text[]): cross-rep client-code availability probe
-- ---------------------------------------------------------------------
-- Client codes (clients.client_code, ^[A-Z]{3}$, partial UNIQUE index
-- from m006) are now AUTO-GENERATED from the company name and must be
-- unique across ALL reps. A plain Sales SELECT can't see a rival rep's
-- client (RLS m105), so a naive "is this code free?" read would call an
-- in-use code free. This SECURITY DEFINER helper answers the availability
-- question over the FULL table (bypassing RLS) while only ever revealing
-- the taken/free status of the specific candidate codes passed in — no
-- client rows, names, or owners leak.
--
-- OPTIONAL polish for the live UI check only. The HARD guarantee against
-- concurrent collisions is the partial unique index + the server-side
-- insert-retry in createClientRecord (which needs no RPC). If this isn't
-- applied yet, suggestClientCodeAction degrades gracefully to a
-- best-effort in-scope read.
--
-- Apply in the Supabase SQL editor. Idempotent.
-- =====================================================================

begin;

create or replace function codes_taken(codes text[])
returns text[]
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct c), '{}'::text[])
    from unnest(codes) as c
   where exists (
     select 1 from clients x where x.client_code = upper(c)
   );
$$;

comment on function codes_taken(text[]) is
  'Returns which of the given 3-letter codes are already used by a client. RLS-bypassing availability probe for client-code auto-generation (m145); reveals only taken/free status of the passed codes.';

revoke all on function codes_taken(text[]) from public;
grant execute on function codes_taken(text[]) to authenticated;

insert into schema_migrations (filename, note)
values ('145_client_code_dedup.sql',
        'codes_taken(text[]) SECURITY DEFINER availability probe for client-code auto-generation.')
on conflict (filename) do nothing;

commit;

notify pgrst, 'reload schema';
