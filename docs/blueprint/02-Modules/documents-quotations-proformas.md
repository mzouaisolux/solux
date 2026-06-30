# Module — Documents (Devis / Quotations & Proformas)

> Le moteur de documents commerciaux. Même table `documents`, deux types : **Quotation** (devis, négociation) et **Proforma** (commande de production).

## Objectif métier
Produire l'**offre chiffrée** envoyée au client (Quotation), la faire évoluer (versions, statuts), puis — une fois gagnée — la transformer en **Proforma** = la **commande** qui déclenche la production. Le devis gagné est la **seule source de revenu (CA)** ; la proforma est la commande, jamais un second deal.

## Utilisateurs (rôles)
- **Sales** : crée/édite/envoie ses devis (`quotation.create`, `quotation.cancel`), lance la production.
- **Sales Director / Admin** : approuvent les validations de devis (`canSupervise`), réassignent l'owner.
- **TLM** : peut aussi créer/annuler des devis.
- Visibilité RLS : `created_by` OU rôles techniques ; + finance/sales_director (lecture).

## Écrans / Routes
| Route | Objectif |
|---|---|
| `/documents/new` | Quote builder — créer / réviser / éditer-en-place un devis ou une proforma ; configurateur catégorie-centré, conditions de paiement, affaire obligatoire, « + New Project » inline |
| `/documents/[id]` | Détail : statut, cycle de vie, PDF (Generate/Download), actions rapides, validation advisory, versions, forecast, lignes/totaux, timeline |
| `GET /api/documents/[id]/pdf` | Export PDF à la demande (URL signée 5 min) |

## Données manipulées (tables)
- **`documents`** : `type` (quotation/proforma), `number` (`SLX-{code}-{YY}-{NNN}`, `-Vn` pour les versions), `status` (draft/sent/negotiating/won/lost/cancelled), `client_id`, **`affair_id`** (obligatoire), `total_price`, `payment_mode` (deposit_balance/lc/hybrid), `payment_terms` (jsonb), `version` + `root_document_id` (versioning), `validation_status` (m068), `original_sales_request` (m134), `sales_owner_id`, `forecast_*` (m050), `pdf_url`. ⚠️ Pas de colonne `created_at` (utiliser `date`) ni `total` (utiliser `total_price`).
- **`document_lines`** : `product_id`, `category_id` (m133), `quantity`, `config_values`/`selected_options`, prix (unit/total/discount), snapshots produit.
- **`document_containers`** : conteneurs + fret.

## Cycle de vie (détail en [../04-Business-Workflows/quotation-lifecycle.md](../04-Business-Workflows/quotation-lifecycle.md))
`draft → sent → negotiating → won` (ou `lost`/`cancelled`). Transitions via `updateDocumentStatus`. Boucle de validation **advisory** (m068, ne bloque jamais) : `requestValidation` → `reviewValidation` (`canSupervise`).

## Proforma & Launch Production (détail en [../04-Business-Workflows/launch-production.md](../04-Business-Workflows/launch-production.md))
`launchProduction` (sur un devis **won**, `quotation.create`) crée la **proforma** (copie fidèle, **statut draft volontaire** pour ne pas double-compter le CA) + la **task list**, puis redirige vers la task list. Une seule commande par affaire.

## Règles clés (détail en [../06-Business-Rules.md](../06-Business-Rules.md))
- **Affaire obligatoire** (sauf révision/edit) — garde backend dans `saveDocument`.
- **Numéro immuable** ; édition-en-place réservée aux drafts ; un devis envoyé n'est jamais édité en place (→ nouvelle version V2/V3).
- **Proforma ne peut jamais être `won`** (garde `updateDocumentStatus`).
- **WON ne redevient pas éditable** si production existe (admin-like sinon).
- **Suppression verrouillée** (Decision F / m078) si task list/PO existe.
- **Numérotation exige `client_code`** ; **cascade d'annulation** (trigger DB m023) annule task lists + orders liés.

## Paiement
`payment_mode` (deposit_balance/lc/hybrid) + `payment_terms` (deposit_percent, balance_condition, lc_type, lc_days). Validé par `lib/payment.ts`. Alimente le suivi finance (dépôt/balance attendus, balance_due_date, LC).

## PDF
Génération **dynamique au clic** (`@react-pdf/renderer` importé lazily — fix F3). Titres : « QUOTATION » / « PROFORMA INVOICE ». Nom de fichier canonique `TYPE_NUMBER_CLIENT_AFFAIR[_Vn].pdf` (`lib/pdf-filename.ts`). Banque + conditions de vente incluses. (La Commercial Invoice est un PDF du module Production.)

## Événements émis
`doc.created/updated/status_changed/won/lost/cancelled/deleted`, `doc.validation_requested/approved/rejected`. Voir [../08-Events.md](../08-Events.md).

## Dépendances & modules concernés
- **Clients/Affaires** (parent obligatoire, numérotation), **Task Lists** (générées depuis la proforma), **Production Orders** (cascade), **Pricing/Catalog** (prix par liste publiée + lignes), **Forecast** (champs sur le doc), **Service Requests** (`generateQuotationFromProject` produit un devis), **Banks/Sales Conditions** (PDF).

## UNKNOWN / TO BE VALIDATED
- `quotation.create` / `quotation.delete` pour `sales_director` / `admin` : dépend de l'état réel de `role_permissions` (conflit m026 vs m055).
- Les gardes de transition (proforma-not-won, H1/H2) sont **applicatives**, pas RLS : un UPDATE SQL direct par un admin les contournerait (la cascade d'annulation reste, elle, garantie par trigger DB).
</content>
