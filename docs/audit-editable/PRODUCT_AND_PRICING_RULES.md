# Product & Pricing Rules — Audit

> **Audit scope.** This document covers the product catalog model, document line
> structure, pricing mechanics, discounts, commission, currencies, payment terms,
> and deposit/balance logic as they exist **in the current codebase**. It was
> produced by reading the live code (read-only) and the primary implementation
> docs under `docs/current-implementation/`.
>
> Conventions used throughout:
> - **[Confirmed by code]** — directly visible in a migration, TypeScript module,
>   or server action.
> - **[Assumed from code]** — inferred from how a value is used; not guaranteed
>   by a constraint or explicit comment.
> - **Needs confirmation** — cannot be determined from code alone; requires
>   owner input.
>
> File references are relative to the project root.

---

## Owner Decisions (confirmed 2026-05-30)

> Source of truth: `docs/audit-editable/OWNER_DECISIONS_LOG.md` sections H.1–H.10.
> All items below describe **TARGET / INTENDED behavior and policy**.
> Most are **NOT yet implemented in code** — we are in the documentation phase only.
> The phrase "Owner decision (confirmed 2026-05-30) — target behavior; not yet implemented"
> applies to every sub-item in this section unless explicitly noted otherwise.

### H.1 — Catalogue / price-list pricing, multiple price lists, assignment priority, traceable manual override

**Owner decision (confirmed 2026-05-30) — target behavior; not yet implemented.**

- Product prices must default from the **active product price list**. Multiple named price lists (e.g. high, medium, low, distributor, regional, special-project) must be supported.
- A director or authorized manager can assign a default price list to: a sales user, a region, a country/market, or a specific client.
- On quotation creation, the app proposes the default price list by **priority**: (1) client-specific, (2) sales-user assigned, (3) region/country assigned, (4) company default.
- Each quotation line may use: (1) default catalogue price, (2) selected price-list/tier price, (3) client-specific price, (4) manual override.
- Manual override must be **visible and traceable**, storing: original price, selected price list, overridden price, override reason (if required), overridden by, overridden at.

**Gap vs current code:** The current `prices_version` table supports only three tiers (`high` / `medium` / `low`) with no named price-list concept, no assignment to users/regions/clients, and no override-audit fields on `document_lines`. Manual override today simply writes a different `unit_price` with no structured audit trail beyond `pricing_mode = "manual"` and `original_unit_price`.

---

### H.2 — Line + document discounts, traceability fields, approval tiers, margin warning

**Owner decision (confirmed 2026-05-30) — target behavior; not yet implemented.**

- Support **line-level** and **document-level** discounts (document-level is currently absent — see §4.3).
- Display clearly: original unit price, discount % or amount, discounted unit price, total discount, final line total, final document total.
- Store per discount: type (percentage/fixed), value, reason, discounted by, discounted at.
- **Approval tiers:** sales user up to an approved limit; sales manager/director approves larger; admin/super admin can override. Until limits are configured, discounts above an internal threshold must be marked **requiring approval**.
- **Margin warning:** if a discount brings the quote below the minimum accepted margin, show a warning or require manager approval. Silently allowing a price below the commercial safety threshold is not permitted.

**Gap vs current code:** `document_lines` has `discount_type` and `discount_value` but no reason, discounted-by, or discounted-at fields. No document-level discount column exists on `documents`. No approval flow or margin-warning threshold exists in the pricing stack.

---

### H.3 — Always tax-free (export)

**Owner decision (confirmed 2026-05-30) — confirmed as intentional design; already consistent with current code.**

- Treat quotations, proforma invoices, and export documents as **tax-free** by default.
- Do not auto-calculate or add VAT/tax.
- Show clearly when needed: "VAT / Tax: 0", "Tax-free export sale", "VAT not applicable for export".
- Any existing tax/VAT field must be hidden by default, fixed at 0, or marked not applicable.

**Gap vs current code:** No tax calculation exists anywhere in the pricing stack (confirmed — see §4.5 and §13 item 3). This decision confirms the omission is intentional. The remaining gap is only the explicit UI label ("Tax-free export sale") — not yet added to the PDF/UI.

---

### H.4 — One currency per document, conversion locked per version, FX display + adjustment clause, bank account by currency

**Owner decision (confirmed 2026-05-30) — target behavior; not yet implemented (except basic currency field and bank auto-select).**

- Each document has one primary currency (USD, EUR, CNY), selected at document level. [Already in code: `documents.currency`.]
- Prices may exist in a base currency (normally USD); the final total is calculated/displayed in the document currency.
- On conversion store: source currency, target currency, exchange rate, rate date, rate source (if available), converted by, converted at.
- Do **not** silently change prices from a live rate update after creation. Once saved/sent, the rate is **locked for that version**. On revision, the user may keep the original rate or apply a new one.
- **Display:** user chooses whether the rate appears on the quotation/proforma/invoice. Large/high-risk orders may show the rate used, its date, and an **exchange-rate adjustment clause**.
- **Adjustment clause:** for very large orders, if the rate moves significantly, SOLUX can adjust the final amount or request a price revision. Mark a quote as: exchange-rate protected, adjustment-clause included, or fixed-rate.
- **Bank account:** default bank account matches document currency (USD → USD account, EUR → EUR, CNY → CNY); user may select another authorized account. [Auto-select already in code; decision confirms this as the required rule.]

**Gap vs current code:** No FX rate table, no conversion math, and no per-version rate-lock exist. Prices entered in `prices_version` are a raw number used as-is regardless of document currency (see §6 and §13 item 4). The bank auto-select on currency change is already implemented; all FX/rate/adjustment-clause fields are new.

---

### H.5 — 2-decimal rounding rules; balance absorbs rounding difference

**Owner decision (confirmed 2026-05-30) — target behavior; not yet implemented.**

- All monetary values show **2 decimals**: unit prices, line totals, subtotal, discounts, grand total, deposit, balance, commission, conversion results.
- Calculate with sufficient internal precision, then round displayed/stored amounts to 2 decimals. Standard rounding: ≥ 0.005 rounds up.
- **Line vs document total:** round each line total to 2 decimals → sum rounded line totals → apply document discount → grand total → round to 2 decimals.
- **Deposit/balance:** deposit rounded to 2 decimals; **balance = grand total − deposit** (balance absorbs any rounding difference so totals reconcile exactly).
- **Commission:** computed from the finalized commercial basis, rounded to 2 decimals.
- **Conversion:** converted amount rounded to 2 decimals in target currency; exchange rate stored with more than 2 decimal places of precision.

**Gap vs current code:** `lib/pricing.ts` and `lib/commission.ts` apply no `Math.round`, `Math.ceil`, or `toFixed` to stored values. Numbers are stored as full floating-point numerics in Postgres; `.toFixed(2)` is display-only (see §4.6 and §13 item 5). The balance-absorbs-rounding rule does not exist in the current `computeExpectedBalance` formula.

---

### H.6 — Default 30% deposit (editable), supported payment structures

**Owner decision (confirmed 2026-05-30) — 30% default confirmed as a business rule; extended structures are target behavior not yet implemented.**

- Prefill deposit **30%** / balance 70%. [Default already in code — decision confirms this is a business rule, not an arbitrary developer choice.]
- Support additional payment structures: 30/70, 25/75, 20/80, 100% before production, deposit + L/C, L/C at sight, L/C 30/60/90 (if approved), no-deposit (only if explicitly authorized).
- Non-standard terms must be **visible and traceable**. Risky terms (low deposit, delayed balance, long credit) require management approval or at least a risk warning.

**Gap vs current code:** The 30% default is already applied in `NewDocumentForm.tsx`. The `PaymentMode` enum supports `deposit_balance`, `lc`, `hybrid`. There is no approval-required flag for non-standard or risky payment terms, no risk warning, and no `100% before production` mode.

---

### H.7 — Balance reminder default (Africa 20 days / others 15 days, editable)

**Owner decision (confirmed 2026-05-30) — target behavior; currently a nullable field with no system-defined default.**

- For orders with a balance due before shipment, create a default reminder before the expected shipment / production completion date.
- **Defaults: Africa = 20 days; other regions = 15 days** (unless another regional rule is configured). Editable by authorized users.
- Applies when: payment term includes balance before shipment, order is in production, balance not yet received.
- Visible in: Action Center, order detail page, finance/payment follow-up area.

**Gap vs current code:** `production_orders.balance_reminder_days_before_eta` exists (migration `048`, nullable, CHECK 0–90) but has no system-defined default and no region-aware logic. Orders created today have NULL unless explicitly set by the user (see §8.4 and §13 item 7).

---

### H.8 — Offer validity windows: 30 days (products) / 7 days (freight), editable

**Owner decision (confirmed 2026-05-30) — defaults confirmed as business-approved standard commercial terms.**

- Distinguish product price validity, transport price validity, and full quotation validity.
- **Defaults: product prices 30 days; freight/transport 7 days.** Editable.
- For large projects, tenders, unstable markets, special discounts, or FX-sensitive quotes, allow shorter/longer validity manually.
- Display when needed: offer-valid-until date, freight-valid-until date, exchange-rate clause (if applicable).

**Gap vs current code:** `documents.offer_validity_products_days` (default 30) and `documents.offer_validity_transport_days` (default 7) already exist (migration `037`) and match the confirmed defaults. This decision closes §13 item 8. The remaining gap is the explicit offer-valid-until date display and the freight-valid-until date on the PDF, which have not been traced as fully implemented.

---

### H.9 — Warranty per product, stored with version, manual change traceable

**Owner decision (confirmed 2026-05-30) — target behavior; current implementation is document-level only with no per-product default or override audit trail.**

- Support warranty duration at **product level**; each product has a default (e.g. 3y, 5y, 10y if applicable, custom only if approved).
- Prefill warranty from product config when added to a quote; user may change it commercially, but special extensions must be visible/traceable.
- On manual change store: original product warranty, selected warranty, changed by, changed at, reason (if needed).
- Warranty is stored with the **document version**; later product-warranty changes must not alter old quotations.

**Gap vs current code:** `documents.warranty_years` (nullable integer, migration `037`) is a document-level field — one warranty for all lines on the document. There is no product-level warranty default in the `products` table, no per-line warranty override, and no override-audit fields. The "stored with document version" property is partially satisfied because `documents` is versioned, but the per-product default pipeline does not exist (see §9 and §13 item 9).

---

### H.10 — `no_deposit_required` is exceptional; requires explicit authorization + audit fields

**Owner decision (confirmed 2026-05-30) — target behavior; current deposit-override mechanism is more limited than the target rule.**

- By default every order requires a deposit before production (usually 30%).
- `no_deposit_required` applies only in exceptional cases (trusted long-term customer, strategic project, public tender with confirmed financing, L/C or bank-backed, internal management decision, special director/admin agreement).
- Must not be set casually by a normal sales user. **Authorization:** sales user cannot approve alone; sales manager/director can request/approve per permissions; admin/super admin can approve; finance approval may be required if risk is high.
- If selected, store: reason, approved by, approved at, payment guarantee/alternative security (if any), internal comment. UI must clearly show the order is a no-deposit exception.

**Gap vs current code:** `production_orders` has `deposit_override_at`, `deposit_override_by`, `deposit_override_reason` (migration `025`) as an admin-only escape hatch at the production-order level. The current mechanism does not support a manager-approval flow, a "payment guarantee/alternative security" field, or the `no_deposit_required` state being set at the quotation/document stage before a production order exists. The `no_deposit_required` payment state in `computeProductionPaymentState` is derived automatically when `expectedDeposit <= 0` rather than requiring explicit authorization (see §8.2–§8.3).

---

## 1. Product catalog

### 1.1 Products table

Products live in the `products` table. Column inventory reconstructed from
migrations and `lib/types.ts`:

| Column | Notes | Source |
|---|---|---|
| `id` (uuid PK) | | base |
| `name` (text) | display name | base |
| `sku` (text, nullable) | unique case-insensitive (partial index on `lower(sku)` for non-null) | `003` |
| `category` (text, nullable) | **denormalized copy** of `product_categories.name`; kept in sync when a category is renamed | base, `011` |
| `category_id` (uuid FK → product_categories) | canonical source of truth for category | `011` |
| `base_price` (numeric) | **deprecated** — always inserted as `0`; real prices live in `prices_version` per tier | `001`, `app/(app)/admin/products/actions.ts` line 63 |
| `image_url` (text, nullable) | public URL in `product-images` Storage bucket | `003` |
| `active` (boolean) | soft visibility toggle | base |

[Confirmed by code]: `products.base_price` is set to `0` on every insert path
(`createProduct`, `importProducts`). The comment in `actions.ts` reads
`"deprecated: prices live in prices_version per tier"`.

[Confirmed by code]: `products.category` is a denormalized text mirror of the
category name. `renameCategory` (`app/(app)/admin/categories/actions.ts`) runs
`update products set category = name where category_id = id` to keep it in sync.

### 1.2 Categories (`product_categories`)

| Column | Notes | Source |
|---|---|---|
| `id` (uuid PK) | | `011` |
| `name` (text) | display name | `011` |
| `position` (integer) | ordering | `011` |

[Confirmed by code]: `lib/types.ts ProductCategory`.

### 1.3 Options (`options` table)

Product-level variant options that carry an optional price modifier. Sourced
from `lib/types.ts`:

| Column | Notes |
|---|---|
| `id` (uuid PK) | |
| `product_id` (FK → products) | |
| `option_type` (text) | group label (e.g. "Battery type", "CCT") |
| `option_value` (text) | choice value (e.g. "18RH", "3000K") |
| `price_modifier` (numeric) | **additive surcharge** on the tier base price; defaults to `0` |

[Confirmed by code]: `lib/types.ts Option`; `app/(app)/admin/products/actions.ts`
`addOption` / `deleteOption`.

The product picker in `components/ProductConfigurator.tsx` renders options
grouped by `option_type` and shows `(+{modifier})` when `price_modifier > 0`
(line 763).

### 1.4 Tier prices (`prices_version` table)

| Column | Notes | Source |
|---|---|---|
| `id` (uuid PK) | | base |
| `product_id` (FK → products) | | base |
| `pricing_tier` (text) | CHECK `high` / `medium` / `low`; default `medium` | `001` |
| `price` (numeric) | base price for this tier | base |
| `valid_from` (date) | effective date | base |

[Confirmed by code]: `lib/types.ts PriceVersion`, `PricingTier`; index
`idx_prices_tier_lookup` on `(product_id, pricing_tier, valid_from desc)` for
"latest price" lookup. **Tier pricing is authoritative; `base_price` is never
used in pricing calculations** (comment in `lib/pricing.ts` line 11-13).

**Needs confirmation:** When multiple rows exist for the same (product, tier),
which is the "active" price? The index orders by `valid_from desc`; the
`buildTierPriceMap` function in `lib/pricing.ts` (lines 58-69) keeps only the
**first** row encountered per (product, tier) — i.e. the one delivered first by
the query. How the query orders results (ascending or descending `valid_from`)
is not observable from `lib/pricing.ts` alone; the actual tie-breaking depends
on the query the caller issues. **Needs confirmation from the query site.**

### 1.5 Cost prices (`product_costs` table)

| Column | Notes | Source |
|---|---|---|
| `product_id` (uuid PK, FK → products) | | `001` |
| `cost_price` (numeric) | admin-only; 0 default | `001` |
| `updated_at` (timestamptz) | | `001` |

[Confirmed by code]: `product_costs` has its own RLS policy (`admin rw costs`)
restricting read/write to `admin` role only (`001`). Sales users cannot see cost
prices.

[Confirmed by code]: margin is computed in `lib/pricing.ts computeMargin` as
`(finalUnitPrice − costPrice) / finalUnitPrice × 100`, returned as a
`{ margin, marginPct }` object. It is displayed inline in the
`ProductConfigurator` only when `isAdmin && costs` is truthy (line 316-318).

### 1.6 Bulk import

[Confirmed by code]: `app/(app)/admin/products/actions.ts` exposes three bulk
import server actions keyed by SKU (case-insensitive):
- `importProducts` — upsert products by `lower(sku)`.
- `importPrices` — upsert prices by `(product_id, pricing_tier, valid_from)`;
  creates or updates matching rows.
- `importOptions` — upsert options by `(product_id, option_type, option_value)`.

---

## 2. Configuration fields (category-level dynamic config)

### 2.1 `config_fields` table

Dynamic fields attached to a product category. Each field defines what
technical/sales properties apply to products in that category (e.g. Battery
type, CCT, Optics).

| Column | Notes | Source |
|---|---|---|
| `id` (uuid PK) | | `009` |
| `category_id` (FK → product_categories) | | `009` |
| `field_name` (text) | display name and key in `config_values` JSONB | `009` |
| `field_type` | `dropdown` / `text` / `number` / `checkbox` / `textarea` | `lib/types.ts ConfigFieldType` |
| `field_scope` | `sales` or `technical` (default `sales` for backward compat) | `lib/types.ts ConfigFieldScope` |
| `required` (boolean) | | `009` |
| `default_value` (text, nullable) | | `009` |
| `placeholder` (text, nullable) | | `009` |
| `field_order` (integer) | | `009` |
| `visible_in_quotation` (boolean) | | `009` |
| `visible_in_task_list` (boolean) | | `009` |
| `internal_only` (boolean) | | `009` |
| `allow_custom_value` (boolean, default false) | **dropdown only**: reveals a free-text input alongside the dropdown | `010` |
| `active` (boolean) | | base |

[Confirmed by code]: `lib/types.ts ConfigField`, `app/(app)/admin/categories/actions.ts`.

### 2.2 `config_field_options` table

Dropdown choice values for a `config_fields` row (field_type = `dropdown`).

| Column | Notes |
|---|---|
| `id` (uuid PK) | |
| `field_id` (FK → config_fields) | |
| `option_value` (text) | the displayed/stored choice |
| `option_order` (integer) | ordering |

[Confirmed by code]: `lib/types.ts ConfigFieldOption`;
`app/(app)/admin/categories/actions.ts` `addFieldOption` / `addFieldOptionsBulk`.

### 2.3 Custom option sentinel

[Confirmed by code]: When a dropdown field has `allow_custom_value = true`, the
sales user can pick a "Custom…" option. This stores `CUSTOM_OPTION_SENTINEL =
"__custom__"` in `config_values[field_name]`, paired with a free-text value
stored at `config_values["${field_name}__custom"]`.

`lib/types.ts`:
- `CUSTOM_OPTION_SENTINEL = "__custom__"` (line 150)
- `customValueKey(fieldName)` → `"${fieldName}__custom"` (line 151)
- `resolveConfigValue(fieldName, values)` — always resolves the sentinel to the
  real text for display purposes (line 161-171)
- `isCustomValueKey(key)` — detects side-channel keys ending in `__custom`
  (line 174-176)

**"Configure now / configure later"** concept [Confirmed by code]: This exists
as a UI UX feature **only**, not a data concept. In
`components/ProductConfigurator.tsx`, the configuration section is **collapsed
by default** with a "Configure now" button (lines 683-729). The label "Configure
later" appears on the collapse button (line 739). There is no database state for
"not yet configured"; the `config_values` JSONB is simply empty/partial until
the user expands and fills in the fields.

### 2.4 `config_field_scope` — sales vs technical

[Confirmed by code]: `lib/types.ts` documents two scopes:
- `"sales"`: editable by any role with quotation access; appears on the
  quotation builder.
- `"technical"`: editable only by `task_list_manager` / `admin`; appears in the
  technical section of the production task list.

**Needs confirmation:** The exact enforcement gate (which server action / RLS
policy checks `field_scope === "technical"` for write access) was not traced
in this audit. [Assumed from code]: enforcement is at the UI and server-action
level, not at the DB level.

---

## 3. Document lines

### 3.1 `document_lines` table

One row per product line on a quotation/proforma.

| Column | Notes | Source |
|---|---|---|
| `id` (uuid PK) | | base |
| `document_id` (FK → documents) | | base |
| `product_id` (FK → products) | | base |
| `quantity` (integer / numeric) | | base |
| `selected_options` (jsonb) | `{ option_type: option_value }` map | base |
| `config_values` (jsonb) | `{ field_name: value }` map; custom values use sentinel | base |
| `unit_price` (numeric) | **final** price after discount | base |
| `original_unit_price` (numeric, nullable) | price before discount | `001` |
| `total_price` (numeric) | `unit_price × quantity` | base |
| `pricing_mode` (text) | `auto` or `manual` | base |
| `pricing_tier` (text) | `high` / `medium` / `low` (nullable pre-m001) | `001` |
| `discount_type` (text, nullable) | `percentage` or `fixed` | `001` |
| `discount_value` (numeric, default 0) | discount amount | `001` |
| `client_product_name` (text, nullable) | the client's own product label (shown in PDF alongside internal name) | `006` |

[Confirmed by code]: `lib/types.ts DocumentLine`.

[Confirmed by code]: When `edit_of` is used (editing a draft in-place), the
existing lines are **deleted and re-inserted wholesale**
(`app/(app)/documents/new/actions.ts` lines 289-299).

### 3.2 Client product reference (`client_product_name`)

[Confirmed by code]: A free-text field per document line storing the client's
own name for the product (e.g. "SolarMax 40"). Shown in `ProductConfigurator`
(line 669-679) as an optional input labeled "Client reference". It is rendered
on the PDF next to the internal product name. There is no separate "client
product reference" table — it is a plain nullable text column on
`document_lines`.

### 3.3 `document_containers` table

Container/freight plan for the quotation.

| Column | Notes | Source |
|---|---|---|
| `id` (uuid PK) | | `004` |
| `document_id` (FK → documents) | | `004` |
| `container_type` (text) | CHECK: `LCL` / `20ft` / `40ft` / `40ft HC` | `007`, `063` |
| `quantity` (integer) | number of containers | `004` |
| `unit_price` (numeric) | freight cost per container | `004` |
| `wooden_box_cost` (numeric, default 0) | LCL-only packaging surcharge | `007` |
| `position` (integer) | ordering | base |

[Confirmed by code]: `lib/types.ts DocumentContainer`; `lib/logistics.ts`
`containerLineTotal` adds `wooden_box_cost` only when `container_type === "LCL"`.

**FreightType vs ContainerType mismatch** [Confirmed by code]: `documents.freight_type`
CHECK is `LCL / 20ft / 40ft HC` (no plain `40ft`), while `document_containers.container_type`
CHECK is `LCL / 20ft / 40ft / 40ft HC` (includes plain `40ft`). See
`docs/current-implementation/POTENTIAL_INCONSISTENCIES.md`.

---

## 4. Pricing mechanics

### 4.1 Unit price resolution (auto mode)

[Confirmed by code]: `lib/pricing.ts resolveStandardUnitPrice` (lines 14-34):

1. Look up `tierPrices[product.id][tier]` from the pre-built `TierPriceMap`.
2. If no entry exists for this (product, tier), return `null` — display a
   warning; **no fallback to `base_price`**.
3. Sum all option price modifiers for the selected options:
   `modifier = sum(opt.price_modifier for selected options)`.
4. Return `tierPrice + modifier`.

No rounding is applied at this stage. Floating-point arithmetic is used
throughout; the display layer calls `.toFixed(2)` for rendering only.

### 4.2 Pricing mode: `auto` vs `manual`

[Confirmed by code]: Each document line has a `pricing_mode` field (stored in
`document_lines.pricing_mode`):

- **`auto`**: unit price = `resolveStandardUnitPrice(...)` (tier price + option
  modifiers). Automatically recomputed when tier or options change.
- **`manual`**: user types an `original_unit_price` directly. When switching
  from auto to manual, the current standard price is seeded as the starting
  value (`components/ProductConfigurator.tsx` line 368).

[Confirmed by code]: The document-level `manual_pricing` boolean on `documents`
is set to `true` if **any line** has `pricing_mode === "manual"` (server action
`saveDocument`, `NewDocumentForm.tsx` line 579: `manual_pricing: anyManual`).

### 4.3 Discount

[Confirmed by code]: `lib/pricing.ts applyDiscount` (lines 36-46):

- `discount_type = "percentage"`: `finalPrice = max(0, original × (1 − value/100))`
- `discount_type = "fixed"`: `finalPrice = max(0, original − value)`
- `discount_type = null` or `value <= 0`: no discount applied; returns original.

Both types are clamped to zero (cannot produce a negative price).

[Confirmed by code]: `document_lines.discount_type` CHECK: `percentage` or
`fixed`. A null value means no discount.

**No document-level global discount exists** [Confirmed by code]: discounts are
per-line only; there is no `documents.discount_*` column.

### 4.4 Line total

[Confirmed by code]: `total_price = unit_price × quantity`, where `unit_price`
is the post-discount final price (`components/ProductConfigurator.tsx` line 313).

### 4.5 Grand total formula

[Confirmed by code]: `app/(app)/documents/new/actions.ts` (lines 146-157):

```
items_total   = sum(line.total_price for all lines)
freight_total = sum(containerLineTotal(c) for valid containers)
subtotal      = items_total + freight_total
commission    = commissionAmount(subtotal, { enabled, percentage })
grand_total   = subtotal + commission
```

This grand total is stored in `documents.total_price`.

**No taxes** [Confirmed by code]: no tax column exists on `documents` or
`document_lines`. No tax calculation appears in `lib/pricing.ts`,
`lib/commission.ts`, or `saveDocument`. ~~Needs confirmation.~~ **Resolved —
Owner decision H.3 (confirmed 2026-05-30):** always tax-free / export; omission
is intentional. Explicit "Tax-free export sale" UI/PDF label is target behavior
not yet implemented.

### 4.6 Rounding policy

**No explicit rounding** [Confirmed by code]: `lib/pricing.ts` and
`lib/commission.ts` do not apply `Math.round`, `Math.ceil`, or `toFixed`
to stored values. Numbers are stored as full floating-point numerics in
Postgres. The UI calls `.toFixed(2)` in display only. ~~Needs confirmation.~~
**Resolved — Owner decision H.5 (confirmed 2026-05-30):** 2-decimal rounding
is required on all stored monetary values; balance absorbs rounding difference.
Not yet implemented.

---

## 5. Commission

### 5.1 Commission fields on `documents`

[Confirmed by code]: Added in migration `006`. All fields live on `documents`:

| Column | Default | Notes |
|---|---|---|
| `commission_enabled` (boolean) | `false` | toggle |
| `commission_percentage` (numeric) | `0` | 0–100 percentage |
| `commission_amount` (numeric) | `0` | computed amount, stored |
| `commission_description` (text, nullable) | — | free-text label |
| `show_commission_in_pdf` (boolean) | `false` | controls PDF visibility |

### 5.2 Commission calculation

[Confirmed by code]: `lib/commission.ts commissionAmount` (lines 13-18):
```
if (!enabled) return 0;
pct = number(percentage || 0);
if (pct <= 0) return 0;
return max(0, (items_total + freight_total) × pct / 100)
```

The base is the **subtotal (items + freight)**, not the grand total.
The commission is applied **on top of** the subtotal, increasing the
customer-facing grand total. [Confirmed by code — comment in `lib/commission.ts`
line 2-4].

### 5.3 Commission PDF visibility

[Confirmed by code]: When `show_commission_in_pdf = false`, the PDF receives
`commission_amount = 0` and `commission_visible = false`
(`app/(app)/documents/[id]/page.tsx` lines 381-384). When true, the
`commission_amount` and optional `commission_description` are passed to the PDF.

### 5.4 Commission and margin

[Confirmed by code]: `NewDocumentForm.tsx` line 350-352: when computing
total margin for admin display, `commission` is subtracted from the items
margin — the comment reads "Commission is paid out of the seller's margin."
This is a display-only calculation; nothing enforces this rule in the DB.

### 5.5 No per-client commission config [Confirmed by code vs Needs confirmation]

The `clients` table has `commission_*` columns (referenced in
`docs/current-implementation/DATABASE_STRUCTURE.md §3.1`), but no commission
columns were found on the `clients` table in migration `006` or any subsequent
migration reviewed in this audit. All commission columns in `006` are on
`documents`, not `clients`. **Needs confirmation:** Does `clients.commission_*`
actually exist in the live database, or is the database doc reference
erroneous? If it does exist, the read path for pre-populating a quotation's
commission from a client default was not found in the code reviewed.

---

## 6. Currencies

[Confirmed by code]: `lib/types.ts`: `Currency = "USD" | "EUR" | "CNY"`;
`CURRENCIES: Currency[] = ["USD", "EUR", "CNY"]`.

[Confirmed by code]: `documents.currency` CHECK `USD / EUR / CNY`
(migration `005`, default `USD`).

[Confirmed by code]: `bank_accounts.currency` also CHECK `USD / EUR / CNY`;
one default bank account per currency is enforced by a partial unique index
(`005`).

[Confirmed by code]: When the sales user switches currency in the builder, the
bank account auto-selects to the default for that currency
(`NewDocumentForm.tsx` lines 270-289).

**No currency conversion** [Confirmed by code]: No FX rate table, no conversion
math, and no multi-currency totals exist in the codebase. All prices on a
document share a single currency. ~~Needs confirmation.~~ **Resolved — Owner
decision H.4 (confirmed 2026-05-30):** explicit FX conversion with rate locked
per document version and audit fields is the target. Full FX pipeline is not
yet implemented; today prices are used as-is regardless of document currency.

---

## 7. Payment terms

### 7.1 `PaymentMode` enum

[Confirmed by code]: `lib/types.ts PaymentMode`:

| Value | Meaning |
|---|---|
| `deposit_balance` | Upfront deposit + balance before/against documents |
| `lc` | Letter of Credit (no upfront deposit) |
| `hybrid` | Partial deposit + balance via L/C |

Stored in `documents.payment_mode` CHECK (`002`).

### 7.2 `payment_terms` JSONB

[Confirmed by code]: `documents.payment_terms` is a `jsonb` column (`002`).
Its shape is enforced only in `lib/payment.ts normalizePaymentTerms` and
`lib/types.ts PaymentTerms`:

```ts
PaymentTerms = {
  deposit_percent?: number;       // 0–100; relevant for deposit_balance + hybrid
  balance_condition?: BalanceCondition;  // "before_shipment" | "against_documents"
  lc_type?: LCType;               // "at_sight" | "usance"
  lc_days?: number;               // 30 / 60 / 90 / 120
}
```

[Confirmed by code]: `normalizePaymentTerms` strips irrelevant keys per mode:
- `deposit_balance`: keeps only `deposit_percent` + `balance_condition`.
- `lc`: keeps only `lc_type` (and `lc_days` if `lc_type === "usance"`).
- `hybrid`: keeps only `deposit_percent` + `lc_days`.

### 7.3 Validation rules

[Confirmed by code]: `lib/payment.ts validatePaymentTerms`:

| Mode | Rules |
|---|---|
| `deposit_balance` | `deposit_percent` in `[0, 100]`; `balance_condition` required |
| `lc` | `lc_type` required; if `usance`, `lc_days` must be 30/60/90/120 |
| `hybrid` | `deposit_percent` in `[0, 100]`; `lc_days` must be 30/60/90/120 |

### 7.4 Default values in the builder

[Confirmed by code]: `NewDocumentForm.tsx` line 295-299:
```ts
paymentMode: "deposit_balance"
paymentTerms: { deposit_percent: 30, balance_condition: "before_shipment" }
```
These are UI defaults only; no DB-level default for `payment_terms`.

~~Needs confirmation.~~ **Resolved — Owner decision H.6 (confirmed 2026-05-30):**
30% deposit is the confirmed business default. Additional supported structures
(25/75, 20/80, 100% before production, deposit + L/C, no-deposit exception) are
target behavior not yet fully implemented.

---

## 8. Deposit and balance logic on production orders

### 8.1 Expected deposit / balance computation

[Confirmed by code]: `lib/types.ts computeExpectedDeposit` (lines 638-648):

- `lc` mode → expected deposit = 0 (LC handles payment, no upfront).
- `deposit_balance` / `hybrid` → `total_price × deposit_percent / 100`.
- Missing terms or mode → 0.

`computeExpectedBalance` = `max(0, total_price − expectedDeposit)`.

### 8.2 Payment state machine (`computeProductionPaymentState`)

[Confirmed by code]: `lib/types.ts` (lines 665-700). Inputs: `totalPrice`,
`paymentMode`, `paymentTerms`, `depositReceived`, `balanceReceived`.

Output states:

| State | Meaning |
|---|---|
| `no_terms` | No `payment_mode` or `payment_terms` recorded |
| `no_deposit_required` | `expectedDeposit <= 0` and balance not yet received |
| `awaiting_deposit` | Deposit expected but not yet received in full |
| `deposit_received` | Deposit received in full; balance not yet paid |
| `partial_balance` | Some balance received, not yet full |
| `paid_in_full` | Both deposit + balance fully received |

[Confirmed by code]: A tolerance of `epsilon = 0.01` (1 cent) is applied when
comparing received amounts against expected amounts, to absorb rounding from
bank transfers (lines 685-687).

### 8.3 Deposit override ("start without deposit")

[Confirmed by code]: `production_orders` columns `deposit_override_at`,
`deposit_override_by`, `deposit_override_reason` (migration `025`). This is
an admin-only escape hatch to launch production before the deposit clears.

[Confirmed by code — `025` migration comment]:
- Only `admin` / `super_admin` can activate (sales has no bypass route).
- Activation flips the order status from `awaiting_deposit` →
  `deposit_received`.
- Activation emits a HIGH-severity event.
- The override does NOT modify `deposit_received_amount` / `deposit_received_at`.

### 8.4 Balance reminder

[Confirmed by code]: `production_orders.balance_reminder_days_before_eta`
(integer, nullable, CHECK 0–90, migration `048`). When set (e.g. 15), the
Action Center and dashboard can fire a proactive alert 15 days before ETA.
NULL means "no proactive reminder for this order" (the legacy overdue
alert still fires when balance is missing at `production_completed`).

Per-order setting so each project can have a different lead time. ~~Needs
confirmation.~~ **Resolved — Owner decision H.7 (confirmed 2026-05-30):**
Africa = 20 days default; other regions = 15 days default; both editable.
Region-aware auto-population of this field is target behavior not yet
implemented.

---

## 9. Sales terms on the PDF

[Confirmed by code]: Migration `037` added three columns to `documents`:

| Column | DB default | UI default | Notes |
|---|---|---|---|
| `warranty_years` (int, nullable) | null | null | Common values: 3, 5, 10; free integer |
| `offer_validity_products_days` (int) | 30 | 30 | Validity of product pricing |
| `offer_validity_transport_days` (int) | 7 | 7 | Validity of freight pricing |

[Confirmed by code]: `lib/logistics.ts formatProductionTimeForPDF` renders
these for the "SALES TERMS" section of the PDF. The production time is also
part of this section (stored in `production_mode` / `production_days` /
`production_date`).

~~Needs confirmation.~~ **Resolved — Owner decision H.8 (confirmed 2026-05-30):**
30 days (products) and 7 days (transport/freight) are the confirmed
business-approved standard defaults. Both are already the DB defaults and match
the target rule. Explicit validity-date display on PDFs is target behavior.

---

## 10. Document-level commercial fields

### 10.1 Incoterm

[Confirmed by code]: `documents.incoterm` CHECK:
`EXW / FOB / CFR / CIF / DDP / DDU` (`004`). `lib/types.ts Incoterm`.

### 10.2 Purchase order number

[Confirmed by code]: `documents.purchase_order_number` (text, nullable),
added in `006`. The client's PO reference, shown on the PDF.

### 10.3 Affair name

[Confirmed by code]: `documents.affair_name` (text, nullable, `056`).
Internal project label for the affair/deal, distinct from the document number.

### 10.4 Bank account

[Confirmed by code]: `documents.bank_account_id` (FK → `bank_accounts`, `005`).
Drives which bank details appear on the PDF. Auto-selected to the default
account for the document's currency when currency changes.

`bank_accounts` table columns [Confirmed by code: `lib/types.ts BankAccount`]:
`id`, `account_name` (internal label), `business_account_name` (legal name for
PDF, nullable, added `038`), `currency`, `bank_name`, `bank_address`,
`account_number`, `swift`, `is_default`.

One default per currency enforced by partial unique index.

### 10.5 Sales conditions

[Confirmed by code]: `documents.include_sales_conditions` (boolean) and
`documents.sales_conditions_id` (FK → `sales_conditions`, `005`). When
`include_sales_conditions = false`, `sales_conditions_id` is set to null on
save.

`sales_conditions` table: `id`, `title`, `content`, `is_default`. At most one
default enforced by partial unique index.

### 10.6 Advisory validation

[Confirmed by code]: `documents.validation_status` (`pending` / `approved` /
`rejected`), with audit columns `validation_requested_by`,
`validation_requested_at`, `validation_note`, `validation_reviewed_by`,
`validation_reviewed_at`, `validation_review_note` (migration `068`). **This
is advisory only — it never blocks the save or any workflow transition.**
[Confirmed by code: `app/(app)/documents/new/actions.ts` comment line 66].

---

## 11. Quotation versioning and numbering

### 11.1 Document number format

[Confirmed by code]: `SLX-{CLIENT_CODE}-{YY}-{NNN}` via the
`next_client_document_number` RPC (`006`). The sequence is:
`max(highest_existing_seq, starting_seq + prior_count) + 1`, zero-padded to 3
digits.

### 11.2 Revision numbering

[Confirmed by code]: A revision appends `-V{n}` to the base number. Version
counting is done by counting existing documents with the same base number or
matching the `-V{n}` pattern. The new version = `siblings.length + 1`
(`app/(app)/documents/new/actions.ts` lines 361-372).

### 11.3 Edit in-place vs revision

[Confirmed by code]:
- **Edit in-place** (`edit_of`): only for `draft` status. Updates the same row;
  lines and containers are replaced wholesale. Number/status/`created_by`
  are preserved.
- **Revision** (`revise_of`): creates a new row with a new number (base + `-V{n}`),
  new `root_document_id`, and incremented `version`. Status starts at `draft`.

---

## 12. Factory instruction resolution (pricing-adjacent)

Though this is primarily a production/factory topic, it is pricing-adjacent
because it involves per-client and per-order overrides to specifications that
affect product identity.

[Confirmed by code]: `lib/types.ts resolveFactoryInstruction` applies a
four-level priority chain for each `(field_name, sales_value)` pair:

1. **override** — per-order override in `production_task_list_lines.factory_overrides`.
2. **client_preset** — per-client default in `client_technical_presets.mapping`.
3. **mapping** — global `factory_mappings` table (active rows only).
4. **missing** — no mapping configured; renders a warning.

`client_technical_presets` (m071): one row per `(client_id, product_id)`, unique.
Contains `mapping` (JSONB: `{ field_name → factory_instruction_text }`) and
`extras` (JSONB array of `{ key, label, value }` for factory-only attributes not
in the sales config).

---

## 13. Items requiring owner confirmation

The following are flagged **Needs confirmation** in this document. They cannot
be answered from code alone:

1. **"Latest price" tie-breaking**: when multiple `prices_version` rows exist
   for the same (product, tier), which is the active price? The `buildTierPriceMap`
   deduplication keeps the first result from the caller's query — the ordering
   of that query is not visible in `lib/pricing.ts`.

2. **Per-client commission config on `clients` table**: `DATABASE_STRUCTURE.md`
   references `clients.commission_*` columns, but migration `006` only adds
   commission columns to `documents`, not `clients`. Confirm whether these
   columns exist, and if so, how they pre-populate a new quotation.

3. **Tax/VAT exclusion**: no tax calculation exists anywhere in the pricing
   stack. ~~Confirm whether this is intentional.~~ **Resolved — Owner decision H.3
   (confirmed 2026-05-30):** always tax-free; export sales only; omission is
   intentional. Remaining gap: explicit "Tax-free export sale" label in PDF/UI
   is not yet implemented.

4. **No currency conversion**: prices in `prices_version` appear to be entered
   in one currency (likely USD). ~~Confirm how pricing works when the document
   currency is EUR or CNY.~~ **Resolved — Owner decision H.4 (confirmed 2026-05-30):**
   explicit conversion with FX rate locked per document version, audit fields,
   and optional adjustment clause. Full FX conversion pipeline is target behavior
   not yet implemented.

5. **Rounding policy**: no explicit rounding is applied to computed prices
   (grand_total, commission, deposit). ~~Confirm whether floating-point storage
   is acceptable.~~ **Resolved — Owner decision H.5 (confirmed 2026-05-30):**
   2-decimal rounding required at all monetary fields; balance absorbs rounding
   difference. Not yet implemented in code.

6. **Default deposit percentage (30%)**: the builder initializes to 30% deposit.
   ~~Confirm whether this is the standard business default.~~ **Resolved — Owner
   decision H.6 (confirmed 2026-05-30):** 30% is the confirmed business default.
   Additional payment structures (25/75, 20/80, 100% before production, L/C
   variants, no-deposit exception) are target behavior not yet fully implemented.

7. **Balance reminder default**: `balance_reminder_days_before_eta` is nullable.
   ~~Confirm whether teams are expected to set a default.~~ **Resolved — Owner
   decision H.7 (confirmed 2026-05-30):** Africa = 20 days default; other
   regions = 15 days default; both editable. Region-aware default logic is not
   yet implemented; field currently remains NULL unless manually set.

8. **Offer validity windows**: 30 days (products) and 7 days (transport) are
   DB defaults. ~~Confirm whether these match the standard commercial terms.~~
   **Resolved — Owner decision H.8 (confirmed 2026-05-30):** 30 days (products)
   and 7 days (freight) are the confirmed business-approved standard defaults.
   Distinction between product validity, freight validity, and full quotation
   validity is target behavior to clarify in the UI/PDF.

9. **Warranty standard**: common values of 3, 5, 10 years are mentioned in the
   migration comment. ~~Confirm whether there is a standard warranty offered to
   most clients.~~ **Resolved — Owner decision H.9 (confirmed 2026-05-30):**
   warranty is per product (each product has a configured default, e.g. 3y/5y);
   prefilled on the quote line; manual changes must be traceable with audit fields.
   Per-product warranty default and override-audit fields are not yet implemented.

10. **`field_scope = "technical"` enforcement gate**: the exact server-action
    or middleware that prevents sales from writing to `field_scope = "technical"`
    fields was not traced. Confirm the enforcement is adequate.
