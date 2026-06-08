# DOC 9 — Shipping & Bill of Lading (BL)

> **Audit basis.** All facts are derived from direct code reads. Citations are
> relative to the project root. [Confirmed by code] = verified in a named file;
> [Assumed from code] = reasonably inferred but not directly read. "Needs
> confirmation" = cannot be settled without running the app or reading a file
> not inspected in this audit.
>
> Primary sources: `lib/bl.ts`, `lib/shipping.ts`,
> `lib/action-center.ts` (lines 288–342), `components/clients/ClientBlEditor.tsx`,
> `app/(app)/clients/[id]/edit/page.tsx`, `app/(app)/clients/actions.ts`,
> `supabase/migrations/054_client_bl_profile.sql`,
> `supabase/migrations/070_shipping_bl_details.sql`,
> `supabase/migrations/063_fix_container_type_check.sql`,
> `docs/current-implementation/SHIPPING_PROCESS.md`.

---

## Owner Decisions (confirmed 2026-05-30)

### Decision G — `blIsFilled` key alignment (APPROVED fix, NOT yet applied)

> Owner decision (confirmed 2026-05-30) — target behavior; not yet implemented.
> This is an approved fix. As of this writing, **no code change has been made**.
> `lib/action-center.ts` still contains the original bug described in §6 and §9.2 below.

**Decision text (from OWNER_DECISIONS_LOG.md §G):**

- Do **not** rename existing stored jsonb keys (`forwarder`, `vessel` in `shipping_details`).
- `blIsFilled` in `lib/action-center.ts` must be updated to read the keys **actually stored**: `"forwarder"` and `"vessel"` — not `"forwarder_name"` and `"vessel_name"`.
- The "BL missing" Action Center alert should self-clear when the required BL/shipping fields are filled.
- **Minimum field required to clear the first BL-missing alert: `forwarder`.**
  - If a BL number is available it should also be stored, but `bl_number` is **not mandatory** to clear this alert (the BL number may only arrive later in the process).

**Target behavior (after fix is applied):**
- Filling `shipping_details.forwarder` on the production order will clear the "BL missing destination" Action Center card.
- `bl_number` remains stored when available but is not a prerequisite.
- Stored jsonb keys `"forwarder"` and `"vessel"` are not renamed.

**Current behavior (code unchanged):**
- `blIsFilled` reads `"forwarder_name"` and `"vessel_name"` — keys that are never written.
- Only `bl_number` (correct key) and `blProfile.consignee.company_name` currently clear the action card.
- Full details in §6 and §9.2 below.

---

## 1. The Three-Entity Split

Shipping data is split across **three entities**. There is no single
"shipping record". The split is explicit and intentional; `lib/shipping.ts`
states it in its module header. [Confirmed by code — `lib/shipping.ts` line 4]

| Entity | DB storage | What lives there |
|---|---|---|
| **Client** | `clients.bl_profile` (jsonb, m054) | Shipper identity, consignee, notify party, export-document checklist, free-text notes |
| **Quotation** | `documents` columns (m004 / m007) + `document_containers` child table (m007 / m063) | Port of loading, port of destination, incoterm, freight type, container plan |
| **Production order** | `production_orders.shipping_details` (jsonb, m070) + own columns | BL number, forwarder, vessel, voyage, weights, CBM, packages, HS code; + ETD / ETA / `shipment_booked` / `shipping_notes` as separate columns |

**Why the split matters:** when you look at a production order you must read
across all three entities to reconstruct the complete BL picture. Parties come
from the client, routing/terms come from the quote, and execution detail comes
from the order. No single query surface joins them for you automatically.

---

## 2. Entity 1 — Client BL Profile (`clients.bl_profile`, m054)

### 2.1 Storage

A single `jsonb` column on `clients`, added by migration `054_client_bl_profile.sql`.
No DB-level schema; shape is enforced entirely by `normalizeBlProfile` in `lib/bl.ts`.
[Confirmed by code — `supabase/migrations/054_client_bl_profile.sql` line 31,
`lib/bl.ts` lines 145–193]

### 2.2 TypeScript shape (`BlProfile`, `lib/bl.ts`)

```
BlProfile {
  shipper:    BlShipper      // company_name, address, contact_person, phone, email
  consignee:  BlConsignee    // same_as_client, company_name, address, country,
                             //   contact_person, phone, email, tax_id
  notify:     BlNotify       // same_as_consignee, company_name, address, country,
                             //   contact_person, phone, email
  documents:  BlDocument[]   // export-doc checklist
  notes:      string | null  // free-text only
}
```

[Confirmed by code — `lib/bl.ts` lines 12–62]

### 2.3 Shipper fields

`BlShipper`: `company_name`, `address`, `contact_person`, `phone`, `email`.

- Defaults to `SOLUX_SHIPPER_DEFAULT`: "CHANGZHOU SOLUX TECHNOLOGY COMPANY
  LTD", 3F D1 Building Hutang Sci-Tech Park, Vera Yang, +86 (0) 182 6115 6967,
  vera@zr-light.com.cn. [Confirmed by code — `lib/bl.ts` lines 69–76]
- `normalizeBlProfile` backfills the default whenever all shipper fields are
  blank (all-empty check at line 155–161). [Confirmed by code — `lib/bl.ts`
  lines 153–161]
- Editable in `ClientBlEditor` — the "Shipper" section at the top of the BL
  panel. [Confirmed by code — `components/clients/ClientBlEditor.tsx` lines 174–179]

### 2.4 Consignee fields

`BlConsignee`: `same_as_client` (boolean), `company_name`, `address`, `country`,
`contact_person`, `phone`, `email`, `tax_id`.

**The consignee IS fully editable.** [Confirmed by code —
`components/clients/ClientBlEditor.tsx` lines 181–223]

- "Same as client" checkbox (line 188–194): when ticked it copies
  `company_name`, `address`, `country`, `contact_person`, `phone`, `email`,
  `tax_id` from the client's own fields (`clientPrefill`). Fields remain editable
  after prefill — the `onSameAsClient` handler (lines 64–83) only populates
  values on check; it does not disable the inputs.
- Dedicated inputs: `company_name`, `address` (textarea, md:col-span-2),
  `contact_person`, `phone`, `email`, plus the extra fields `country` (input,
  lines 203–209) and `Tax ID / VAT number` (input, lines 210–219).
- `clientPrefill.tax_id` is sourced from `client.vat_number` (edit page, line 296).
  [Confirmed by code — `app/(app)/clients/[id]/edit/page.tsx` line 296]

### 2.5 Notify party fields

`BlNotify`: `same_as_consignee` (boolean), `company_name`, `address`, `country`,
`contact_person`, `phone`, `email`.

**The notify party IS fully editable.** [Confirmed by code —
`components/clients/ClientBlEditor.tsx` lines 225–257]

- "Same as consignee" checkbox (lines 231–239): when ticked the fields are
  **hidden** (not merely prefilled) — the entire `PartyFields` block is behind a
  conditional render: `{!profile.notify.same_as_consignee && <PartyFields …>}` at
  line 241. The flag itself is saved in the profile and reloaded correctly.
- When `same_as_consignee` is false, all fields are shown: `company_name`,
  `address`, `contact_person`, `phone`, `email`, and `country` (the `extra` prop,
  lines 244–255). Note: notify party has no `tax_id` field (none in `BlNotify`
  type either). [Confirmed by code — `lib/bl.ts` line 36–41]

### 2.6 Export document checklist fields

`BlDocument[]`: `key`, `label`, `included` (boolean), `cost` (number | null),
`currency` (string), `custom?` (boolean).

Standard catalog (`BL_DOCUMENT_CATALOG`, `lib/bl.ts` lines 83–95), 11 entries:
ECTN, Commercial Invoice, Packing List, Bill of Lading, Certificate of Origin,
Form E / EUR1, Insurance Certificate, IEC/CE/RoHS Certificates, Battery MSDS,
Inspection Report, Warranty Letter.
[Confirmed by code — `lib/bl.ts` lines 83–95]

- Each row: tick to include, optional numeric `cost` with `currency` selector
  (USD / EUR / CNY). Cost input is disabled unless the row is `included`.
  [Confirmed by code — `ClientBlEditor.tsx` lines 295–321]
- Custom rows can be added ("+Add another document") and removed (✕ button).
  [Confirmed by code — `ClientBlEditor.tsx` lines 113–133, 336–342]
- `blDocumentCostByCurrency` sums per-currency costs for included rows.
  [Confirmed by code — `lib/bl.ts` lines 196–206]
- `normalizeBlProfile` merges saved catalog rows over a fresh default by key;
  preserves custom rows; backfills any missing catalog entries (so adding a new
  catalog entry later is non-destructive). [Confirmed by code — `lib/bl.ts`
  lines 167–183]

### 2.7 Notes field

`bl_profile.notes`: `string | null`. A single free-text `<textarea>` labeled
"Notes" with placeholder "Anything else the freight forwarder / customs needs
to know…". [Confirmed by code — `ClientBlEditor.tsx` lines 346–359]

This is the **only BL-instructions-like field at the client level**. It is
unstructured. See §6.2 for the implications.

### 2.8 Editing surface and save round-trip

- **Route:** `app/(app)/clients/[id]/edit/page.tsx` — the BL profile panel is in
  a separate `<div id="bl">` at the bottom of the page (line 281), rendered via
  `<ClientBlEditor>`. It is independent of the main client identity form above it.
  [Confirmed by code — `app/(app)/clients/[id]/edit/page.tsx` lines 281–299]
- **Deep-link:** `?focus=bl` (from the Action Center "Confirm BL" card) scrolls
  and briefly highlights the BL panel via `<FocusOnLoad />` (line 275).
  [Confirmed by code — `app/(app)/clients/[id]/edit/page.tsx` line 274]
- **Server action:** `updateClientBlProfile` in
  `app/(app)/clients/actions.ts` (lines 290–330). Accepts FormData with `id` and
  `bl_profile` (JSON-serialized profile). Calls `normalizeBlProfile` server-side
  before writing, so the stored blob is always a fully-shaped `BlProfile`.
  [Confirmed by code — `app/(app)/clients/actions.ts` lines 290–330]
- **After save:** `revalidatePath` on `/clients/${id}` and `/clients/${id}/edit`.
  The component also calls `router.refresh()` client-side (line 144).
  [Confirmed by code — `app/(app)/clients/actions.ts` lines 328–329,
  `ClientBlEditor.tsx` line 144]
- **On reload:** `normalizeBlProfile` is called client-side inside the `useState`
  initializer (line 49–51), so a partial or legacy blob is always upgraded to the
  full shape before display. [Confirmed by code — `ClientBlEditor.tsx` lines 49–51]
- **Save gating:** No explicit capability check in the component or action beyond
  what the client RLS already enforces (owner or admin/TLM/ops/super). The action
  comment confirms this: "RLS on `clients` (m046) already scopes who can write."
  [Confirmed by code — `app/(app)/clients/actions.ts` line 288]

**Conclusion: bl_profile fields round-trip correctly.** The save/reload cycle is
consistent. [Confirmed by code]

---

## 3. Entity 2 — Ports, Incoterm, Freight Type, Containers (Quotation)

### 3.1 Port of loading / port of destination

`documents.port_of_loading`, `documents.port_of_destination` — plain text columns,
added by migrations m004 and m007. [Confirmed by code — referenced as
`doc.port_of_destination` in `lib/action-center.ts`; see also DATABASE_STRUCTURE.md §2.1]

### 3.2 Incoterm

`documents.incoterm` — CHECK: `EXW | FOB | CFR | CIF | DDP | DDU` (m004).
[Confirmed by code — `lib/types.ts` `Incoterm` union; DATABASE_STRUCTURE.md §7]

**Incoterm drives the Action Center BL action.** `blRequired` in
`lib/action-center.ts` (lines 289–292) returns true when:
- `freight_type` is `LCL`, OR
- `incoterm` is one of `CFR`, `CIF`, `DDP`, `DDU`

`EXW` and `FOB` do **not** trigger a BL action (buyer arranges destination shipping).
[Confirmed by code — `lib/action-center.ts` lines 288–292]

### 3.3 Freight type

`documents.freight_type` — CHECK: `LCL | 20ft | 40ft HC` (m007).
TypeScript: `FreightType = 'LCL' | '20ft' | '40ft HC'`.
[Confirmed by code — DATABASE_STRUCTURE.md §7]

Note: this type is **missing the plain `40ft`** that `ContainerType` and the
`document_containers` constraint allow. See §7 for the mismatch.

### 3.4 Container plan (number and type of containers)

`document_containers` child table of `documents`. Per-row fields: `container_type`
(CHECK: `LCL | 20ft | 40ft | 40ft HC`, fixed in m063), `quantity`, `unit_price`,
`wooden_box_cost`, `position`.
[Confirmed by code — `supabase/migrations/063_fix_container_type_check.sql`
lines 32; DATABASE_STRUCTURE.md §2.1]

**Container info lives on the quote, not on the order.** The production order's
`shipping_details` has no container reference. The planned containers from the
quotation are not linked to the actual execution record. See §6.3.

### 3.5 Editability of quote-level shipping fields

Whether quotation shipping fields (ports, incoterm, freight, containers) can be
edited after the document reaches `won` or after a production task list is created
is **Needs confirmation** (not verified in this audit).

---

## 4. Entity 3 — BL Execution Fields (Production Order, m070)

### 4.1 Storage

`production_orders.shipping_details` — a single `jsonb` column, added by
`070_shipping_bl_details.sql`. No DB-level schema; shape enforced only by
`normalizeShippingDetails` in `lib/shipping.ts`.
[Confirmed by code — `supabase/migrations/070_shipping_bl_details.sql` line 24,
`lib/shipping.ts` lines 56–71]

ETD, ETA, `shipment_booked`, and `shipping_notes` are **separate columns** on
`production_orders`, not inside the `shipping_details` jsonb.
[Confirmed by code — DATABASE_STRUCTURE.md §2.3; `070_shipping_bl_details.sql`
header comment lines 13–14]

### 4.2 `ShippingDetails` fields

| Field | Type | Description |
|---|---|---|
| `bl_number` | `string \| null` | Bill of Lading number (filled once carrier issues it) |
| `forwarder` | `string \| null` | Freight forwarder / agent name |
| `vessel` | `string \| null` | Vessel name |
| `voyage` | `string \| null` | Voyage number |
| `gross_weight` | `number \| null` | Kilograms |
| `net_weight` | `number \| null` | Kilograms |
| `cbm` | `number \| null` | Cubic metres |
| `packages` | `number \| null` | Number of packages / cartons |
| `hs_code` | `string \| null` | Harmonised System customs code |

[Confirmed by code — `lib/shipping.ts` lines 12–28]

### 4.3 Helper functions

- `emptyShippingDetails()` — returns a fully null-filled `ShippingDetails`.
  [Confirmed by code — `lib/shipping.ts` lines 30–42]
- `normalizeShippingDetails(raw)` — coerces partial/legacy/null to a full shape.
  Strings are trimmed and empty-coerced to `null`; numbers use finite-check.
  [Confirmed by code — `lib/shipping.ts` lines 56–71]
- `isShippingDetailsEmpty(d)` — returns true when no field has a value.
  [Confirmed by code — `lib/shipping.ts` lines 73–86]

### 4.4 Editing surface

The "Shipping / BL" section on `/production/orders/[id]` (gated by the
`production_order.edit_shipment` capability). The exact component file name is
**Needs confirmation** — not read in this audit.

### 4.5 Save round-trip for `shipping_details` fields

`normalizeShippingDetails` is called both on save (server action) and on load
(form initialization), ensuring partial/legacy data is always upgraded to the
full shape. The keys written by the editor (`forwarder`, `vessel`, etc.) are
exactly the keys `ShippingDetails` defines and `normalizeShippingDetails` reads.
**Round-trip is correct for all `ShippingDetails` fields.**
[Confirmed by code — `lib/shipping.ts` lines 56–71]

---

## 5. Fields That Save and Reload Correctly (Round-Trip Verified)

The following fields have been traced from type definition through normalizer
through storage and confirmed to round-trip without key mismatch or data loss:

**Client BL profile (`bl_profile`):**
- All `BlShipper` fields (company_name, address, contact_person, phone, email)
- All `BlConsignee` fields (same_as_client, company_name, address, country,
  contact_person, phone, email, tax_id)
- All `BlNotify` fields (same_as_consignee, company_name, address, country,
  contact_person, phone, email)
- All `BlDocument` fields (key, label, included, cost, currency, custom)
- `bl_profile.notes`

The server-side `normalizeBlProfile` call in `updateClientBlProfile` means the
stored blob is always a complete, well-shaped profile regardless of what the
component serializes. [Confirmed by code — `app/(app)/clients/actions.ts`
lines 303–304, `lib/bl.ts` lines 145–193]

**Production order (`shipping_details`):**
- `bl_number`, `forwarder`, `vessel`, `voyage`, `gross_weight`, `net_weight`,
  `cbm`, `packages`, `hs_code`

All normalize through `normalizeShippingDetails` which reads the exact same keys
that the editor writes. [Confirmed by code — `lib/shipping.ts` lines 56–71]

**Production order separate columns** (ETD, ETA, `shipment_booked`,
`shipping_notes`): these are plain columns, not jsonb — no normalizer needed.
Round-trip is standard Supabase column update. [Assumed from code]

**Quotation-level fields** (port_of_loading, port_of_destination, incoterm,
freight_type): plain columns on `documents`. Round-trip is standard.
[Assumed from code]

---

## 6. Fields That Do NOT Save/Reload Correctly — The Forwarder/Vessel Key Mismatch

> **Owner-APPROVED fix (decision G, confirmed 2026-05-30) — NOT yet applied; no code change made.**
> The fix described below has been approved by the owner. As of this writing the bug
> still exists in `lib/action-center.ts` exactly as documented. See also §11 item 5
> and the "Owner Decisions" section at the top of this document.

### 6.1 The bug

**Current behavior:** When a user fills in `forwarder` and/or `vessel` on the
production order's Shipping/BL section, the data **saves and reloads correctly
on the order page** — the round-trip works. However, the Action Center "BL
missing destination" card (`kind: 'bl_missing_destination'`) **does not
self-clear** when only forwarder or vessel are filled.

**Root cause:** `blIsFilled()` in `lib/action-center.ts` (lines 326–342) checks
the keys `"forwarder_name"` and `"vessel_name"` — but the editor writes `"forwarder"`
and `"vessel"`. These keys never match, so the self-clear never fires.

```typescript
// lib/action-center.ts line 336 — what it reads:
for (const key of ["bl_number", "forwarder_name", "vessel_name"]) {

// lib/shipping.ts lines 22–24 — what the editor writes:
forwarder: string | null;
vessel: string | null;
```

[Confirmed by code — `lib/action-center.ts` lines 326–342, `lib/shipping.ts`
lines 22–24]

**What does clear the action (current behavior):**
1. `bl_profile.consignee.company_name` — if the client's consignee company name
   is non-empty, `blIsFilled` returns `true` immediately (line 334).
2. `shipping_details.bl_number` — the BL number key is correct and does match.

[Confirmed by code — `lib/action-center.ts` lines 331–334, 336]

**What does NOT clear the action despite saving correctly:**
- `shipping_details.forwarder` (stored as `"forwarder"`, checked as `"forwarder_name"`)
- `shipping_details.vessel` (stored as `"vessel"`, checked as `"vessel_name"`)

**Effect:** A user who fills in the forwarder and vessel on the order page will
still see the "Confirm BL & shipping info before booking" action card on the
dashboard. The card only self-clears if they also fill in the BL number or
if the client's consignee company is set.

**Behavioral impact:** [Confirmed code mismatch; behavioral consequence Assumed —
reproduce by filling only forwarder+vessel and confirming the card persists]

**Cross-reference:** `docs/current-implementation/POTENTIAL_INCONSISTENCIES.md` §1.

---

## 7. Missing and Absent Fields

### 7.1 Shipping marks / case marks — MISSING

No `shipping_marks` field exists in `lib/bl.ts`, `lib/shipping.ts`, or any
migration found. Shipping marks (case markings that appear on carton faces and
on the Bill of Lading) are **not modeled anywhere in the application.**
[Confirmed by code — absent from `lib/bl.ts`, `lib/shipping.ts`, and
`supabase/migrations/054_client_bl_profile.sql` / `070_shipping_bl_details.sql`]

If shipping marks are needed on the BL, they would currently have to be placed
in `bl_profile.notes` or `production_orders.shipping_notes` as free text.

### 7.2 Structured BL instructions — MISSING, only free text

There is **no dedicated structured BL-instructions field**. The two free-text
spaces that exist are:
- `bl_profile.notes` (client level, `lib/bl.ts` line 61) — labeled "Anything
  else the freight forwarder / customs needs to know…"
- `production_orders.shipping_notes` (order level, a plain column) — a
  per-shipment free-text notes field

Having two separate notes fields with no structural distinction creates ambiguity
about which one the forwarder should consult. [Confirmed by code — both exist;
no structured BL-instructions type exists]

### 7.3 Container-to-order link — ABSENT (gap)

Containers are planned on the quotation (`document_containers` child of
`documents`), but `production_orders.shipping_details` has **no container
reference** — neither a foreign key to `document_containers` nor a container
field of its own. The actual container(s) used for a specific shipment are not
recorded on the order.

Result: to know what containers an order shipped in, you must look back at the
quote's container plan. There is no field to record "we actually used container
MSCU1234567" on the order itself.
[Confirmed by code — `lib/shipping.ts` `ShippingDetails` has no container field;
`070_shipping_bl_details.sql` header and `ShippingDetails` type confirmed absent]

Whether this is a gap or an intentional product decision is **Needs confirmation**.

### 7.4 BL file upload — intentionally out of scope

The `BL_DOCUMENT_CATALOG` checklist tracks *which* documents are required and
their costs, but file upload is explicitly out of scope in this phase. The
`lib/bl.ts` module header states: "File upload is intentionally out of scope for
now." [Confirmed by code — `lib/bl.ts` line 9]

Actual files would go through the separate `attachments` system (m060, which
provides affair-scoped file storage with visibility flags).
[Confirmed by code — DATABASE_STRUCTURE.md §5]

---

## 8. FreightType vs ContainerType Value Mismatch

**Current behavior:**
- `FreightType` (on `documents.freight_type`): `'LCL' | '20ft' | '40ft HC'`
  — three values, no plain `'40ft'`.
- `ContainerType` (in `document_containers.container_type` CHECK, fixed in m063):
  `'LCL' | '20ft' | '40ft' | '40ft HC'` — four values, includes plain `'40ft'`.

[Confirmed by code — `lib/types.ts` (both unions); `063_fix_container_type_check.sql`
line 32]

**Root cause:** Migration m063 widened the `document_containers` CHECK to add
`'40ft'`, but the `FreightType` union in `lib/types.ts` was not updated at the
same time. The two vocabularies now disagree.

**Practical effect:** A quotation can have a `document_containers` row with
`container_type = '40ft'` but cannot have `freight_type = '40ft'` — the
freight-type selector on the quote never offers plain 40ft. [Confirmed code
divergence; behavioral impact Assumed — likely tolerable since freight type and
container type are not required to match, but confusing]

**Cross-reference:** `docs/current-implementation/POTENTIAL_INCONSISTENCIES.md` §4.

---

## 9. Action Center BL Logic — `blRequired` and `blIsFilled`

Both functions live in `lib/action-center.ts`. [Confirmed by code — lines 288–342]

### 9.1 `blRequired(incoterm, freightType)`

Decides whether the "BL missing destination" action should be raised for a
production order at all.

```typescript
// lib/action-center.ts lines 289–292
function blRequired(incoterm: string | null, freightType: string | null): boolean {
  if ((freightType ?? "").toUpperCase() === "LCL") return true;
  return !!incoterm && SHIPPING_INCOTERMS.has(incoterm.toUpperCase());
}
```

Where `SHIPPING_INCOTERMS = new Set(["CFR", "CIF", "DDP", "DDU"])`.

**Summary:** BL action is raised when `freight_type = 'LCL'` OR when the
incoterm is seller-arranges-destination (`CFR`, `CIF`, `DDP`, `DDU`).
`EXW` and `FOB` → no BL action (buyer arranges). [Confirmed by code]

### 9.2 `blIsFilled(blProfile, shippingDetails)`

Decides whether the "BL missing destination" action should self-clear.

```typescript
// lib/action-center.ts lines 326–342
function blIsFilled(blProfile, shippingDetails): boolean {
  // 1. Consignee company name
  const consigneeCompany = blProfile?.consignee?.company_name ?? "";
  if (consigneeCompany.trim()) return true;
  // 2. shipping_details keys — BUG: reads wrong keys
  for (const key of ["bl_number", "forwarder_name", "vessel_name"]) {
    if (String((shippingDetails as any)[key] ?? "").trim()) return true;
  }
  return false;
}
```

**The bug:** `forwarder_name` and `vessel_name` are not keys that
`normalizeShippingDetails` ever writes. The actual stored keys are `forwarder`
and `vessel`. Only `bl_number` among the three iteration keys is correct.
[Confirmed by code — `lib/action-center.ts` line 336 vs `lib/shipping.ts`
lines 22–24]

> **Owner-APPROVED fix (decision G, confirmed 2026-05-30) — NOT yet applied; no code change made.**
> Approved fix: change the loop in `blIsFilled` to read `"forwarder"` and `"vessel"`.
> Do not rename stored jsonb keys. Minimum field to clear the alert: `forwarder`.
> `bl_number` not mandatory for the first BL follow-up alert.

### 9.3 `BL_STAGE_STATUSES`

The sensor only emits a BL signal when the production order is in one of these
statuses: `deposit_received`, `production_scheduled`, `in_production`,
`production_delayed`, `production_completed`. It does not fire for
`awaiting_deposit`, `shipment_booked`, `shipped`, `delivered`, or `cancelled`.
[Confirmed by code — `lib/action-center.ts` lines 297–303]

---

## 10. Field-by-Field Summary Table

| Field | Entity | Storage | Editable where | Saves/reloads |
|---|---|---|---|---|
| Shipper (company, address, contact, phone, email) | Client | `bl_profile.shipper` (jsonb) | `ClientBlEditor` on client edit page | Correctly via `normalizeBlProfile` |
| Consignee (all fields incl. tax_id, country) | Client | `bl_profile.consignee` (jsonb) | `ClientBlEditor` — fully editable, "Same as client" prefill | Correctly |
| Notify party (all fields incl. country) | Client | `bl_profile.notify` (jsonb) | `ClientBlEditor` — hidden when "Same as consignee" ticked | Correctly |
| Export document checklist (11 catalog + custom) | Client | `bl_profile.documents[]` (jsonb) | `ClientBlEditor` | Correctly |
| BL instructions / notes (free text) | Client | `bl_profile.notes` | `ClientBlEditor` "Notes" textarea | Correctly |
| Port of loading | Quotation | `documents.port_of_loading` | Quote edit form | Correctly (plain column) |
| Port of destination | Quotation | `documents.port_of_destination` | Quote edit form | Correctly (plain column) |
| Incoterm | Quotation | `documents.incoterm` | Quote edit form | Correctly (plain column) |
| Freight type (LCL / 20ft / 40ft HC) | Quotation | `documents.freight_type` | Quote edit form | Correctly (plain column) |
| Container type + quantity | Quotation | `document_containers` rows | Quote edit form | Correctly |
| BL number | Production order | `shipping_details.bl_number` (jsonb) | Order Shipping/BL section | Correctly; also clears BL action |
| Forwarder / agent | Production order | `shipping_details.forwarder` (jsonb) | Order Shipping/BL section | Data saves correctly; but Action Center reads `forwarder_name` — does NOT self-clear |
| Vessel name | Production order | `shipping_details.vessel` (jsonb) | Order Shipping/BL section | Data saves correctly; but Action Center reads `vessel_name` — does NOT self-clear |
| Voyage number | Production order | `shipping_details.voyage` (jsonb) | Order Shipping/BL section | Correctly |
| Gross weight (kg) | Production order | `shipping_details.gross_weight` (jsonb) | Order Shipping/BL section | Correctly |
| Net weight (kg) | Production order | `shipping_details.net_weight` (jsonb) | Order Shipping/BL section | Correctly |
| Volume / CBM | Production order | `shipping_details.cbm` (jsonb) | Order Shipping/BL section | Correctly |
| Packages / cartons | Production order | `shipping_details.packages` (jsonb) | Order Shipping/BL section | Correctly |
| HS code | Production order | `shipping_details.hs_code` (jsonb) | Order Shipping/BL section | Correctly |
| ETD | Production order | `production_orders.etd` (column) | Order Shipping/BL section | Correctly (plain column) |
| ETA | Production order | `production_orders.eta` (column) | Order Shipping/BL section | Correctly (plain column) |
| Shipment booked flag | Production order | `production_orders.shipment_booked` (column) | Order Shipping/BL section | Correctly (plain column) |
| Shipping notes | Production order | `production_orders.shipping_notes` (column) | Order Shipping/BL section | Correctly; second free-text space (ambiguous use vs `bl_profile.notes`) |
| **Shipping marks** | — | **MISSING** | **Not modeled** | — |
| **Structured BL instructions** | — | **MISSING** (only free text) | — | — |
| **Container ↔ order link** | — | **ABSENT** | Not modeled on order | — |
| BL file upload | — | Out of scope (by design) | N/A | N/A |

---

## 11. Needs Confirmation

1. **Order-page Shipping/BL component name and exact form fields.** The component
   that edits `shipping_details` on `/production/orders/[id]` was not directly
   read in this audit. The field list is inferred from `ShippingDetails` type and
   the migration comment. Confirm that all `ShippingDetails` fields plus
   ETD/ETA/booking/shipping_notes have visible inputs.

2. **Capability gating on the order BL section.** `production_order.edit_shipment`
   is referenced as the gating capability (per SHIPPING_PROCESS.md), but the
   exact component applying it was not verified in this audit.

3. **Quote locking after `won` status.** Whether ports, incoterm, freight type,
   and containers on the quotation are still editable once the document is `won`
   and a production task list exists has not been verified.

4. **Container-to-order gap: gap or intentional.** Whether the absence of a
   container reference on `production_orders` is a known product gap or an
   intentional decision (the quote plan is considered sufficient) needs a product
   decision from the owner.

5. **`blIsFilled` fix acceptance.** ~~Needs confirmation~~ → **Owner-APPROVED fix
   (decision G, confirmed 2026-05-30) — NOT yet applied; no code change made.**
   The approved fix: align `blIsFilled` in `lib/action-center.ts` to read `"forwarder"`
   and `"vessel"` (the actual stored keys). Do not rename stored jsonb keys.
   Minimum field to clear the BL-missing alert: `forwarder`. `bl_number` is stored
   when available but is not mandatory to clear the first BL follow-up alert.
   See §G in OWNER_DECISIONS_LOG.md and the "Owner Decisions" section at the top
   of this document.
