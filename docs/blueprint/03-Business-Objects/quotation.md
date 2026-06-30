# Objet — Quotation (Devis)

## Définition
L'**offre commerciale chiffrée** envoyée au client — le document de négociation. Table `documents` avec `type = 'quotation'`. **Source unique du revenu (CA)** : un devis `won` = du CA. Évolue par **versions** (V1/V2/V3) au sein d'une affaire.

## Cycle de vie
```
draft → sent → negotiating → won
  │                          
  └──────────► lost / cancelled (terminal, cascade)
```
- Une fois `sent`, un devis n'est **jamais** édité en place → une modification crée une **nouvelle version** (V2…).
- Boucle de validation **advisory** (m068) : `validation_status` = none → pending → approved/rejected (ne bloque jamais l'envoi/won).
Détail : [../04-Business-Workflows/quotation-lifecycle.md](../04-Business-Workflows/quotation-lifecycle.md).

## Propriétaire
- `created_by` (créateur) + `sales_owner_id` (deal owner, réassignable par `canSupervise`, descend vers task list/PO).

## Données (champs clés)
| Champ | Rôle |
|---|---|
| `number` | `SLX-{code}-{YY}-{NNN}` (+ `-Vn`) — immuable |
| `type` = quotation | Distingue du proforma |
| `status` | Cycle de vie |
| `affair_id` (obligatoire), `client_id` | Rattachement |
| `total_price` | Grand total |
| `payment_mode` + `payment_terms` (jsonb) | Conditions de paiement |
| `version` + `root_document_id` | Versioning |
| `validation_status` | Boucle advisory (m068) |
| `forecast_*` | Prévision pondérée |
| `original_sales_request` | Besoin client free-text (m134) |
| lignes (`document_lines`) | Produits, config, prix |

## Dépendances
- **Affaire** (parent obligatoire), **Catalog/Pricing** (produits + prix), **Forecast** (champs sur le doc), **Proforma** (généré au won), **Service Request** (peut générer un devis).

## Documents associés
- **PDF « QUOTATION »** (`QuotationPDF`, nom `QUOTATION_{number}_{client}_{affair}.pdf`).
- Conditions de vente + banque (selon devise) imprimées.

## Règles clés
- Affaire obligatoire ; numéro immuable ; édition-en-place réservée aux drafts.
- Numérotation exige `client_code`.
- Annulation → **cascade DB** (trigger m023) sur task lists + orders liés.
- CA = devis **won** uniquement (la proforma ne compte jamais).
</content>
