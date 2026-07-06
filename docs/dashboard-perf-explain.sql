-- =====================================================================
-- Dashboard perf — EXPLAIN ANALYZE des requêtes les plus lentes
-- Mesuré le 2026-07-04 via instrumentation lib/dash-profile.ts (6 charges
-- à chaud, vrai login sales). Médianes ci-dessous entre [crochets].
--
-- ⚠️ RLS : le SQL editor s'exécute en `postgres` et CONTOURNE la RLS.
-- L'app tourne en rôle `authenticated` avec la policy RLS active, ce qui
-- peut AJOUTER un coût (sous-requêtes de policy). Pour un plan fidèle,
-- exécuter chaque bloc entre :
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<user_uuid>","role":"authenticated"}';
--     <EXPLAIN ...>
--     reset role;
-- Sinon les plans "postgres" sont une borne basse (coût DB pur, hors RLS).
--
-- Lancer chaque EXPLAIN d'abord SANS l'index (état actuel), puis créer
-- l'index candidat, ANALYZE, et relancer pour comparer.
-- =====================================================================


-- ── #1  events feed — listOperationsFeed (lib/events.ts:402) ──────────
-- Profil : MÉDIANE 774 ms, MAX 7716 ms, 48 lignes. LA seule requête au
-- coût serveur réel (les autres sont dominées par latence/handshake).
-- select("*") + over-fetch (limit*2) ; scan + tri sur created_at.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT *
FROM events
WHERE created_at >= now() - interval '30 days'
ORDER BY created_at DESC
LIMIT 100;

-- Index candidat (tri + borne temporelle servis par l'index) :
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_created_at_desc
--     ON events (created_at DESC);
-- Attendu : Index Scan Backward au lieu de Seq Scan + Sort. Vérifier que
-- le nœud "Sort" disparaît et que "Rows Removed by Filter" chute.


-- ── #1bis  events — listRecentCriticalEvents (lib/events.ts:349) ──────
-- Même table, + filtre severity. Index composite plus sélectif.
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM events
WHERE severity IN ('high','critical')
  AND created_at >= now() - interval '30 days'
ORDER BY created_at DESC
LIMIT 100;

-- Index candidat :
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_sev_created_at
--     ON events (severity, created_at DESC);


-- ── #2  planned_actions — dashboard wave (page.tsx) ──────────────────
-- Profil : MÉDIANE 491 ms, 0 ligne. Retourne rien mais scanne la table.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, affair_id, tender_id, action_type, title, due_date
FROM planned_actions
WHERE done_at IS NULL
ORDER BY due_date ASC;

-- Index PARTIEL (la clause done_at IS NULL est la sélectivité utile) :
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_planned_actions_open_due
--     ON planned_actions (due_date)
--     WHERE done_at IS NULL;


-- ── #3  user_profiles — greeting (page.tsx) ──────────────────────────
-- Profil : MÉDIANE 507 ms pour 1 ligne. Si user_id n'est pas déjà PK/UNIQUE
-- indexé, c'est un seq scan ; sinon la latence est réseau/handshake (l'index
-- n'aidera pas — l'EXPLAIN tranchera : Index Scan vs Seq Scan).
EXPLAIN (ANALYZE, BUFFERS)
SELECT user_id, display_name
FROM user_profiles
WHERE user_id = '20945387-1196-4a78-b879-8e7aaf86e8b8';

-- Index candidat (si absent) :
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_user_profiles_user_id
--     ON user_profiles (user_id);


-- ── autres candidats (coût 350–465 ms, à confirmer) ──────────────────

-- documents — sent/negotiating actifs (page.tsx wave) [465 ms, 0 ligne]
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, number, status, total_price, currency, date, created_by,
       sales_owner_id, affair_id, root_document_id, version, archived_at
FROM documents
WHERE status IN ('sent','negotiating')
  AND archived_at IS NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_status_active
--     ON documents (status) WHERE archived_at IS NULL;

-- documents — won (getOperationsActions) [269 ms médiane, MAX 4116 ms]
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, number, affair_name, created_by, sales_owner_id, status, date,
       total_price, currency
FROM documents
WHERE status = 'won';
--   (couvert par idx_documents_status_active ci-dessus si status='won'
--    n'est pas archivé ; sinon index dédié sur (status).)

-- production_task_lists — fetch-all quotation_id [440 ms, 2 lignes / limit 5000]
-- Ici l'index n'aidera PAS : c'est un SELECT sans WHERE (toute la table).
-- Le fix est applicatif (ne charger que les colonnes/lignes utiles), pas un index.
EXPLAIN (ANALYZE, BUFFERS)
SELECT quotation_id FROM production_task_lists LIMIT 5000;

-- tenders — actifs (getOperationsActions) [325 ms, 0 ligne]
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, title, country, owner_id, created_by, commercial_status,
       accepted_at, created_at, budget_usd
FROM tenders
WHERE commercial_status IN
  ('accepted','searching_partner','partner_assigned','contacted',
   'waiting_feedback','interested','quotation_requested')
LIMIT 500;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenders_commercial_status
--     ON tenders (commercial_status);


-- =====================================================================
-- Vérifs utiles avant de créer quoi que ce soit :
--   -- index déjà présents sur une table :
--   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'events';
--   -- taille des tables (un seq scan sur 200 lignes n'a pas besoin d'index) :
--   SELECT relname, n_live_tup FROM pg_stat_user_tables
--     WHERE relname IN ('events','planned_actions','user_profiles',
--                       'documents','production_task_lists','tenders')
--     ORDER BY n_live_tup DESC;
-- =====================================================================
