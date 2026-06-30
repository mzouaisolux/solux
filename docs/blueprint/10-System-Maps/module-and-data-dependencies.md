# Carte — Dépendances modules & flux de données

## 1. Dépendances entre modules

```mermaid
flowchart LR
    ADM[Admin & Permissions] -.->|gouverne| ALL((tous))
    CAT[Catalog & Pricing] -->|produits + prix + config| DOC[Documents]
    CAT -->|config_fields + category_id| TL[Task Lists]
    CLI[Clients & Affaires] -->|parent obligatoire| DOC
    CLI -->|parent| SR[Service Requests]
    SR -->|generateQuotation| DOC
    DOC -->|launchProduction| TL
    TL -->|factory mapping résolu| FM[Factory Mapping]
    TL -->|validé| PO[Production Orders]
    PO -->|balances| FIN[Finance]
    CLI -->|profil BL| PO
    PROS[Prospects & Tenders] -->|convertit| CLI
    PROS -->|tender → SR| SR
    DOC -.->|events| EVT[Events]
    TL -.->|events| EVT
    PO -.->|events| EVT
    SR -.->|events| EVT
    CLI -.->|events| EVT
    EVT --> NOT[Notifications]
    EVT --> DASH[Dashboards]
```

## 2. Flux de données — du devis à l'encaissement

```mermaid
flowchart LR
    subgraph Données
    PROD[products + config_fields] --> LINE[document_lines]
    PRICE[price_lists publiées] --> LINE
    end
    LINE --> Q[documents quotation]
    Q -->|copie| PF[documents proforma]
    PF -->|copie lignes| TLL[task_list_lines]
    TLL -->|résout| FM[factory_mappings]
    TLL --> POO[production_orders]
    PT[payment_terms du devis] --> POO
    POO -->|deposit/balance/LC| FINV[/finance lecture/]
    COST[product_costs RMB] --> PRICE
```

## 3. Dépendances de la couche `lib/`

| Module | Dépend de (`lib/`) |
|---|---|
| Documents | `payment`, `pdf-filename`, `validation`, `pricing`, `price-lists` |
| Task Lists | `task-list-mapping-status`, `task-list-mapping-server`, `types` (resolveFactoryInstruction), `factory-mapping-clone` |
| Production | `production-lifecycle`, `delays`, `working-days`, `bl`, `shipping`, `shipping-docs`, `operations-alerts`, `payment` |
| Service Requests | `project-pricing`, `project-dashboard`, `project-queue`, `service-types`, `freight-validity` |
| Clients/Affaires | `client-affairs`, `affairs-prototype`, `owner`, `visibility` |
| Prospects | `tender-identity`, `attribution-parse`, `prospect-intel`, `tender-discovery` |
| Pricing | `pricing-engine`, `pricing`, `price-lists`, `pricing-settings` |
| Transverse | `events`, `events-shared`, `notifications`, `notification-catalog`, `action-center`, `dashboard-items`, `reminders`, `entity-messages`, `forecast` |
| Sécurité | `auth`, `permissions`, `visibility`, `types` |

## 4. Couplages clés à connaître
- **`lib/types.ts`** est le socle partagé (statuts, helpers de rôle, `resolveFactoryInstruction`, calculs de paiement) — importé presque partout.
- **`lib/events.ts`** (serveur) re-exporte **`lib/events-shared.ts`** (pur) pour que les composants client puissent importer les types sans tirer `next/headers`.
- Le **cœur figé** (commit `157e52c`) importe des symboles d'autres lots non commités (ex. `canSupervise` de `lib/types`) — il ne build pas en isolation (voir HANDOVER).
</content>
