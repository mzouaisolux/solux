-- =====================================================================
-- m171 — SR notification fixes (UX audit 2026-07-14, quick-wins)
-- =====================================================================
-- 1) FIX destinataire : pr.ready_for_pricing notifiait `sales`, mais c'est le
--    Sales DIRECTOR qui doit pricer (capability project.set_pricing). Le
--    commentaire canonique (events-shared.ts:230 "→ director") contredisait
--    déjà le seed m162. On re-route la cloche vers sales_director.
-- 2) OPT-IN des transitions muettes : pr.spec_adjusted (le Directeur modifie la
--    spec demandée par le vendeur → le vendeur doit le savoir) et
--    pr.quotation_generated (le devis du vendeur est prêt).
-- Idempotent. Appliquer MANUELLEMENT dans l'éditeur SQL Supabase.
-- =====================================================================

begin;

-- 1) Re-route pr.ready_for_pricing : sales → sales_director.
update public.event_routing
   set role = 'sales_director'
 where event_key = 'pr.ready_for_pricing'
   and consumer  = 'notification'
   and role      = 'sales'
   -- ne rien faire si la ligne sales_director existe déjà (2e run)
   and not exists (
     select 1 from public.event_routing e2
      where e2.event_key = 'pr.ready_for_pricing'
        and e2.consumer  = 'notification'
        and e2.role      = 'sales_director'
   );
-- Si les deux existaient déjà, purge la ligne 'sales' obsolète.
delete from public.event_routing
 where event_key = 'pr.ready_for_pricing' and consumer = 'notification' and role = 'sales'
   and exists (
     select 1 from public.event_routing e2
      where e2.event_key = 'pr.ready_for_pricing'
        and e2.consumer  = 'notification'
        and e2.role      = 'sales_director'
   );

-- 2) Opt-in des transitions muettes (master '*' + rôle destinataire).
do $$
declare r record;
begin
  for r in select * from (values
    ('pr.spec_adjusted',       'sales'),
    ('pr.quotation_generated', 'sales')
  ) as v(event_key, bell_role)
  loop
    insert into public.event_routing (event_key, consumer, role, config, enabled)
    select r.event_key, 'notification', '*', '{}'::jsonb, true
    where not exists (select 1 from public.event_routing
      where event_key = r.event_key and consumer = 'notification' and role = '*');

    insert into public.event_routing (event_key, consumer, role, config, enabled)
    select r.event_key, 'notification', r.bell_role, '{"channel":"bell"}'::jsonb, true
    where not exists (select 1 from public.event_routing
      where event_key = r.event_key and consumer = 'notification' and role = r.bell_role);
  end loop;
end $$;

insert into schema_migrations (filename, note)
values ('171_sr_notification_fixes.sql',
        'SR notif fixes: pr.ready_for_pricing re-routed sales→sales_director (matches the role that prices); opt-in pr.spec_adjusted + pr.quotation_generated (were silent by default).')
on conflict (filename) do nothing;

commit;
notify pgrst, 'reload schema';
