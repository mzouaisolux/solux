# Sales & Analytics — registre « Excel en ligne »

Module **autonome** de suivi des ventes + statistiques (migration **m138**). Il
remplace le fichier Excel « un onglet par année » depuis 2019 : saisie fiable en
grille éditable, traçabilité complète, KPI exploitables.

> **Îlot 100 % séparé du CRM.** Aucune FK vers `clients`/`documents`, rien n'est
> dérivé ou pré-rempli depuis le CRM. Seul lien : `auth.users` (traçabilité). Le
> pipeline commercial figé (devis → won → production → finance) n'est pas touché.

## Tables (m138)
`salers` · `sales_clients` (master **éditable**, `code` = C0001) ·
`sales_client_aliases` (`normalized_key` **unique**) · `sales_orders` (registre
transactionnel, **multi-devise par ligne**, `*_raw` conservés, `import_key`
idempotent) · `monthly_sales_history` (vérité KPI figée, §3) · `sales_audit_log`
(append-only) · `sales_merge_suggestions` (file de dédup humaine).

## Mise en place (owner, une fois)
1. **Sauvegarde** de la base.
2. **Appliquer m138** (DDL = owner : éditeur SQL Supabase, ou `db:migrate` une fois
   le ledger backfillé). L'agent n'a pas les droits DDL.
3. Déposer les CSV dans `data/` (`orders.csv`, `clients.csv`, `monthly_sales.csv`,
   `merge_suggestions.csv`). **Gitignorés** (données financières réelles).
4. **Importer** :
   ```bash
   node --experimental-strip-types scripts/import-sales-history.ts --dry-run   # parse + réconcilie, sans DB
   DATABASE_URL='postgres://…' npm run import:sales                            # import réel
   ```
   L'import est **idempotent** (upserts sur clés naturelles) et **réconcilie §7
   avant ET après** (1314 commandes, 203 clients, CA/vendeur) — il échoue
   bruyamment + rollback si un contrôle est faux.

## Règle KPI (§3) — À LIRE
La performance vendeur ne s'obtient **jamais** en sommant `sales_amount` ligne à
ligne (une commande en cours a un montant vide mais est déjà créditée au vendeur).
`lib/sales/kpi.ts` **route par période** :
- **Historique** (période présente dans `monthly_sales_history`) → somme de
  `monthly_sales_history.sales` (la vérité vérifiée à la main).
- **Natif ERP** (période sans ligne mensuelle) → agrégation de `sales_orders` ;
  une commande à `sales_amount` NULL est **exclue et signalée**, jamais comptée 0.
- **Jamais mélangées** sur une même période.

Comptabilité : `pi_amount = sales_amount + transportation` ; le CA « ventes » =
`sales_amount` (hors transport). Multi-devise : **jamais sommé entre devises**.
À la saisie ERP, un vendeur + un `sales_amount` (au moins provisoire) sont exigés.

## Dédoublonnage & fusions (§4)
`normalizedClientKey` (`lib/sales/client-key.ts`) : minuscules → strip préfixe
chinois → `&`→` and ` → sans ponctuation → sans mots de forme juridique → sans
espaces. **Clé identique ⇒ même client** (rattachement auto). Sinon flou
(`lib/sales/client-match.ts`, réutilise les primitives testées de `lib/import/`,
seuil **0.86**) → `sales_merge_suggestions` en `pending`. **Jamais de fusion
automatique** ; jamais de comparaison contre le CRM. Un humain habilité tranche
« Fusionner » (pose `sales_clients.merged_into_id`) / « Garder séparés ». Les 6
paires historiques sont chargées depuis `merge_suggestions.csv`.

## Traçabilité (§5)
Chaque create/update/delete → `sales_audit_log` (`field, old_value, new_value,
user_id, created_at`). `lib/sales/audit.ts` calcule le diff (pur, testé) ; le
server action insère ce qu'il retourne.

## Tests
```bash
npm test   # inclut tests/sales-*.test.ts
```
`sales-client-key` (normalisation §4) · `sales-client-match` (§8 : fusionne
International Light/Lighting Factory, propose sans fusionner ANL/ANDI) ·
`sales-kpi` (règle §3) · `sales-audit` (§5) · `sales-reconciliation` (**§7 sur
les vrais CSV** — se skippe proprement si `data/` absent).

## Fichiers
- `lib/sales/{client-key,client-match,csv,kpi,audit,reconcile}.ts` — libs pures.
- `supabase/migrations/138_sales_analytics.sql` — schéma + RLS.
- `scripts/import-sales-history.ts` — loader idempotent + réconciliation.
- `tests/sales-*.test.ts` — garde-fous.

## Reste à faire (UI — lot 2)
Grille éditable (lignes = commandes, style Excel, historique inline) · picker
client autocomplete (jamais de texte libre) · file de validation des fusions ·
dashboards §6 (CA année + YoY, vendeur×année, top clients, pays, encaissé/facturé,
saisonnalité) · capabilities (`sales_record.*`, `sales_analytics.view`,
`client.merge`) + nav + i18n. Design SOLUX conservé, rafraîchissement par polling.
