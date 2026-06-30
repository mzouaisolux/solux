# Objet — Documents d'expédition (Commercial Invoice / BL / Packing)

## Définition
Les **documents de transport** d'une commande expédiée. Deux notions :
1. Le **profil BL** (Bill of Lading) — défini sur le **client** (`clients.bl_profile`), réutilisable.
2. Les **documents d'expédition** générés/stockés sur le **production order** : Commercial Invoice (CI), Packing List, B/L, documents LC.

## Commercial Invoice (CI)
- **Document d'EXPÉDITION** (pas comptable). Numéro `CI-XXXX` (m115, minté une fois via RPC `next_ci_number`).
- PDF généré côté navigateur (`CommercialInvoicePDF` / `ShippingDocumentsCard`), classé dans le hub `order_documents` (catégorie « shipping »). La regénération crée une nouvelle **version** du même numéro.

## Checklist des documents d'expédition (m115, dérivée)
**Calculée** (zéro persistance) à partir du mode de paiement + profil BL :
- **Mandatory** (toujours) : Commercial Invoice + Packing List + B/L.
- **+ documents LC** si mode `lc`/`hybrid`.
- Niveaux : mandatory / required / optional (optional ne bloque jamais).

## Profil BL (`clients.bl_profile`, m054)
- Shipper (défaut Solux), consignee, notify, catalogue de documents, notes.
- **Complétude calculée** (jamais stockée) : `blProfileStatus` = complete / partial / missing.
- **Gate booking** : confirmer l'expédition (`shipment_booked`) exige un profil **complete**.
- **Boucle Ops↔Sales** : Operations demande l'info BL au Sales (`po.bl_info_requested`, sonne le Sales, crée une planned action) ; le Sales complète → `po.bl_info_resolved` (blocage levé).

## Données
- `clients.bl_profile` (jsonb), `production_orders.shipping_details` (jsonb m070 : bl_number, forwarder, vessel, voyage, weights, cbm, packages, hs_code), `production_orders.commercial_invoice_number`, `order_documents` (versions de fichiers).

## Dépendances
- **Client** (profil BL), **Production Order** (porte les docs), **Quotation/Proforma** (mode de paiement → quels docs LC).

## Documents associés
- PDF **« COMMERCIAL INVOICE »** (CI-XXXX).
- Fichiers uploadés (B/L, Packing List, certificats…) dans `order_documents`.

## Règles clés
- Gate booking : profil BL complet obligatoire.
- CI minté une fois ; regénération = nouvelle version même numéro.
- Checklist dérivée du mode de paiement (optional ne bloque jamais).
</content>
