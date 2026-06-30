# Business & Application Blueprint — Solux Hub (ERP/CRM)

> **Référence officielle du fonctionnement métier de l'application.**
> Rédigée 2026-06-29 par analyse du code (mode lecture seule, aucune modification).
> Destinée aux **dirigeants, nouveaux collaborateurs, consultants métier, spécialistes IA et futurs développeurs** — PAS un guide d'implémentation.

L'objectif est de pouvoir **comprendre, discuter et améliorer** le comportement de l'application **sans lire le code**. Chaque affirmation est reliée à un composant, une action serveur, une migration ou une logique existante.

---

## ⚠️ Source de vérité (où vit le code décrit ici)

- **Repo canonique : `~/dev/facturation`** (git-tracké). Branche `freeze/core-metier`, HEAD `157e52c`.
- Une copie iCloud (`~/Library/Mobile Documents/.../APP FACTURATION`) existe mais est **périmée** — ne reflète pas le code décrit ici.
- Stack : **Next.js 14 (App Router) + React 18 + TypeScript + Supabase (PostgreSQL + RLS + Auth + Storage)**, PDF via `@react-pdf/renderer`, Tailwind CSS. 133 migrations SQL.
- ⚠️ Le projet est **en cours de refonte UI "premium" non commitée** (~206 fichiers WIP). Cette documentation décrit l'**état du code lu** (working tree), qui peut différer de ce qui est commité sur `main`.

---

## Convention de fiabilité (lire avant tout)

Chaque affirmation porte, quand c'est utile, un marqueur :

| Marqueur | Signification |
|---|---|
| **[V]** | **Vérifié** — observé directement dans le code, et/ou testé end-to-end d'après les rapports E2E du projet. |
| **[P]** | **Probable** — déduit du code de façon cohérente, mais non testé end-to-end. |
| **UNKNOWN** | Comportement **non déterminable** depuis le code seul. À investiguer. |
| **TO BE VALIDATED** | Règle **implicite** (présente dans le code) dont l'intention métier doit être confirmée par le métier. |

**Principe directeur : ne rien inventer.** Quand plusieurs comportements coexistent, les deux sont documentés. Les chemins de fichiers sont cliquables sous la forme `chemin:ligne`.

---

## Plan de la documentation (10 phases)

| # | Document | Contenu | État |
|---|---|---|---|
| 1 | [01-Application-Inventory.md](01-Application-Inventory.md) | Inventaire : modules, écrans, routes, objets, rôles, dashboards, menus, composants | ✅ Rédigé |
| 2 | [02-Modules/](02-Modules/) | Un fichier par module (objectif, utilisateurs, données, dépendances) — 11 modules | ✅ Rédigé |
| 3 | [03-Business-Objects/](03-Business-Objects/) | Un fichier par objet métier (définition, cycle de vie, propriétaire, données, documents) — 14 objets | ✅ Rédigé |
| 4 | [04-Business-Workflows/](04-Business-Workflows/) | Workflows métier (Mermaid + tableau + explication FR) — 8 workflows | ✅ Rédigé |
| 5 | [05-Application-Workflows/](05-Application-Workflows/) | Workflows techniques (notifications, events, audit, compteurs, jobs) | ✅ Rédigé |
| 6 | [06-Business-Rules.md](06-Business-Rules.md) | Toutes les règles métier (« on ne peut pas X si Y ») | ✅ Rédigé |
| 7 | [07-Roles-and-Permissions.md](07-Roles-and-Permissions.md) | Rôles : responsabilités, permissions, restrictions, écrans, actions | ✅ Rédigé |
| 8 | [08-Events.md](08-Events.md) | Tous les événements (déclencheur, consommateurs, notifications, dashboards) | ✅ Rédigé |
| 9 | [09-Notifications.md](09-Notifications.md) | Toutes les notifications (émetteur, raison, destinataire, moment) | ✅ Rédigé |
| 10 | [10-System-Maps/](10-System-Maps/) | Cartographie (Mermaid, séquences, flux, dépendances, archi fonctionnelle) | ✅ Rédigé |

---

## La chaîne métier en une image (à lire en premier)

```
Client
  └─ Affaire (Project / "affair")                 ← le conteneur d'opportunité (obligatoire)
       ├─ Service Request (project_requests)       ← (optionnel) intake custom/appel d'offres → produit un devis
       └─ Quotation / Devis (documents)            ← l'offre chiffrée envoyée au client
            └─ [Won] → 🚀 Launch Production
                 └─ Proforma (documents)            ← la COMMANDE (copie du devis gagné) — jamais du CA
                      └─ Task List (production_task_lists)  ← la feuille d'atelier
                           ├─ Factory Mapping       ← config commerciale → instruction usine (autonome, réutilisable)
                           ├─ Boucle de révision    ← TLM ↔ Sales
                           └─ [Validated] → Production Order (production_orders)  ← suivi prod / paiement / expédition
                                                          └─ Finance (balances, dépôts, LC)
```

> **Revenu (CA)** = somme des **devis (Quotations) gagnés**. La **Proforma** est la *commande*, jamais un second deal — elle ne compte **jamais** comme du CA.

---

## Glossaire express (termes canoniques)

| Terme (FR) | Terme (EN) | Table interne | Définition courte |
|---|---|---|---|
| Client | Client | `clients` | L'entreprise cliente. A un propriétaire (account owner). |
| Affaire / Projet | Project | `affairs` | Le conteneur d'opportunité sous un client. Obligatoire pour tout devis/demande. |
| Demande de service | Service Request | `project_requests` | Intake custom/appel d'offres, qualifié puis chiffré, qui produit un devis. |
| Devis | Quotation | `documents` (type=quotation) | L'offre commerciale chiffrée. **CA = devis gagnés.** |
| Proforma / Commande | Proforma | `documents` (type=proforma) | La commande de production (copie d'un devis gagné). |
| Liste de tâches | Task List | `production_task_lists` | La feuille d'atelier générée depuis la proforma. |
| Mapping usine | Factory Mapping | `factory_mappings` | Règle config commerciale → instruction usine (réutilisable). |
| Ordre de production | Production Order | `production_orders` | Suivi production/expédition/livraison après validation de la task list. |

> Voir aussi le glossaire historique du projet : [../GLOSSARY.md](../GLOSSARY.md) et le dossier de passation : [../HANDOVER.md](../HANDOVER.md).
</content>
