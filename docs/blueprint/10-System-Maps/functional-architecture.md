# Carte — Architecture fonctionnelle

## 1. Couches techniques

```mermaid
flowchart TB
    subgraph Client["Navigateur (React 18)"]
        UI[Pages SSR + Server Components]
        PDF[Génération PDF au clic @react-pdf]
        Drawers[Conversations / Action Center / Bell]
    end
    subgraph Server["Next.js 14 (App Router)"]
        MW[middleware.ts: auth + redirect]
        SA[Server Actions actions.ts: mutations]
        Guards[Gardes: requireCapability / RLS]
        Lib[lib/ services purs + serveur]
    end
    subgraph Supabase["Supabase"]
        Auth[Auth JWT]
        PG[(PostgreSQL + RLS)]
        Store[Storage: documents, product-images]
    end
    UI -->|navigation| MW
    UI -->|form action| SA
    SA --> Guards
    Guards --> Lib
    Lib --> PG
    SA --> PG
    PDF --> Store
    MW --> Auth
    SA -.->|emitEvent| PG
```

## 2. Architecture fonctionnelle (modules métier)

```mermaid
flowchart TB
    subgraph CRM["CRM amont"]
        PROS[Prospects & Tenders<br/>prototype]
    end
    subgraph Core["Cœur commercial → production → finance"]
        CLI[Clients · Affaires · Contacts]
        SR[Service Requests]
        DOC[Documents<br/>Devis & Proformas]
        TL[Task Lists<br/>& Factory Mapping]
        PO[Production Orders<br/>& Operations]
        FIN[Finance & Cost Entry]
    end
    subgraph Master["Master-data & gouvernance"]
        CAT[Catalog & Pricing]
        ADM[Admin & Permissions]
    end
    subgraph Cross["Couche transverse"]
        EVT[Events / Audit]
        NOTIF[Notifications / Conversations]
        DASH[Dashboards / Action Center]
    end
    PROS -->|convertit| CLI
    CLI --> SR
    CLI --> DOC
    SR -->|produit| DOC
    DOC -->|won → launch| TL
    TL -->|validé| PO
    PO --> FIN
    CAT -->|prix + config| DOC
    CAT -->|config + mapping| TL
    ADM -.->|gouverne| Core
    Core -.->|emitEvent| EVT
    EVT --> NOTIF
    EVT --> DASH
    Core -.->|état| DASH
```

## 3. Lecture
- Le **cœur** (Clients → Documents → Task Lists → Production → Finance) est la chaîne validée end-to-end.
- Le **CRM amont** (Prospects/Tenders) est un prototype qui alimente le cœur.
- Les **master-data** (Catalog/Pricing) nourrissent les devis et la production ; **Admin/Permissions** gouverne tout.
- La **couche transverse** (Events → Notifications/Dashboards) est **dérivée** : tout y est recalculé à la lecture, sans job d'arrière-plan.
</content>
