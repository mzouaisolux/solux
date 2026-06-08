# Shipping Process — Current Implementation

> **Audit note.** Grounded in `lib/shipping.ts` (m070 `ShippingDetails`),
> `lib/bl.ts` (m054 `BlProfile`), `supabase/migrations/070_shipping_bl_details.sql`,
> `054_client_bl_profile.sql`, and `004_logistics_and_contacts.sql` /
> `007_lcl_shipping.sql` (ports/incoterm/containers on the quote). Field
> editing surfaces (`ClientBlEditor`, the order Shipping/BL section) are
> inferred from code + history; exact UI behavior is tagged **Needs
> confirmation** where not directly read this pass.

---

## 1. Shipping data is split across THREE entities (Confirmed by code)

This is the single most important fact about shipping in this app: there is **no
one shipping record**. Fields live where they're authored:

| Where | Storage | Fields |
|---|---|---|
| **Client** | `clients.bl_profile` (jsonb, m054) | shipper, consignee, notify party, export-document checklist, notes |
| **Quotation** | `documents` columns | `port_of_loading`, `port_of_destination`, `incoterm`, `freight_type`, + container plan in `document_containers` |
| **Production order** | `production_orders.shipping_details` (jsonb, m070) + columns | BL number, forwarder, vessel/voyage, weights, CBM, packages, HS code; + `etd`, `eta`, `shipment_booked`, `shipping_notes` |

`lib/shipping.ts` header states this explicitly: *"Parties (consignee / notify)
live on the client's BL profile (m054); ports / incoterm live on the quote;
ETD / ETA / booking live as their own order columns. This holds what those
don't."*

---

## 2. Parties — `clients.bl_profile` (m054, `lib/bl.ts`)

A **reusable per-client template**. Shape (`BlProfile`):

- **`shipper`** (`BlShipper`): company_name, address, contact_person, phone,
  email. **Defaults to `SOLUX_SHIPPER_DEFAULT`** ("CHANGZHOU SOLUX TECHNOLOGY
  COMPANY LTD", Vera Yang, +86 182 6115 6967, vera@zr-light.com.cn) — prefilled
  & editable; falls back to the default if all fields are blank.
- **`consignee`** (`BlConsignee`): `same_as_client` flag (prefill from the
  client's company), company_name, address, country, contact_person, phone,
  email, **tax_id**.
- **`notify`** (`BlNotify`): `same_as_consignee` flag (prefill from consignee),
  company_name, address, country, contact_person, phone, email.
- **`documents`** (`BlDocument[]`): export-document **checklist** from
  `BL_DOCUMENT_CATALOG` — ECTN, Commercial Invoice, Packing List, Bill of
  Lading, Certificate of Origin, Form E / EUR1, Insurance Certificate,
  IEC/CE/RoHS Certificates, Battery MSDS, Inspection Report, Warranty Letter.
  Each row: `included` (ticked), optional `cost` + `currency`, `custom` flag for
  manual rows. `blDocumentCostByCurrency` sums included-doc costs per currency.
- **`notes`**: free text — the only "BL instructions"-like field (see §6).

**Editing surface:** `ClientBlEditor` on the client edit page →
`updateClientBlProfile` action (tasks #28–31, #33). **Editable any time** the
client is editable. **Confirmed by code** (history) / exact route **Needs
confirmation**.

---

## 3. Ports, incoterm, container — on the quotation (`documents`)

- **`port_of_loading`** and **`port_of_destination`** — columns on `documents`
  (m004/m007). **Confirmed** (referenced as `doc.port_of_destination` in
  `lib/action-center.ts`).
- **`incoterm`** — `EXW | FOB | CFR | CIF | DDP | DDU` (m004).
- **`freight_type`** — `LCL | 20ft | 40ft HC` (m007).
- **Container info** — `document_containers` table; `container_type` CHECK
  `LCL | 20ft | 40ft | 40ft HC` (fixed in m063). Container *info therefore lives
  on the QUOTE, not on the order's shipping_details*. **Confirmed.**

> **Incoterm drives downstream shipping actions** (`lib/action-center.ts
> blRequired`): the seller-ships incoterms `CFR / CIF / DDP / DDU` (or any
> `LCL` freight) require BL/destination follow-up; `EXW / FOB` do not (buyer
> arranges). **Confirmed by code.**

---

## 4. BL execution fields — `production_orders.shipping_details` (m070)

`ShippingDetails` (`lib/shipping.ts`), v1 essential set:

| Field | Type | Meaning |
|---|---|---|
| `bl_number` | string\|null | Bill of Lading number (once carrier issues it) |
| `forwarder` | string\|null | freight forwarder / agent |
| `vessel` | string\|null | vessel name |
| `voyage` | string\|null | voyage number |
| `gross_weight` | number\|null | kg |
| `net_weight` | number\|null | kg |
| `cbm` | number\|null | cubic metres |
| `packages` | number\|null | number of packages/cartons |
| `hs_code` | string\|null | Harmonised System customs code |

- Stored as **jsonb** (no DB-level schema) — shape enforced only by
  `normalizeShippingDetails`. Helpers: `emptyShippingDetails`,
  `isShippingDetailsEmpty`.
- ETD / ETA / `shipment_booked` / `shipping_notes` remain **separate columns**
  on `production_orders` (not inside the jsonb).
- **Editing surface:** the "Shipping / BL" section on
  `/production/orders/[id]` (gated by `production_order.edit_shipment`). Exact
  component name **Needs confirmation**.

---

## 5. Editability after order creation

| Data | Editable after order exists? | Notes |
|---|---|---|
| `bl_profile` (parties, docs) | Yes — on the client edit page | reusable across the client's orders |
| ports / incoterm / freight / containers | On the **quotation** | whether the quote is locked once `won`/in production is **Needs confirmation** |
| `shipping_details` (BL exec) | Yes — on the order page | `production_order.edit_shipment` |
| ETD / ETA / booking | Yes — on the order page | own columns |

---

## 6. Missing / absent shipping fields (for the audit)

- **Shipping marks / case marks — MISSING.** No `shipping_marks` field exists in
  `bl.ts`, `shipping.ts`, or any migration found. If shipping marks are needed
  on the BL, they are currently **not modeled**. **Confirmed absent.**
- **Structured "BL instructions" — MISSING.** The only free-text spaces are
  `bl_profile.notes` (client level) and `production_orders.shipping_notes`
  (order level). There is no dedicated structured BL-instructions field, and
  having two separate notes fields invites ambiguity about which to use.
  **Confirmed; needs a decision.**
- **Container ↔ order link** — containers are planned on the quote
  (`document_containers`) but the order's `shipping_details` has **no container
  reference**; the actual loaded container(s) for a shipment are not recorded on
  the order. **Suspected gap — Needs confirmation.**
- **No file storage for BL documents** — the document checklist (m054) tracks
  *which* documents are required and their cost, but file upload is
  *intentionally out of scope* (`lib/bl.ts` comment). Actual files would go
  through the separate `attachments` system (m060). **Confirmed by code.**
- **`freight_type` vs `container_type` value mismatch** — `freight_type`
  (`LCL|20ft|40ft HC`) lacks the plain `40ft` that `container_type` allows.
  **Confirmed** (see POTENTIAL_INCONSISTENCIES.md & DATABASE_STRUCTURE.md §7).

---

## 7. Save / reload correctness

- **`shipping_details` round-trips correctly** through
  `normalizeShippingDetails` (partial/legacy/null → full shape). Saving and
  reloading the order's BL fields is consistent **for the keys the editor
  writes** (`bl_number`, `forwarder`, `vessel`, …). **Confirmed by code.**
- **`bl_profile` round-trips correctly** through `normalizeBlProfile` (merges
  saved catalog rows over the default by key, preserves custom rows, backfills
  the Solux shipper when blank). **Confirmed by code.**
- ⚠️ **Auto-clear key mismatch (Suspected bug).** The Action Center's
  `blIsFilled()` (`lib/action-center.ts`, line ~336) checks
  `shipping_details["forwarder_name"]` and `["vessel_name"]`, but the editor
  stores **`forwarder`** and **`vessel`** (per `ShippingDetails`). Result: only
  `bl_number` (or a filled client consignee company) makes the "BL missing"
  action self-clear; entering **forwarder/vessel alone does not clear it**. The
  data saves & reloads fine on the order page — but the notification logic reads
  the wrong keys. **See POTENTIAL_INCONSISTENCIES.md.** This is the most
  concrete shipping-related defect found.
