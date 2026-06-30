# Module — Service Requests (intake custom / appel d'offres)

> Label UI « Service Request ». Table `project_requests`, routes `/projects`. **Distinct des Affaires** (`affairs`). L'intake structuré d'une opportunité dont le coût n'est pas connu et qui nécessite une validation multi-rôles avant de produire un devis.

> ⚠️ **Statut prototype partiel** : le HANDOVER signale que l'**approbation Director n'a pas été testée end-to-end**. Le chemin code est complet mais non prouvé sur données réelles.

## Objectif métier
Gérer les opportunités **custom / tender** : un besoin client en texte libre est qualifié (Director), chiffré côté usine (RMB) et logistique (Operations), pricé avec marges (Director), puis transformé en devis (Sales). Le **coût usine RMB reste caché aux Sales**.

## Utilisateurs (rôles) & capabilities
- **Sales** (`project.create`, `project.generate_quotation`) : crée la demande, génère le devis. **Ne voit pas le coût RMB**.
- **Sales Director** (`project.approve`, `project.set_pricing`, `project.override_cost`) : approuve, price, override le coût (audité).
- **Operations / TLM / Finance** (`project.enter_cost`, `project.enter_logistics`, `project.view_cost`) : saisissent factory cost, packing, freight.

## Écrans / Routes
| Route | Objectif |
|---|---|
| `/projects` | Liste + dashboard des Service Requests (`?mine=1`) ; files par rôle |
| `/projects/new` | Formulaire de création (services demandés rendus depuis `lib/service-types.ts`) |
| `/projects/[id]` | Détail + cockpit workflow (stepper 6 étapes, sections cost/packing/freight/pricing) |
| `/projects/approvals` | File d'approbation Director (`project.approve`) |
| `/projects/cost-requests` | File de saisie des coûts (`project.view_cost`) |
| `/projects/logistics-requests` | File packing+freight (`project.enter_logistics`) |

## Données manipulées (tables)
- **`project_requests`** : `name`, `client_id`, `affair_id` (obligatoire, m124), specs solaires/pôle, services demandés (`req_product_pricing`/`req_packing_list`/`req_freight`), marges/commissions Product & Pole, prix finaux (Sales-visible), `status` (11 valeurs), `generated_document_id`.
- **Sous-requêtes** (toutes : status pending/completed/cancelled, saisies par Operations) :
  - `factory_cost_requests` — `product_cost_rmb`, `pole_cost_rmb` (**caché aux Sales**).
  - `packing_list_requests` — `containers[]` (source de vérité des conteneurs).
  - `freight_cost_requests` — `containers[{type,quantity,freight_per_unit}]`, validité (m098).
  - `logistics_requests` — **déprécié** (remplacé par packing+freight).
- **`project_products`** (m095) : le snapshot vendable généré au pricing (le devis en est issu).

## Registre des services (`lib/service-types.ts`)
**3 actifs** (product_pricing, packing_list, freight) + **6 futurs** (technical_study, lighting_study, autonomy_calculation, logistics, production, custom — roadmap, non câblés). Le formulaire rend ses cases depuis ce registre.

## Cycle de vie (11 statuts — détail en [../04-Business-Workflows/service-request-lifecycle.md](../04-Business-Workflows/service-request-lifecycle.md))
`draft → submitted* → waiting_director_approval → waiting_factory_cost/waiting_logistics ("Operations in progress") → ready_for_pricing → priced → quotation_generated → won/lost/cancelled`.
(*`submitted` est dans l'enum mais jamais écrit — `submitProjectRequest` saute à `waiting_director_approval`. TO BE VALIDATED.)

## Workflow Sales → Director → Operations → Director → Sales
1. **Sales** crée (draft) → submit.
2. **Director** approuve (confirme quels enfants créer) / request info / reject.
3. **Operations** saisit Factory Cost (RMB) + Packing + Freight → auto `ready_for_pricing` quand tous les enfants requis complétés.
4. **Director** applique les marges Product/Pole (RMB→USD) → priced (génère le Project Product).
5. **Sales** génère le devis → quotation_generated → Mark won/lost.

## Coût caché aux Sales (double verrou)
1. **Capability** `project.view_cost` = false pour `sales`.
2. **RLS** : m091 remplace la policy `factory_cost_requests` par une policy **role-only** (clause owner supprimée) → le Sales propriétaire perd l'accès DB au coût RMB. Les **prix finaux** sont stockés sur `project_requests` (lisibles par Sales).

## Pricing
`computeSectionPrice` (`lib/project-pricing.ts`) : `usdCost = costRmb/exchangeRate` ; `price = usdCost·(1−taxRebate)/(1−margin)` + commission. Product & Pole pricés indépendamment ; Freight en pass-through (marge 0). Override du coût par Director = **raison obligatoire + audit append-only** (`pr.cost_overridden`, severity high).

## Événements émis
18 events `pr.*` (created, submitted, approved, rejected, info_requested, cost_entered, cost_overridden, packing_entered, freight_entered, freight_update_requested, freight_updated, ready_for_pricing, priced, quotation_generated, won, lost, cancelled). Chaque étape sonne le **prochain acteur** (allowlist actionable-medium). Voir [../08-Events.md](../08-Events.md).

## Dépendances & modules concernés
- **Affaires** (parent obligatoire), **Documents** (`generateQuotationFromProject` → `saveDocument`), **Pricing** (exchange rate, tax rebate), **Prospects/Tenders** (un tender mûr peut lancer une Service Request via `/projects/new?tender=`), **Notifications** (handoffs via RLS events m092).

## UNKNOWN / TO BE VALIDATED
- **Approbation Director non testée E2E** (HANDOVER).
- Statut `submitted` jamais écrit (mort/futur).
- `setProjectOutcome` `won` sans garde « priced » préalable.
- Notifications = broadcast par visibilité RLS, pas adressé.
</content>
