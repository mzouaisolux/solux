# 02 — Modules

> Un fichier par module : objectif métier, utilisateurs, données manipulées, dépendances, modules concernés.
> Les détails de cycle de vie sont dans [../03-Business-Objects/](../03-Business-Objects/) et [../04-Business-Workflows/](../04-Business-Workflows/) ; les règles dans [../06-Business-Rules.md](../06-Business-Rules.md).

## Liste des modules

| Module | Fichier | Rôle dans la chaîne |
|---|---|---|
| Clients · Affaires · Contacts | [clients-affaires-contacts.md](clients-affaires-contacts.md) | Référentiel CRM cœur (Client → Affaire) |
| Service Requests | [service-requests.md](service-requests.md) | Intake custom / appel d'offres → devis |
| Documents (Devis & Proformas) | [documents-quotations-proformas.md](documents-quotations-proformas.md) | Offres chiffrées + commandes |
| Task Lists & Factory Mapping | [task-lists-factory-mapping.md](task-lists-factory-mapping.md) | Feuille d'atelier + validation production |
| Production Orders & Operations | [production-orders-operations.md](production-orders-operations.md) | Suivi production / expédition / livraison |
| Finance & Cost Entry | [finance-cost-entry.md](finance-cost-entry.md) | Balances, dépôts, LC (lecture) + coûts RMB |
| Prospects & Tenders (CRM sandbox) | [prospects-tenders.md](prospects-tenders.md) | CRM amont (AO, intelligence) — *prototype* |
| Dashboards & Action Center | [dashboards-action-center.md](dashboards-action-center.md) | Synthèse, files d'action, feeds |
| Notifications · Conversations · Attachments | [notifications-conversations-attachments.md](notifications-conversations-attachments.md) | Couche collaborative transverse |
| Catalog & Pricing | [catalog-pricing.md](catalog-pricing.md) | Produits, catégories, listes de prix |
| Admin & Permissions | [admin-permissions.md](admin-permissions.md) | Utilisateurs, rôles, matrice, équipes, diagnostics |

## Carte des dépendances inter-modules (résumé)

```
Catalog/Pricing ──fournit produits+prix──► Documents ──génère──► Task Lists ──valide──► Production Orders ──alimente──► Finance
      ▲                                        ▲                                                  │
      │                                        │                                                  ▼
Admin/Permissions ──gouverne tous les modules  Clients/Affaires ──conteneur de tout le travail commercial
      │                                        ▲
Prospects/Tenders ──convertit en──────────────┘ + Service Requests ──produit un devis──► Documents
```

Tous les modules émettent vers la couche transverse **Events → Notifications → Dashboards** (voir [../08-Events.md](../08-Events.md), [../09-Notifications.md](../09-Notifications.md)).
</content>
