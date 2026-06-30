# 03 — Objets métier

> Un fichier par objet : définition, cycle de vie, propriétaire, données, dépendances, documents associés.
> Source des statuts : `lib/types.ts` (lu intégralement) + migrations.

## Liste des objets

| Objet | Table | Fichier | Statuts |
|---|---|---|---|
| Client | `clients` | [client.md](client.md) | actif / archivé |
| Affaire (Project) | `affairs` | [affaire-project.md](affaire-project.md) | lead → … → completed (+ lost/abandoned) |
| Contact | `contacts` | [contact.md](contact.md) | — |
| Service Request | `project_requests` | [service-request.md](service-request.md) | draft → … → won/lost/cancelled (11) |
| Quotation (Devis) | `documents` (type=quotation) | [quotation.md](quotation.md) | draft → sent → negotiating → won/lost/cancelled |
| Proforma (Commande) | `documents` (type=proforma) | [proforma.md](proforma.md) | draft (porte le cycle production) |
| Task List | `production_task_lists` | [task-list.md](task-list.md) | draft → under_validation → needs_revision ↔ → validated → production_ready / cancelled |
| Factory Mapping | `factory_mappings` | [factory-mapping.md](factory-mapping.md) | active / inactive |
| Production Order | `production_orders` | [production-order.md](production-order.md) | awaiting_deposit → … → delivered (+ cancelled) |
| Paiement (Dépôt / Solde / LC) | (champs sur `production_orders`) | [payment-deposit-balance.md](payment-deposit-balance.md) | états dérivés |
| Documents d'expédition (CI / BL) | `order_documents` + `shipping_details` | [shipping-documents.md](shipping-documents.md) | — |
| Produit & Catalogue | `products`, `product_categories`, `config_fields` | [product-catalog.md](product-catalog.md) | active / inactive |
| Price List | `price_lists` | [price-list.md](price-list.md) | draft → published → archived |
| Événement (audit) | `events` | [event.md](event.md) | open → … → resolved |
| Utilisateur / Rôle / Capability | `user_roles`, `role_permissions` | [user-role-capability.md](user-role-capability.md) | — |

## La chaîne des objets

```
Client ─1:N─► Affaire ─1:N─► { Service Request ─produit─► Quotation }
                                Quotation ─[won]─► Proforma ─1:1─► Task List ─[validated]─► Production Order
                                                                                              ├─ Paiement (dépôt/solde/LC)
                                                                                              └─ Documents d'expédition (CI/BL)
Catalogue (Produit + Catégorie + Config) ─alimente─► Quotation & Task List
Factory Mapping ─traduit la config─► Task List (gate de release)
Price List ─fixe les prix─► Quotation
Événement ─trace chaque transition de tous les objets ci-dessus
```
</content>
