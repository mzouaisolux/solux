# Module — Prospects & Tenders (CRM amont)

> ⚠️ **STATUT : PROTOTYPE.** Le HANDOVER classe ce module comme « prototype non testé E2E » à plusieurs reprises. Les **libs pures** sont testées (attribution-parse, tender-identity, prospect-intel, tender-discovery) mais **aucun flux UI/serveur n'a de couverture E2E**. Les tables vivent uniquement dans les migrations (absentes de `schema.sql`). À considérer comme une fondation riche mais non durcie.

## Objectif métier
Le CRM **amont** : découvrir des entreprises à approcher (prospects), suivre les **appels d'offres (tenders)**, importer les **résultats d'attribution** (intelligence concurrentielle), qualifier et faire avancer les tenders dans un pipeline, et convertir un tender mûr en affaire/devis.

## Utilisateurs (rôles)
Accès = `prospect.access` : **super_admin, admin, sales, sales_director**. **DENY explicite** : task_list_manager, operations, finance (m104).
- **Sales** : voit ses tenders assignés.
- **Sales Director** : assigne les tenders.
- **Admin** : importe les attributions.

## Écrans / Routes
| Route | Objectif |
|---|---|
| `/prospects` | Centre de découverte, 2 univers : **Prospects** (Projects/Companies) et **Tenders** (Inbox) |
| `/prospects/pipeline` | Kanban d'exécution des tenders acceptés (8 colonnes) |
| `/prospects/tenders/[id]` | **Tender Workspace** (objet CRM 1ʳᵉ classe) : hero, KPIs, intelligence, winner(s), participants, docs, timeline, Prospecting Assistant |
| `/admin/diagnostics/tender-merge` | Dry-run de consolidation des doublons (lecture seule) |

## Données manipulées (tables)
- **`prospects`** : entreprise à approcher ; `name_key` (dédup), `status` (v2 : new→assigned→contacted→lead→opportunity→customer), compteurs dénormalisés (participations/wins).
- **`tenders`** : AO brut ; `type` = `open` (à défendre via partenaire → affaire) ou `result` (intel concurrentielle) ; `commercial_status` (pipeline), `market_reference` (ancre dédup).
- **`tender_participants`** : intel d'un tender result (winner, bid, contacts, lots).
- **`tender_followups`**, **`prospect_activities`** (`is_reply` = clé du « lead »), **`planned_actions`**.
- **Funder / Tier** : **calculés**, pas stockés (`funderOf`, `opportunityTier`).

## Cycles de vie
- **Tender `commercial_status`** : `new → accepted → searching_partner → partner_assigned → contacted → waiting_feedback → interested → project_request → opportunity_created` (+ rejected/lost).
- **Pipeline** : 8 colonnes (accepted → project_request) ; `opportunity_created` quitte le board.
- **Prospect v2** : un **lead** n'existe qu'après une **interaction réciproque** (`is_reply`) — email envoyé ≠ lead.

## Import d'attributions (le cœur intel)
`importTenderAttributions` (admin only). Parsing via `lib/attribution-parse.ts` (testé verbatim sur exports J360). Formats **v1** (winner-centric) et **v2 « Bid Results »** (projets + gagnants par lot + annuaire entreprises). Linking par `name_key` ; consolidation des tenders par `matchTender` (market_reference > similarité pays/titre/date). Recalcul des stats prospect (`recomputeProspectTenderStats`).

## Lien vers le cœur (codé)
- `convertTenderToAffair` / `createOpportunityFromTender` : un tender mûr (partenaire + `interested`/`project_request`) → affaire (`source='tender'`).
- `/projects/new?tender=…` : créer une Service Request depuis un tender (rejoue le même gate).
- `convertProspectToClient` : un prospect → client (sans doublon).

## Règles & verrouillage
- Gardes **serveur** sur le vrai rôle : `requireProjectManagement` (assignation), `requireProjectImport` (import attributions, admin only).
- RLS tenders scopée (m108) ; participants/followups héritent.
- Une attribution = **un projet, plusieurs lots, plusieurs winners** (jamais sommé).

## Événements émis
**Aucun** event `tender.*`/`prospect.*` — seul `client.created` (prospect → client). Pas d'audit trail propre ; la timeline est **dérivée** au render.

## Dépendances & modules concernés
- **Affaires / Clients / Contacts** (conversions), **Service Requests** (un tender lance une SR), **planned_actions** (next actions), **Permissions** (`prospect.access`).

## UNKNOWN / TO BE VALIDATED (signaux prototype)
- **Jamais testé E2E** — tout flux UI/serveur = non vérifié sur données réelles.
- **BUG confirmé** (`lib/action-center.ts:907`) : la sonde « tender bloqué » liste l'ancien statut `quotation_requested` et **omet `project_request`** → les tenders au stade Project Request sans next-action ne déclenchent jamais l'alerte morning.
- **Tender-merge = dry-run only** : aucune action `applyMerge` n'existe → les doublons tenders ne sont jamais consolidables en prod (le merge **prospects**, lui, est exécutable).
- Asymétrie de garde : `importTenders` (AO open) n'exige que `prospect.access` (un sales peut importer).
- `TendersPanel.tsx` semble être un panneau legacy non monté.
</content>
