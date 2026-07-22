-- =====================================================================
-- VÉRIFICATION DU GEL EN PRODUCTION — 100 % LECTURE SEULE
--
-- À coller tel quel dans le SQL editor Supabase (projet brqhcqaagzfiozzamzon).
-- Tout est encapsulé dans BEGIN … ROLLBACK : AUCUNE donnée n'est modifiée,
-- même si un test échoue. Les résultats sortent en NOTICE (onglet "Messages").
--
-- Vérifie m179 + m182 + m183 après application.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) INVENTAIRE DES TRIGGERS — attendu : 12 lignes
--    lighting_freeze_guard      × 3 (INSERT/UPDATE/DELETE)   [m179]
--    tl_lines_freeze_guard      × 3 (INSERT/UPDATE/DELETE)   [m179]
--    tl_freeze_guard            × 1 (UPDATE)                 [m179+m182]
--    tl_freeze_delete_guard     × 1 (DELETE)                 [m182]
--    tl_revision_freeze_guard   × 2 (UPDATE/DELETE)          [m182]
--    attachment_freeze_guard    × 2 (UPDATE/DELETE)          [m183]
-- ---------------------------------------------------------------------
select trigger_name, event_manipulation, event_object_table
from information_schema.triggers
where trigger_name like '%freeze%'
order by event_object_table, trigger_name, event_manipulation;

-- ---------------------------------------------------------------------
-- 2) TESTS DE COMPORTEMENT — en transaction annulée.
--    Seuls les gardes UPDATE sont testés ici : ils s'appliquent à TOUS les
--    appelants. Les branches DELETE sont volontairement restreintes aux
--    rôles PostgREST (authenticated/anon) pour ne pas casser le Force
--    Delete super-admin m169 — dans le SQL editor tu es `postgres`, donc
--    elles ne se déclencheraient pas : leur existence est prouvée par
--    l'inventaire ci-dessus.
-- ---------------------------------------------------------------------
begin;

do $$
declare
  v_id uuid; v_num text; v_rev_id uuid; v_rev text;
  pass int := 0; fail int := 0;
begin
  ----------------------------------------------------------------- task list
  select id, number into v_id, v_num
    from production_task_lists
   where status in ('validated','production_ready')
   limit 1;

  if v_id is null then
    raise notice '— aucune task list validée en prod : tests d''écriture ignorés';
  else
    raise notice '— cible : %', v_num;

    -- T1 : le contournement #2 (statut + contenu dans le même UPDATE)
    begin
      update production_task_lists
         set status = 'under_validation',
             production_notes = coalesce(production_notes,'') || ' probe'
       where id = v_id;
      fail := fail + 1;
      raise notice 'T1 contournement statut+contenu .......... ECHEC (accepté !)';
    exception when others then
      pass := pass + 1;
      raise notice 'T1 contournement statut+contenu .......... OK (rejeté)';
    end;

    -- T2 : colonne de contenu seule
    begin
      update production_task_lists
         set production_notes = coalesce(production_notes,'') || ' probe'
       where id = v_id;
      fail := fail + 1;
      raise notice 'T2 écriture de contenu ................... ECHEC (accepté !)';
    exception when others then
      pass := pass + 1;
      raise notice 'T2 écriture de contenu ................... OK (rejeté)';
    end;

    -- T3 : lignes d'une liste gelée
    begin
      delete from production_task_list_lines where task_list_id = v_id;
      fail := fail + 1;
      raise notice 'T3 suppression de ligne .................. ECHEC (accepté !)';
    exception when others then
      pass := pass + 1;
      raise notice 'T3 suppression de ligne .................. OK (rejeté)';
    end;
  end if;

  ----------------------------------------------------------------- révisions
  select id, rev into v_rev_id, v_rev
    from task_list_revisions
   where status in ('validated','superseded')
   limit 1;

  if v_rev_id is null then
    raise notice '— aucune révision finalisée : tests de révision ignorés (normal tant qu''aucune validation n''a eu lieu depuis m179)';
  else
    -- T4 : réécriture du snapshot
    begin
      update task_list_revisions set snapshot = '{"probe":true}'::jsonb where id = v_rev_id;
      fail := fail + 1;
      raise notice 'T4 réécriture de snapshot ................ ECHEC (accepté !)';
    exception when others then
      pass := pass + 1;
      raise notice 'T4 réécriture de snapshot ................ OK (rejeté)';
    end;

    -- T5 : bypass en deux temps
    begin
      update task_list_revisions set status = 'in_progress' where id = v_rev_id;
      fail := fail + 1;
      raise notice 'T5 bypass 2 temps (retour in_progress) ... ECHEC (accepté !)';
    exception when others then
      pass := pass + 1;
      raise notice 'T5 bypass 2 temps (retour in_progress) ... OK (rejeté)';
    end;
  end if;

  ------------------------------------------------- non-régression, EN DERNIER
  -- Ce test change réellement le statut (dans la transaction annulée). Il doit
  -- donc rester le DERNIER : sinon la liste n'est plus gelée et tous les tests
  -- suivants passeraient à tort.
  if v_id is not null then
    begin
      update production_task_lists set status = 'under_validation' where id = v_id;
      pass := pass + 1;
      raise notice 'T6 transition de statut pure ............. OK (autorisé)';
    exception when others then
      fail := fail + 1;
      raise notice 'T6 transition de statut pure ............. ECHEC (bloqué : %)', sqlerrm;
    end;
  end if;

  raise notice '=====================================';
  raise notice 'RESULTAT : % OK · % ECHEC', pass, fail;
  if fail = 0 then
    raise notice 'Le gel tient.';
  else
    raise notice 'ATTENTION : au moins un contournement est encore ouvert.';
  end if;
end $$;

rollback;

-- ---------------------------------------------------------------------
-- 3) LEDGER — les 4 migrations doivent apparaître
-- ---------------------------------------------------------------------
select filename
from schema_migrations
where filename in ('178_task_list_action_items.sql',
                   '179_task_list_revisions_freeze.sql',
                   '182_freeze_hardening.sql',
                   '183_attachment_freeze.sql')
order by filename;
